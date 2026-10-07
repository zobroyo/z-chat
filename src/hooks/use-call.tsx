import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { callAudioRunning, getCallAudioContext, resumeCallAudio } from "@/lib/call-audio";
import { CALL_SOUNDS, playCallSound } from "@/lib/call-sounds";
import { startRingtone, type RingtoneHandle } from "@/lib/ringtone";

/*
 * Discord-style mesh voice/video calls on top of Supabase Realtime + WebRTC.
 *
 * One public broadcast channel per conversation: `call:{conversationId}`.
 *
 * Event contract
 * --------------
 * join   { userId, name, host?, guest?, key?, joinedAt?, roomId? }
 *                                              broadcast once when joining
 * offer  { to, from, name?, sdp }              existing peers -> newcomer
 * answer { to, from, name?, sdp }              newcomer -> existing peer
 * ice    { to, from, candidate }               trickled ICE candidates
 * state  { userId, name?, muted, video, deafened, serverMuted, guest,
 *          joinedAt, roomId, host?, guestKey? } mute / camera / room flags
 * mod    { target, muted, by }                 host server-mutes a participant
 * sound  { userId, soundId, name? }            soundboard trigger (synth locally)
 * rooms  { rooms, assignments, by, guestKey? } host breakout-room state
 * leave  { userId }                            graceful disconnect
 * decline{ userId, name }                      recipient declined the ring
 *
 * Every event carrying `to` is ignored unless `to` is my own user id. The
 * joiner never initiates: after the `join` broadcast, each participant that is
 * already in the same breakout room creates an RTCPeerConnection, adds the
 * local tracks and sends an offer to the newcomer, who answers.
 *
 * Host: the earliest non-guest joiner, with the user id as a deterministic
 * tie-break. The host can server-mute participants, create breakout rooms and
 * move people between them. Host election is local (joinedAt timestamps are
 * exchanged in join/state); it is best-effort and not security-critical.
 *
 * Breakout rooms: host broadcasts the full room + assignment map; every client
 * keeps media connections only with peers in its own room. When the room of a
 * peer changes, the connection is torn down or re-negotiated accordingly.
 *
 * Guests: `options.guest` marks a throwaway identity from a shared link. The
 * guest presents `options.guestKey` in its join event; participants accept it
 * only when it matches the key the host shared. Guests are never elected host.
 *
 * Everything Web Audio related (ringtone, per-user volume, soundboard) fails
 * soft: a blocked AudioContext falls back to an <audio> element or a visual
 * prompt and never throws.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

const CHANNEL_TIMEOUT_MS = 15_000;

/** Minimum gap between soundboard triggers, to keep spam manageable. */
const SOUND_COOLDOWN_MS = 400;

export type CallParticipant = {
  id: string;
  name: string;
  muted: boolean;
  video: boolean;
  deafened: boolean;
  /** Muted by the host for everyone. */
  serverMuted: boolean;
  /** Muted locally for me only (never broadcast). */
  localMuted: boolean;
  /** Local playback volume 0-200 (never broadcast). */
  volume: number;
  isGuest: boolean;
  /** Breakout room id, or null for the main room. */
  roomId: string | null;
  /** Sender clock at join, used for host election. */
  joinedAt: number;
};

export type BreakoutRoom = {
  id: string;
  name: string;
};

export type UseCallOptions = {
  /** Supabase client to use. Defaults to the app client; guests pass an isolated one. */
  client?: SupabaseClient;
  /** Guest link mode: throwaway identity, no incoming-ring listener. */
  guest?: boolean;
  /** Shared secret embedded in the guest link. */
  guestKey?: string | null;
  /** Set false on the guest page so joins are never treated as incoming calls. */
  listenForIncoming?: boolean;
};

type JoinPayload = {
  userId?: string;
  name?: string;
  host?: boolean;
  guest?: boolean;
  key?: string;
  joinedAt?: number;
  roomId?: string | null;
};
type OfferPayload = { to?: string; from?: string; name?: string; sdp?: string };
type AnswerPayload = { to?: string; from?: string; name?: string; sdp?: string };
type IcePayload = { to?: string; from?: string; candidate?: RTCIceCandidateInit | null };
type StatePayload = {
  userId?: string;
  name?: string;
  muted?: boolean;
  video?: boolean;
  deafened?: boolean;
  serverMuted?: boolean;
  guest?: boolean;
  joinedAt?: number;
  roomId?: string | null;
  host?: boolean;
  guestKey?: string | null;
};
type LeavePayload = { userId?: string };
type ModPayload = { target?: string; muted?: boolean; by?: string };
type SoundPayload = { userId?: string; soundId?: string; name?: string };
type RoomsPayload = {
  rooms?: BreakoutRoom[];
  assignments?: Record<string, string | null>;
  by?: string;
  guestKey?: string | null;
};

type Peer = {
  pc: RTCPeerConnection;
  /** Hidden <audio> fallback that plays this peer's remote stream. */
  audioEl: HTMLAudioElement | null;
  /** Single remote MediaStream for this peer, fed by `ontrack`. */
  stream: MediaStream;
  /** Sender for the up-front video transceiver; camera tracks are swapped in here. */
  videoSender: RTCRtpSender | null;
  /** Web Audio graph used for 0-200% volume (null when unavailable). */
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  name: string;
  /** True while an offer is being created/sent (perfect-negotiation glare flag). */
  makingOffer: boolean;
};

function asPayload<T>(value: unknown): T | null {
  if (!value || typeof value !== "object") return null;
  return value as T;
}

function mediaErrorMessage(cause: unknown, device: "microphone" | "camera"): string {
  if (cause instanceof DOMException) {
    switch (cause.name) {
      case "NotAllowedError":
      case "SecurityError":
        return `Permission to use your ${device} was denied.`;
      case "NotFoundError":
      case "DevicesNotFoundError":
        return `No ${device} was found on this device.`;
      case "NotReadableError":
      case "TrackStartError":
        return `Your ${device} is already being used by another app.`;
      default:
        return cause.message || `Could not access your ${device}.`;
    }
  }

  if (cause instanceof Error && cause.message) return cause.message;
  return `Could not access your ${device}.`;
}

/** Unguessable-ish room key for guest links (not a cryptographic secret). */
function randomGuestKey(): string {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useCall(
  conversationId: string | null,
  me: { id: string; name: string },
  options?: UseCallOptions,
) {
  const [inCall, setInCall] = useState(false);
  const [joining, setJoining] = useState(false);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [serverMuted, setServerMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ userId: string; name: string } | null>(null);
  const [ringAudioBlocked, setRingAudioBlocked] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [guestKey, setGuestKey] = useState<string | null>(options?.guestKey ?? null);
  const [myRoomId, setMyRoomId] = useState<string | null>(null);
  const [breakoutRooms, setBreakoutRooms] = useState<BreakoutRoom[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const isGuest = options?.guest === true;
  const listenForIncoming = options?.listenForIncoming !== false && !isGuest;

  // Keep the latest props/state available to stable callbacks without
  // re-creating them (channel handlers need the values at call time).
  const clientRef = useRef<SupabaseClient>(options?.client ?? supabase);
  const meRef = useRef(me);
  meRef.current = me;
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;
  const callConversationRef = useRef<string | null>(null);
  const joinedAsRef = useRef<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const pageHideRef = useRef<(() => void) | null>(null);
  const listenChannelRef = useRef<RealtimeChannel | null>(null);
  const incomingCallRef = useRef<{ userId: string; name: string } | null>(null);
  const ringtoneHandleRef = useRef<RingtoneHandle | null>(null);
  const ringRetryRef = useRef<(() => void) | null>(null);
  const ringTimeoutRef = useRef<number | null>(null);
  const titleBeforeRingRef = useRef<string | null>(null);
  const unlockAudioRef = useRef<(() => void) | null>(null);

  const inCallRef = useRef(false);
  const joiningRef = useRef(false);
  const mutedRef = useRef(false);
  const cameraOnRef = useRef(false);
  const deafenedRef = useRef(false);
  const serverMutedRef = useRef(false);
  const isGuestRef = useRef(isGuest);
  const isHostRef = useRef(false);
  const hostIdRef = useRef<string | null>(null);
  const myJoinedAtRef = useRef(0);
  const guestKeyRef = useRef<string | null>(options?.guestKey ?? null);
  const knownRef = useRef(new Map<string, CallParticipant>());
  const volumesRef = useRef(new Map<string, number>());
  const localMutedRef = useRef(new Set<string>());
  const roomsRef = useRef<BreakoutRoom[]>([]);
  const assignmentsRef = useRef<Record<string, string | null>>({});
  const myRoomIdRef = useRef<string | null>(null);
  const lastSoundAtRef = useRef(0);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      void channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
    } catch {
      // `_push` throws when the channel has not finished joining; drop the event.
    }
  }, []);

  // ---- Participant bookkeeping ----------------------------------------------

  const commitParticipants = useCallback(() => {
    setParticipants([...knownRef.current.values()]);
  }, []);

  const patchParticipant = useCallback(
    (id: string, patch: Partial<CallParticipant>) => {
      const existing = knownRef.current.get(id);
      if (existing) {
        knownRef.current.set(id, { ...existing, ...patch });
      } else {
        knownRef.current.set(id, {
          id,
          name: patch.name ?? "Someone",
          muted: patch.muted ?? false,
          video: patch.video ?? false,
          deafened: patch.deafened ?? false,
          serverMuted: patch.serverMuted ?? false,
          localMuted: localMutedRef.current.has(id),
          volume: volumesRef.current.get(id) ?? patch.volume ?? 100,
          isGuest: patch.isGuest ?? false,
          roomId: patch.roomId ?? null,
          joinedAt: patch.joinedAt ?? Date.now(),
        });
      }
      commitParticipants();
    },
    [commitParticipants],
  );

  const recomputeHost = useCallback(() => {
    const self = meRef.current;
    const candidates = [
      { id: self.id, joinedAt: myJoinedAtRef.current, guest: isGuestRef.current },
      ...[...knownRef.current.values()].map((participant) => ({
        id: participant.id,
        joinedAt: participant.joinedAt,
        guest: participant.isGuest,
      })),
    ].filter((candidate) => !candidate.guest && candidate.joinedAt > 0);
    candidates.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

    const nextHost = candidates[0]?.id ?? null;
    if (nextHost !== hostIdRef.current) {
      hostIdRef.current = nextHost;
      isHostRef.current = nextHost === self.id;
      setHostId(nextHost);
    }
  }, []);

  const removeParticipant = useCallback(
    (id: string) => {
      if (!knownRef.current.delete(id)) return;
      commitParticipants();
      recomputeHost();
    },
    [commitParticipants, recomputeHost],
  );

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  // ---- Audio routing (0-200% volume, local mute, deafen, server mute) -------

  const applyPeerVolume = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;

    const participant = knownRef.current.get(peerId);
    const serverMute = participant?.serverMuted === true;
    const requested = localMutedRef.current.has(peerId)
      ? 0
      : (volumesRef.current.get(peerId) ?? 100);
    const effective = deafenedRef.current || serverMute ? 0 : requested / 100;

    if (peer.gain) peer.gain.gain.value = effective;
    if (peer.audioEl) {
      // When the Web Audio graph is live it owns playback; the element is the
      // fallback path (and it caps at 100%).
      const usingGraph = !!peer.gain && callAudioRunning();
      peer.audioEl.muted = usingGraph || effective === 0;
      peer.audioEl.volume = Math.min(1, effective);
    }
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;

      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);

      try {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch {
        // Already closed.
      }

      try {
        peer.source?.disconnect();
        peer.gain?.disconnect();
      } catch {
        // Graph already torn down.
      }

      peer.audioEl?.remove();
      removeRemoteStream(peerId);
      removeParticipant(peerId);
    },
    [removeParticipant, removeRemoteStream],
  );

  const addIce = useCallback((peerId: string, candidate: RTCIceCandidateInit) => {
    const peer = peersRef.current.get(peerId);
    if (!peer || !peer.pc.remoteDescription) {
      const queue = pendingIceRef.current.get(peerId) ?? [];
      queue.push(candidate);
      pendingIceRef.current.set(peerId, queue);
      return;
    }
    void peer.pc.addIceCandidate(candidate).catch(() => undefined);
  }, []);

  const flushIce = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    const queue = pendingIceRef.current.get(peerId);
    if (!queue?.length) return;

    pendingIceRef.current.delete(peerId);
    for (const candidate of queue) {
      void peer.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }, []);

  const ensurePeerGraph = useCallback((peer: Peer, stream: MediaStream) => {
    const context = getCallAudioContext();
    if (!context) return;
    try {
      try {
        peer.source?.disconnect();
        peer.gain?.disconnect();
      } catch {
        // Ignore a stale graph.
      }
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(context.destination);
      peer.source = source;
      peer.gain = gain;
    } catch {
      peer.source = null;
      peer.gain = null;
    }
  }, []);

  const createPeer = useCallback(
    (peerId: string, name: string | undefined) => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        if (name && name !== existing.name) {
          existing.name = name;
          patchParticipant(peerId, { name });
        }
        return existing;
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const stream = new MediaStream();
      const peer: Peer = {
        pc,
        stream,
        videoSender: null,
        audioEl: null,
        gain: null,
        source: null,
        name: name ?? "Someone",
        makingOffer: false,
      };

      const local = localStreamRef.current;
      if (local) {
        for (const track of local.getAudioTracks()) pc.addTrack(track, local);
      }

      // Up-front sendrecv video transceiver: toggling the camera becomes a
      // replaceTrack on this sender instead of a renegotiation later.
      const transceiver = pc.addTransceiver("video", {
        direction: "sendrecv",
        ...(local ? { streams: [local] } : {}),
      });
      peer.videoSender = transceiver.sender;

      const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack && peer.videoSender) {
        void peer.videoSender.replaceTrack(cameraTrack).catch(() => undefined);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send("ice", {
            to: peerId,
            from: meRef.current.id,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track);
        }

        if (!peer.audioEl && typeof document !== "undefined") {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          audio.style.display = "none";
          document.body.appendChild(audio);
          peer.audioEl = audio;
        }

        ensurePeerGraph(peer, stream);

        if (peer.audioEl) {
          if (peer.audioEl.srcObject !== stream) peer.audioEl.srcObject = stream;
          void peer.audioEl.play().catch(() => undefined);
        }

        applyPeerVolume(peerId);

        setRemoteStreams((current) =>
          current[peerId] === stream ? current : { ...current, [peerId]: stream },
        );
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") closePeer(peerId);
      };

      peersRef.current.set(peerId, peer);
      patchParticipant(peerId, { name: peer.name });
      return peer;
    },
    [applyPeerVolume, closePeer, ensurePeerGraph, patchParticipant, send],
  );

  /** Creates the peer connection (if needed) and sends an offer to it. */
  const offerPeer = useCallback(
    async (peerId: string, name: string | undefined) => {
      const self = meRef.current;
      if (!inCallRef.current) return;
      const peer = createPeer(peerId, name);
      peer.makingOffer = true;
      try {
        const offer = await peer.pc.createOffer();
        // Left the call while creating, or a colliding remote offer was
        // accepted in the meantime: abandon this offer.
        if (!inCallRef.current || peer.pc.signalingState !== "stable") return;
        await peer.pc.setLocalDescription(offer);
        send("offer", { to: peerId, from: self.id, name: self.name, sdp: offer.sdp });
      } catch {
        closePeer(peerId);
      } finally {
        peer.makingOffer = false;
      }
    },
    [closePeer, createPeer, send],
  );

  // ---- Local audio state -----------------------------------------------------

  const applyLocalAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !mutedRef.current && !deafenedRef.current && !serverMutedRef.current;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  const broadcastState = useCallback(() => {
    const self = meRef.current;
    send("state", {
      userId: self.id,
      name: self.name,
      muted: mutedRef.current || deafenedRef.current || serverMutedRef.current,
      video: cameraOnRef.current,
      deafened: deafenedRef.current,
      serverMuted: serverMutedRef.current,
      guest: isGuestRef.current,
      joinedAt: myJoinedAtRef.current,
      roomId: myRoomIdRef.current,
      host: isHostRef.current,
      ...(isHostRef.current && guestKeyRef.current ? { guestKey: guestKeyRef.current } : {}),
    });
  }, [send]);

  const broadcastRooms = useCallback(
    (rooms: BreakoutRoom[], assignments: Record<string, string | null>) => {
      if (!isHostRef.current) return;
      send("rooms", {
        rooms,
        assignments,
        by: meRef.current.id,
        ...(guestKeyRef.current ? { guestKey: guestKeyRef.current } : {}),
      });
    },
    [send],
  );

  const ensureGuestKey = useCallback((): string | null => {
    if (guestKeyRef.current) return guestKeyRef.current;
    if (!isHostRef.current) return null;
    const key = randomGuestKey();
    guestKeyRef.current = key;
    setGuestKey(key);
    if (inCallRef.current) {
      broadcastRooms(roomsRef.current, assignmentsRef.current);
      broadcastState();
    }
    return key;
  }, [broadcastRooms, broadcastState]);

  // ---- Remote event handlers -------------------------------------------------

  const handleJoin = useCallback(
    async (data: JoinPayload | null) => {
      const self = meRef.current;
      const userId = data?.userId;
      if (!inCallRef.current || !userId || userId === self.id) return;

      if (data.guest === true) {
        const expected = guestKeyRef.current;
        // A guest who does not carry the invite key for this call is ignored,
        // so a leaked conversation id alone does not let strangers in.
        if (expected && data.key !== expected) return;
      }

      const existing = peersRef.current.get(userId);
      const theirRoom = assignmentsRef.current[userId] ?? null;
      patchParticipant(userId, {
        ...(data.name ? { name: data.name } : {}),
        isGuest: data.guest === true,
        ...(typeof data.joinedAt === "number" && data.joinedAt > 0
          ? { joinedAt: data.joinedAt }
          : {}),
        roomId: theirRoom,
      });

      if (data.host === true && !hostIdRef.current) {
        hostIdRef.current = userId;
        isHostRef.current = false;
        setHostId(userId);
      }
      recomputeHost();

      if (isHostRef.current) {
        // Bring the newcomer up to date on breakouts and the guest invite key.
        broadcastRooms(roomsRef.current, assignmentsRef.current);
        if (guestKeyRef.current) broadcastState();
      }

      // Peers in other breakout rooms stay disconnected.
      if (theirRoom !== myRoomIdRef.current) return;

      // A peer re-announcing after a reload: the old connection is dead but may
      // not have flipped to "failed" yet, so rebuild it explicitly. Anything
      // still negotiating (or healthy) is left alone.
      if (existing) {
        const busy =
          existing.pc.signalingState !== "stable" ||
          existing.pc.connectionState === "connected" ||
          existing.pc.connectionState === "connecting";
        if (busy) return;
        closePeer(userId);
      }

      await offerPeer(userId, data.name);
    },
    [broadcastRooms, broadcastState, closePeer, offerPeer, patchParticipant, recomputeHost],
  );

  const handleOffer = useCallback(
    async (data: OfferPayload | null) => {
      const self = meRef.current;
      if (!data?.from || !data.sdp || !inCallRef.current) return;
      if (data.to && data.to !== self.id) return;
      if (data.from === self.id) return;
      if ((assignmentsRef.current[data.from] ?? null) !== myRoomIdRef.current) return;

      const peer = createPeer(data.from, data.name);

      // Perfect negotiation tie-break: on simultaneous joins both peers may
      // offer at once. The "polite" peer (higher user id) yields and answers
      // the incoming offer; the impolite peer keeps its own offer.
      const polite = self.id > data.from;
      const collision = peer.makingOffer || peer.pc.signalingState !== "stable";
      if (collision && !polite) return;

      if (collision && peer.pc.signalingState === "have-local-offer") {
        try {
          await peer.pc.setLocalDescription({ type: "rollback" });
        } catch {
          return;
        }
      }

      try {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        flushIce(data.from);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send("answer", { to: data.from, from: self.id, name: self.name, sdp: answer.sdp });
      } catch {
        // Stale or duplicate offer; keep any existing connection alive.
      }
    },
    [createPeer, flushIce, send],
  );

  const handleAnswer = useCallback(
    async (data: AnswerPayload | null) => {
      const self = meRef.current;
      if (!data?.from || !data.sdp || !inCallRef.current) return;
      if (data.to && data.to !== self.id) return;

      const peer = peersRef.current.get(data.from);
      if (!peer) return;

      if (data.name && data.name !== peer.name) {
        peer.name = data.name;
        patchParticipant(data.from, { name: data.name });
      }

      try {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        flushIce(data.from);
      } catch {
        // Stale or duplicate answer; ignore.
      }
    },
    [flushIce, patchParticipant],
  );

  const handleIce = useCallback(
    (data: IcePayload | null) => {
      const self = meRef.current;
      if (!data?.from || !data.candidate || !inCallRef.current) return;
      if (data.to && data.to !== self.id) return;
      addIce(data.from, data.candidate);
    },
    [addIce],
  );

  const handleState = useCallback(
    (data: StatePayload | null) => {
      const self = meRef.current;
      if (!data?.userId || data.userId === self.id) return;

      patchParticipant(data.userId, {
        ...(data.name ? { name: data.name } : {}),
        muted: data.muted === true,
        video: data.video === true,
        deafened: data.deafened === true,
        serverMuted: data.serverMuted === true,
        isGuest: data.guest === true,
        ...(typeof data.joinedAt === "number" && data.joinedAt > 0
          ? { joinedAt: data.joinedAt }
          : {}),
        roomId: data.roomId ?? null,
      });

      if (data.guestKey && !isGuestRef.current) {
        guestKeyRef.current = data.guestKey;
        setGuestKey(data.guestKey);
      }
      if (data.host === true && !hostIdRef.current) {
        hostIdRef.current = data.userId;
        isHostRef.current = false;
        setHostId(data.userId);
      }
      recomputeHost();
    },
    [patchParticipant, recomputeHost],
  );

  const handleLeave = useCallback(
    (data: LeavePayload | null) => {
      if (!data?.userId) return;
      volumesRef.current.delete(data.userId);
      localMutedRef.current.delete(data.userId);
      closePeer(data.userId);
      // Recompute even when no peer existed (e.g. a room-mate that never connected).
      knownRef.current.delete(data.userId);
      commitParticipants();
      recomputeHost();
    },
    [closePeer, commitParticipants, recomputeHost],
  );

  const applyRooms = useCallback(
    (rooms: BreakoutRoom[], assignments: Record<string, string | null>) => {
      roomsRef.current = rooms;
      assignmentsRef.current = assignments;
      setBreakoutRooms(rooms);

      const mine = assignments[meRef.current.id] ?? null;
      myRoomIdRef.current = mine;
      setMyRoomId(mine);

      for (const participant of [...knownRef.current.values()]) {
        const room = assignments[participant.id] ?? null;
        if (participant.roomId !== room) patchParticipant(participant.id, { roomId: room });

        const peer = peersRef.current.get(participant.id);
        if (room === mine) {
          if (!peer) void offerPeer(participant.id, participant.name);
        } else if (peer) {
          closePeer(participant.id);
        }
      }
    },
    [closePeer, offerPeer, patchParticipant],
  );

  const handleRooms = useCallback(
    (data: RoomsPayload | null) => {
      if (!data) return;
      if (data.by && hostIdRef.current && data.by !== hostIdRef.current) return;

      if (data.guestKey && !isGuestRef.current) {
        guestKeyRef.current = data.guestKey;
        setGuestKey(data.guestKey);
      }

      const rooms = (data.rooms ?? []).filter(
        (room) => !!room && typeof room.id === "string" && typeof room.name === "string",
      );
      applyRooms(rooms, data.assignments ?? {});
    },
    [applyRooms],
  );

  const applyServerMute = useCallback(
    (target: string, muted: boolean) => {
      if (target === meRef.current.id) {
        serverMutedRef.current = muted;
        applyLocalAudio();
        setServerMuted(muted);
        broadcastState();
        if (muted) toast.error("You were muted by the call host");
        return;
      }
      patchParticipant(target, { serverMuted: muted });
      applyPeerVolume(target);
    },
    [applyLocalAudio, applyPeerVolume, broadcastState, patchParticipant],
  );

  const handleMod = useCallback(
    (data: ModPayload | null) => {
      if (!data?.target || data.muted === undefined || !data.by) return;
      if (data.by === meRef.current.id) return;
      // Only the elected host may moderate.
      if (hostIdRef.current && data.by !== hostIdRef.current) return;
      applyServerMute(data.target, data.muted === true);
    },
    [applyServerMute],
  );

  const handleSound = useCallback((data: SoundPayload | null) => {
    if (!data?.soundId || data.userId === meRef.current.id) return;
    playCallSound(data.soundId);
  }, []);

  // ---- Lifecycle -------------------------------------------------------------

  const teardown = useCallback(() => {
    if (pageHideRef.current) {
      window.removeEventListener("pagehide", pageHideRef.current);
      pageHideRef.current = null;
    }

    if (unlockAudioRef.current) {
      window.removeEventListener("pointerdown", unlockAudioRef.current);
      window.removeEventListener("keydown", unlockAudioRef.current);
      unlockAudioRef.current = null;
    }

    for (const peerId of [...peersRef.current.keys()]) closePeer(peerId);
    pendingIceRef.current.clear();

    const local = localStreamRef.current;
    if (local) {
      local.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    const camera = cameraStreamRef.current;
    if (camera) {
      camera.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    const channel = channelRef.current;
    channelRef.current = null;
    callConversationRef.current = null;
    joinedAsRef.current = null;
    if (channel) void clientRef.current.removeChannel(channel);

    inCallRef.current = false;
    joiningRef.current = false;
    mutedRef.current = false;
    cameraOnRef.current = false;
    deafenedRef.current = false;
    serverMutedRef.current = false;
    isHostRef.current = false;
    hostIdRef.current = null;
    myJoinedAtRef.current = 0;
    roomsRef.current = [];
    assignmentsRef.current = {};
    myRoomIdRef.current = null;
    if (!isGuestRef.current) {
      guestKeyRef.current = null;
      setGuestKey(null);
    }

    knownRef.current.clear();
    volumesRef.current.clear();
    localMutedRef.current.clear();

    setParticipants([]);
    setRemoteStreams({});
    setLocalStream(null);
    setInCall(false);
    setJoining(false);
    setMuted(false);
    setCameraOn(false);
    setDeafened(false);
    setServerMuted(false);
    setHostId(null);
    setMyRoomId(null);
    setBreakoutRooms([]);
    setActiveConversationId(null);
  }, [closePeer]);

  const joinCall = useCallback(async () => {
    const self = meRef.current;
    const targetConversation = conversationIdRef.current;
    if (!targetConversation || !self.id || inCallRef.current || joiningRef.current) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support calls.");
      return;
    }

    joiningRef.current = true;
    setJoining(true);
    setError(null);

    let channel: RealtimeChannel | null = null;

    try {
      // Joining is a user gesture: unlock Web Audio here so remote volume and
      // the soundboard work immediately.
      void resumeCallAudio();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      channel = clientRef.current.channel(`call:${targetConversation}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "join" }, (message) => {
          void handleJoin(asPayload<JoinPayload>(message["payload"]));
        })
        .on("broadcast", { event: "offer" }, (message) => {
          void handleOffer(asPayload<OfferPayload>(message["payload"]));
        })
        .on("broadcast", { event: "answer" }, (message) => {
          void handleAnswer(asPayload<AnswerPayload>(message["payload"]));
        })
        .on("broadcast", { event: "ice" }, (message) => {
          handleIce(asPayload<IcePayload>(message["payload"]));
        })
        .on("broadcast", { event: "state" }, (message) => {
          handleState(asPayload<StatePayload>(message["payload"]));
        })
        .on("broadcast", { event: "leave" }, (message) => {
          handleLeave(asPayload<LeavePayload>(message["payload"]));
        })
        .on("broadcast", { event: "mod" }, (message) => {
          handleMod(asPayload<ModPayload>(message["payload"]));
        })
        .on("broadcast", { event: "sound" }, (message) => {
          handleSound(asPayload<SoundPayload>(message["payload"]));
        })
        .on("broadcast", { event: "rooms" }, (message) => {
          handleRooms(asPayload<RoomsPayload>(message["payload"]));
        })
        .on("broadcast", { event: "decline" }, (message) => {
          const payload = asPayload<{ userId?: string; name?: string }>(message["payload"]);
          if (payload?.userId && payload.userId !== meRef.current.id) {
            toast(`${payload.name ?? "Someone"} declined the call`);
          }
        });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error("Could not connect to the call."));
        }, CHANNEL_TIMEOUT_MS);

        channel?.subscribe((status) => {
          if (settled) return;
          if (status === "SUBSCRIBED") {
            settled = true;
            window.clearTimeout(timer);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            settled = true;
            window.clearTimeout(timer);
            reject(new Error("Could not connect to the call."));
          }
        });
      });

      const pageHide = () => {
        const active = channelRef.current;
        if (!active || !inCallRef.current) return;
        try {
          void active
            .send({ type: "broadcast", event: "leave", payload: { userId: meRef.current.id } })
            .catch(() => undefined);
        } catch {
          // Socket already gone.
        }
      };
      pageHideRef.current = pageHide;
      window.addEventListener("pagehide", pageHide);

      // Retry Web Audio playback on the next gesture if it was blocked.
      const unlockAudio = () => {
        void resumeCallAudio().then((running) => {
          if (!running) return;
          for (const peerId of peersRef.current.keys()) applyPeerVolume(peerId);
        });
      };
      unlockAudioRef.current = unlockAudio;
      window.addEventListener("pointerdown", unlockAudio);
      window.addEventListener("keydown", unlockAudio);

      callConversationRef.current = targetConversation;
      joinedAsRef.current = self.id;
      myJoinedAtRef.current = Date.now();

      // First into an empty call: this client hosts it.
      const alone = peersRef.current.size === 0 && knownRef.current.size === 0;
      if (alone && !isGuestRef.current) {
        hostIdRef.current = self.id;
        isHostRef.current = true;
        setHostId(self.id);
      } else {
        recomputeHost();
      }

      setLocalStream(stream);
      setActiveConversationId(targetConversation);
      inCallRef.current = true;
      setInCall(true);

      send("join", {
        userId: self.id,
        name: self.name,
        host: isHostRef.current,
        guest: isGuestRef.current,
        joinedAt: myJoinedAtRef.current,
        roomId: myRoomIdRef.current,
        ...(isGuestRef.current && guestKeyRef.current ? { key: guestKeyRef.current } : {}),
      });
      broadcastState();

      if (isHostRef.current) ensureGuestKey();
    } catch (cause) {
      const local = localStreamRef.current;
      if (local) {
        local.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (pageHideRef.current) {
        window.removeEventListener("pagehide", pageHideRef.current);
        pageHideRef.current = null;
      }
      if (unlockAudioRef.current) {
        window.removeEventListener("pointerdown", unlockAudioRef.current);
        window.removeEventListener("keydown", unlockAudioRef.current);
        unlockAudioRef.current = null;
      }
      if (channel) {
        channelRef.current = null;
        void clientRef.current.removeChannel(channel);
      }
      setError(mediaErrorMessage(cause, "microphone"));
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }, [
    applyPeerVolume,
    broadcastState,
    ensureGuestKey,
    handleAnswer,
    handleIce,
    handleJoin,
    handleLeave,
    handleMod,
    handleOffer,
    handleRooms,
    handleSound,
    handleState,
    recomputeHost,
    send,
  ]);

  const leaveCall = useCallback(async () => {
    const channel = channelRef.current;
    if (channel && inCallRef.current) {
      try {
        await channel.send({
          type: "broadcast",
          event: "leave",
          payload: { userId: meRef.current.id },
        });
      } catch {
        // Channel may already be closed; teardown still runs.
      }
    }
    teardown();
  }, [teardown]);

  const toggleMute = useCallback(() => {
    if (!inCallRef.current) return;
    if (serverMutedRef.current) {
      toast.error("You are server-muted by the call host");
      return;
    }
    mutedRef.current = !mutedRef.current;
    applyLocalAudio();
    setMuted(mutedRef.current);
    broadcastState();
  }, [applyLocalAudio, broadcastState]);

  const toggleDeafen = useCallback(() => {
    if (!inCallRef.current) return;
    const next = !deafenedRef.current;
    deafenedRef.current = next;

    for (const peerId of peersRef.current.keys()) applyPeerVolume(peerId);

    applyLocalAudio();
    setDeafened(next);
    broadcastState();
  }, [applyLocalAudio, applyPeerVolume, broadcastState]);

  const toggleCamera = useCallback(async () => {
    if (!inCallRef.current) return;

    if (cameraOnRef.current) {
      cameraOnRef.current = false;
      setCameraOn(false);

      const camera = cameraStreamRef.current;
      cameraStreamRef.current = null;
      const track = camera?.getVideoTracks()[0] ?? null;
      const local = localStreamRef.current;
      if (track && local) local.removeTrack(track);

      for (const peer of peersRef.current.values()) {
        if (!peer.videoSender) continue;
        try {
          await peer.videoSender.replaceTrack(null);
        } catch {
          // Peer is closing; ignore.
        }
      }

      track?.stop();
      broadcastState();
      return;
    }

    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!inCallRef.current) {
        camera.getTracks().forEach((item) => item.stop());
        return;
      }

      const track = camera.getVideoTracks()[0];
      if (!track) {
        camera.getTracks().forEach((item) => item.stop());
        throw new Error("No camera was found on this device.");
      }

      cameraStreamRef.current = camera;
      cameraOnRef.current = true;

      const local = localStreamRef.current;
      if (local && !local.getVideoTracks().some((item) => item.id === track.id)) {
        local.addTrack(track);
      }

      for (const peer of peersRef.current.values()) {
        if (!peer.videoSender) continue;
        try {
          await peer.videoSender.replaceTrack(track);
        } catch {
          // Peer is closing; ignore.
        }
      }

      setCameraOn(true);
      broadcastState();
    } catch (cause) {
      setError(mediaErrorMessage(cause, "camera"));
    }
  }, [broadcastState]);

  // ---- Per-user audio controls ----------------------------------------------

  const setParticipantVolume = useCallback(
    (participantId: string, volume: number) => {
      const next = Math.max(0, Math.min(200, Math.round(volume)));
      volumesRef.current.set(participantId, next);
      patchParticipant(participantId, { volume: next });
      applyPeerVolume(participantId);
    },
    [applyPeerVolume, patchParticipant],
  );

  const toggleParticipantLocalMute = useCallback(
    (participantId: string) => {
      const mutedSet = localMutedRef.current;
      if (mutedSet.has(participantId)) mutedSet.delete(participantId);
      else mutedSet.add(participantId);
      patchParticipant(participantId, { localMuted: mutedSet.has(participantId) });
      applyPeerVolume(participantId);
    },
    [applyPeerVolume, patchParticipant],
  );

  const setParticipantServerMute = useCallback(
    (participantId: string, value: boolean) => {
      if (!isHostRef.current) return;
      send("mod", { target: participantId, muted: value, by: meRef.current.id });
      applyServerMute(participantId, value);
    },
    [applyServerMute, send],
  );

  // ---- Soundboard ------------------------------------------------------------

  const playSound = useCallback(
    (soundId: string) => {
      if (!inCallRef.current) return;
      const now = Date.now();
      if (now - lastSoundAtRef.current < SOUND_COOLDOWN_MS) return;
      lastSoundAtRef.current = now;
      playCallSound(soundId);
      send("sound", { userId: meRef.current.id, soundId, name: meRef.current.name });
    },
    [send],
  );

  // ---- Breakout rooms (host authoritative) -----------------------------------

  const createBreakoutRoom = useCallback(() => {
    if (!isHostRef.current) return;
    const room: BreakoutRoom = {
      id: randomGuestKey(),
      name: `Room ${roomsRef.current.length + 1}`,
    };
    const nextRooms = [...roomsRef.current, room];
    broadcastRooms(nextRooms, assignmentsRef.current);
    applyRooms(nextRooms, assignmentsRef.current);
  }, [applyRooms, broadcastRooms]);

  const moveParticipantToRoom = useCallback(
    (participantId: string, roomId: string | null) => {
      if (!isHostRef.current) return;
      const nextAssignments: Record<string, string | null> = {
        ...assignmentsRef.current,
        [participantId]: roomId,
      };
      broadcastRooms(roomsRef.current, nextAssignments);
      applyRooms(roomsRef.current, nextAssignments);
    },
    [applyRooms, broadcastRooms],
  );

  const closeBreakoutRooms = useCallback(() => {
    if (!isHostRef.current) return;
    broadcastRooms([], {});
    applyRooms([], {});
  }, [applyRooms, broadcastRooms]);

  // ---- Incoming call ringing -------------------------------------------------

  const stopRinging = useCallback(() => {
    ringtoneHandleRef.current?.stop();
    ringtoneHandleRef.current = null;

    const retry = ringRetryRef.current;
    if (retry) {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      ringRetryRef.current = null;
    }
    if (ringTimeoutRef.current !== null) {
      window.clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    setRingAudioBlocked(false);

    if (titleBeforeRingRef.current !== null && typeof document !== "undefined") {
      document.title = titleBeforeRingRef.current;
      titleBeforeRingRef.current = null;
    }
  }, []);

  const clearIncoming = useCallback(() => {
    incomingCallRef.current = null;
    setIncomingCall(null);
    stopRinging();
  }, [stopRinging]);

  const startRinging = useCallback(() => {
    if (ringtoneHandleRef.current) return;

    if (typeof document !== "undefined" && titleBeforeRingRef.current === null) {
      titleBeforeRingRef.current = document.title;
      document.title = "Incoming call — ZChat";
    }

    const handle = startRingtone((blocked) => setRingAudioBlocked(blocked));
    ringtoneHandleRef.current = handle;

    if (handle.isBlocked()) {
      setRingAudioBlocked(true);
      const retry = () => {
        window.removeEventListener("pointerdown", retry);
        window.removeEventListener("keydown", retry);
        if (ringRetryRef.current === retry) ringRetryRef.current = null;
        handle.resume();
      };
      ringRetryRef.current = retry;
      window.addEventListener("pointerdown", retry);
      window.addEventListener("keydown", retry);
    }

    ringTimeoutRef.current = window.setTimeout(() => clearIncoming(), 45_000);
  }, [clearIncoming]);

  const retryRingtone = useCallback(() => {
    const handle = ringtoneHandleRef.current;
    if (!handle) return;
    handle.resume();
    window.setTimeout(() => setRingAudioBlocked(handle.isBlocked()), 300);
  }, []);

  // Hang up (best effort) and tear everything down when the component unmounts.
  useEffect(() => {
    return () => {
      void leaveCall();
    };
  }, [leaveCall]);

  // Switching conversations or accounts hangs up the current call.
  useEffect(() => {
    if (!inCallRef.current) return;
    if (callConversationRef.current === conversationId && joinedAsRef.current === me.id) return;
    void leaveCall();
  }, [me.id, conversationId, leaveCall]);

  // While the conversation is open and we are not in a call, listen for other
  // people starting one and ring for the recipient. (Never on guest pages.)
  useEffect(() => {
    const self = meRef.current;
    if (!listenForIncoming || !conversationId || !self.id || inCall) return;

    const channel = clientRef.current.channel(`call:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    listenChannelRef.current = channel;

    channel
      .on("broadcast", { event: "join" }, (message) => {
        const payload = asPayload<JoinPayload>(message["payload"]);
        const userId = payload?.userId;
        if (!userId || userId === meRef.current.id || inCallRef.current) return;
        const next = { userId, name: payload?.name ?? "Someone" };
        incomingCallRef.current = next;
        setIncomingCall(next);
        startRinging();
      })
      .on("broadcast", { event: "leave" }, (message) => {
        const payload = asPayload<LeavePayload>(message["payload"]);
        if (payload?.userId && payload.userId === incomingCallRef.current?.userId) {
          clearIncoming();
        }
      })
      .subscribe();

    return () => {
      listenChannelRef.current = null;
      void clientRef.current.removeChannel(channel);
      clearIncoming();
    };
  }, [conversationId, inCall, listenForIncoming, startRinging, clearIncoming]);

  const acceptIncomingCall = useCallback(async () => {
    clearIncoming();
    await joinCall();
  }, [clearIncoming, joinCall]);

  const declineIncomingCall = useCallback(() => {
    const incoming = incomingCallRef.current;
    clearIncoming();
    const channel = listenChannelRef.current;
    if (incoming && channel) {
      try {
        void channel
          .send({
            type: "broadcast",
            event: "decline",
            payload: { userId: meRef.current.id, name: meRef.current.name },
          })
          .catch(() => undefined);
      } catch {
        // Channel not ready; the caller will just see nobody joined.
      }
    }
  }, [clearIncoming]);

  return {
    inCall,
    joining,
    participants,
    localStream,
    remoteStreams,
    muted,
    cameraOn,
    deafened,
    serverMuted,
    error,
    incomingCall,
    isHost: hostId !== null && hostId === me.id,
    hostId,
    isGuest,
    conversationId: activeConversationId,
    myRoomId,
    breakoutRooms,
    guestKey,
    ringAudioBlocked,
    sounds: CALL_SOUNDS,
    joinCall,
    leaveCall,
    acceptIncomingCall,
    declineIncomingCall,
    toggleMute,
    toggleCamera,
    toggleDeafen,
    setParticipantVolume,
    toggleParticipantLocalMute,
    setParticipantServerMute,
    playSound,
    createBreakoutRoom,
    moveParticipantToRoom,
    closeBreakoutRooms,
    ensureGuestKey,
    retryRingtone,
  };
}

export type UseCallResult = ReturnType<typeof useCall>;
