import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { callAudioRunning, getCallAudioContext, resumeCallAudio } from "@/lib/call-audio";
import { buildGuestCallLink } from "@/lib/call-guest";
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
 * kick   { target, by }                        host removes a participant
 * ban    { target, by }                        host bans a participant for the session
 * bans   { ids, by }                           host re-broadcasts the ban list
 * sound  { userId, soundId, name? }            soundboard trigger (synth locally)
 * rooms  { rooms, assignments, by, guestKey? } host breakout-room state
 * leave  { userId }                            graceful disconnect
 * decline{ userId, name }                      recipient declined the ring
 *
 * Moderation: only messages from the currently elected host are honored. A
 * kick makes the target tear its connections down and leave the UI with a
 * notice; a ban makes every client remember the target for the rest of the
 * call session, and any (re)join or offer from a banned id is declined. The
 * ban list lives on every client (and is re-broadcast by the host on join and
 * whenever host election changes), so a newly elected host inherits it.
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
 * Global ringing: every signed-in client also subscribes to its own
 * `call-ring:{userId}` channel. Starting (or joining) a call rings every member
 * of the conversation there, so the recipient rings no matter which
 * conversation is open. Ring payloads carry the conversation id, the caller and
 * the guest key, so accepting joins the right conversation. Callees reply with
 * `ring-accept` / `ring-decline` on the caller's ring channel; a `ring-cancel`
 * stops the ring when the caller leaves with nobody else in the call.
 *
 * Join reliability: the call channel uses broadcast + presence, the join
 * announcement is repeated, every participant re-broadcasts `state` as a
 * heartbeat and both sides re-offer any peer that has no healthy connection
 * (perfect negotiation settles the glare). A watchdog aborts a join that hangs
 * with a clear error instead of an endless "Joining…".
 *
 * Everything Web Audio related (ringtone, per-user volume, soundboard) fails
 * soft: a blocked AudioContext falls back to an <audio> element or a visual
 * prompt and never throws.
 */

/*
 * ICE servers: public STUN plus the self-hosted coturn relay on the black box.
 *
 * TURN credentials are inherently public in a browser bundle (anyone can read
 * them), so this uses a dedicated low-privilege `turnuser` with a random
 * password. It only grants relay allocations. To rotate, change `user=` in
 * /etc/turnserver.conf on the box and update VITE_TURN_CREDENTIAL at build
 * time (the fallback below keeps working without env vars).
 */
const TURN_URL = import.meta.env["VITE_TURN_URL"] || "turn:94.203.142.158:3478";
const TURN_USERNAME = import.meta.env["VITE_TURN_USERNAME"] || "turnuser";
const TURN_CREDENTIAL =
  import.meta.env["VITE_TURN_CREDENTIAL"] || "46a26cc4db1c704ebfd17a4b20b4d5ec";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  {
    // UDP first (fast path), TCP as a fallback for UDP-hostile networks.
    urls: [`${TURN_URL}?transport=udp`, `${TURN_URL}?transport=tcp`],
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
];

/*
 * Cloudflare global TURN (minted at call time from /api/turn-credentials).
 * This is what makes international calls work without any router port
 * forwarding: Cloudflare relays over plain TURN ports plus TLS 443, which
 * passes through virtually every home and mobile network. The self-hosted
 * coturn stays as a fallback for the cases it can serve.
 */
let dynamicIceCache: { servers: RTCIceServer[]; at: number } | null = null;

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (dynamicIceCache && Date.now() - dynamicIceCache.at < 15 * 60_000) {
    return dynamicIceCache.servers;
  }
  try {
    const response = await fetch("/api/turn-credentials", {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return ICE_SERVERS;
    const data: unknown = await response.json();
    const rawList =
      data && typeof data === "object"
        ? (data as { iceServers?: unknown }).iceServers
        : undefined;
    const list = Array.isArray(rawList) ? (rawList as RTCIceServer[]) : [];
    const usable = list.filter(
      (entry) => entry && (typeof entry.urls === "string" || Array.isArray(entry.urls)),
    );
    if (!usable.length) return ICE_SERVERS;
    const servers = [...usable, ...ICE_SERVERS];
    dynamicIceCache = { servers, at: Date.now() };
    return servers;
  } catch {
    return ICE_SERVERS;
  }
}

const CHANNEL_TIMEOUT_MS = 15_000;
/** Give a fresh offer time to finish ICE gathering/checks before rebuilding. */
const CONNECT_GRACE_MS = 15_000;
/** Hard cap on a join attempt; surfaces an error instead of an endless "Joining…". */
const JOIN_WATCHDOG_MS = 30_000;
/** Announcements of my own join; retried in case a `join` raced the subscription. */
const JOIN_ANNOUNCE_DELAYS_MS = [0, 1_500, 4_000];
/** Periodic state broadcast: presence for late joiners, mute/camera sync, re-offers. */
const HEARTBEAT_MS = 5_000;
/** Don't retry the same peer connection more often than this. */
const CONNECT_THROTTLE_MS = 2_500;
/** Glare guard: the higher id waits this long before also offering. */
const POLITE_WAIT_MS = 1_200;
/** Wait after ICE disconnects before rebuilding the peer connection. */
const ICE_DISCONNECT_GRACE_MS = 6_000;
const RING_CHANNEL_PREFIX = "call-ring:";

/** Minimum gap between soundboard triggers, to keep spam manageable. */
const SOUND_COOLDOWN_MS = 400;

export type CallParticipant = {
  id: string;
  name: string;
  muted: boolean;
  video: boolean;
  /** True while this participant is sharing their screen (broadcast). */
  sharing: boolean;
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
  /**
   * Ring the conversation members when this client joins a call. Defaults to
   * true; the shared /call link sets it false because the link already told
   * the joiner about the call.
   */
  ringOnJoin?: boolean;
  /**
   * Called when an incoming call is accepted and belongs to another
   * conversation; lets the host app switch the UI to that conversation.
   * Optional: calls still connect without it.
   */
  onSwitchConversation?: (conversationId: string) => void;
};

/** An incoming call announced over the global `call-ring:{userId}` channel. */
export type IncomingCall = {
  /** Caller user id (reply target for accept/decline). */
  userId: string;
  name: string;
  /** Conversation the call belongs to. */
  conversationId: string;
  /** Conversation label when the caller could resolve one (groups mostly). */
  conversationTitle: string | null;
  /** Guest key the caller shared, if any. */
  guestKey: string | null;
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
  sharing?: boolean;
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
type KickPayload = { target?: string; by?: string; name?: string };
type BanPayload = { target?: string; by?: string; name?: string };
type BansPayload = { ids?: unknown; by?: string };
type SoundPayload = { userId?: string; soundId?: string; name?: string };
type RoomsPayload = {
  rooms?: BreakoutRoom[];
  assignments?: Record<string, string | null>;
  by?: string;
  guestKey?: string | null;
};

type RingPayload = {
  conversationId?: string;
  callerId?: string;
  callerName?: string;
  title?: string | null;
  key?: string | null;
  joinedAt?: number;
};
type RingCancelPayload = { conversationId?: string; callerId?: string };
type RingDeclinePayload = {
  conversationId?: string;
  userId?: string;
  name?: string;
  reason?: "busy" | "declined";
};
type RingAcceptPayload = { conversationId?: string; userId?: string; name?: string };
type PresenceMeta = { userId?: string; name?: string; joinedAt?: number };

type Peer = {
  pc: RTCPeerConnection;
  /** Hidden <audio> fallback that plays this peer's remote stream. */
  audioEl: HTMLAudioElement | null;
  /** Single remote MediaStream for this peer, fed by `ontrack`. */
  stream: MediaStream;
  /** Sender for the up-front video transceiver; camera tracks are swapped in here. */
  videoSender: RTCRtpSender | null;
  /** The video transceiver those camera tracks belong to (the negotiated m-line). */
  videoTransceiver: RTCRtpTransceiver | null;
  /** Web Audio graph used for 0-200% volume (null when unavailable). */
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  name: string;
  /** True while an offer is being created/sent (perfect-negotiation glare flag). */
  makingOffer: boolean;
  /** Pending rebuild timer after an ICE disconnect. */
  disconnectTimer: number | null;
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
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [ringAudioBlocked, setRingAudioBlocked] = useState(false);
  const [hostId, setHostId] = useState<string | null>(null);
  const [guestKey, setGuestKey] = useState<string | null>(options?.guestKey ?? null);
  const [myRoomId, setMyRoomId] = useState<string | null>(null);
  const [breakoutRooms, setBreakoutRooms] = useState<BreakoutRoom[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  /** Moderation notice ("You were removed…" / "You are banned…"). */
  const [notice, setNotice] = useState<string | null>(null);

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
  /** Late-bound renegotiation helper (defined after `offerPeer`). */
  const negotiatePeerRef = useRef<(peerId: string) => void>(() => {});
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const pageHideRef = useRef<(() => void) | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const ringtoneHandleRef = useRef<RingtoneHandle | null>(null);
  const ringRetryRef = useRef<(() => void) | null>(null);
  const ringTimeoutRef = useRef<number | null>(null);
  const titleBeforeRingRef = useRef<string | null>(null);
  const unlockAudioRef = useRef<(() => void) | null>(null);

  // Global ring plumbing (`call-ring:{userId}`).
  const ringInRef = useRef<RealtimeChannel | null>(null);
  const ringOutRef = useRef(new Map<string, { channel: RealtimeChannel; ready: boolean }>());
  const ringTargetsRef = useRef<string[]>([]);
  const ringSessionRef = useRef(0);
  const ringDeclinedAtRef = useRef(0);

  // Join / connection health.
  const joinAttemptRef = useRef(0);
  const joinWatchdogRef = useRef<number | null>(null);
  const joinAnnounceTimersRef = useRef<number[]>([]);
  const heartbeatRef = useRef<number | null>(null);
  const connectAttemptsRef = useRef(new Map<string, number>());
  const remoteAcceptedRef = useRef(false);
  const onSwitchConversationRef = useRef(options?.onSwitchConversation);
  onSwitchConversationRef.current = options?.onSwitchConversation;

  const inCallRef = useRef(false);
  const joiningRef = useRef(false);
  const mutedRef = useRef(false);
  const cameraOnRef = useRef(false);
  const screenSharingRef = useRef(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(ICE_SERVERS);
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
  /** Ids banned for the lifetime of the current call session. */
  const bannedRef = useRef(new Set<string>());
  /** Local block for rejoining a call this client was banned from (same page). */
  const selfBanRef = useRef<{ conversationId: string; message: string } | null>(null);
  const ringOnJoinRef = useRef(options?.ringOnJoin !== false);
  ringOnJoinRef.current = options?.ringOnJoin !== false;
  /** Late-bound `leaveCall` so moderation handlers can tear the call down. */
  const leaveCallRef = useRef<() => void>(() => {});

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      void channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
    } catch {
      // `_push` throws when the channel has not finished joining; drop the event.
    }
  }, []);

  /**
   * Host: re-broadcast the full ban list. Sent to every participant on join
   * (so late joiners learn the bans) and whenever host election picks a new
   * host, so moderation state survives the previous host leaving.
   */
  const broadcastBans = useCallback(() => {
    if (!isHostRef.current) return;
    send("bans", { ids: [...bannedRef.current], by: meRef.current.id });
  }, [send]);

  /**
   * Broadcasts an event to another user's personal ring channel. Channels are
   * cached per target and sends are retried briefly while the channel joins, so
   * a ring is not lost just because the target's socket was still connecting.
   */
  const sendRing = useCallback(
    (userId: string, event: string, payload: Record<string, unknown>) => {
      if (!userId || userId === meRef.current.id) return;

      let entry = ringOutRef.current.get(userId);
      if (!entry) {
        const channel = clientRef.current.channel(`${RING_CHANNEL_PREFIX}${userId}`, {
          config: { broadcast: { self: false } },
        });
        const created = { channel, ready: false };
        ringOutRef.current.set(userId, created);
        entry = created;
        channel.subscribe((status) => {
          if (ringOutRef.current.get(userId) !== created) return;
          if (status === "SUBSCRIBED") {
            created.ready = true;
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            ringOutRef.current.delete(userId);
            void clientRef.current.removeChannel(channel);
          }
        });
      }

      const active = entry;
      const push = (attempt: number) => {
        if (ringOutRef.current.get(userId) !== active) return;
        try {
          void active.channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
        } catch {
          // Channel still joining; retried below.
        }
        if (!active.ready && attempt < 3) {
          window.setTimeout(() => push(attempt + 1), 700);
        }
      };
      push(0);
    },
    [],
  );

  const resolveCallTitle = useCallback(
    async (targetConversation: string): Promise<string | null> => {
      try {
        const { data } = await clientRef.current
          .from("conversations")
          .select("name")
          .eq("id", targetConversation)
          .maybeSingle();
        const row = data as { name?: string | null } | null;
        return row?.name ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Rings every other member of the conversation on their personal ring
   * channel. Sent when this client starts (or answers) a call, retried once in
   * case `join` raced the recipient's subscription.
   */
  const ringConversationMembers = useCallback(
    async (targetConversation: string) => {
      if (isGuestRef.current || !targetConversation) return;
      const self = meRef.current;
      const session = ++ringSessionRef.current;

      let ids: string[] = [];
      let title: string | null = null;
      try {
        const [membersResult, resolvedTitle] = await Promise.all([
          clientRef.current
            .from("conversation_members")
            .select("user_id")
            .eq("conversation_id", targetConversation),
          resolveCallTitle(targetConversation),
        ]);
        title = resolvedTitle;
        const rows = (membersResult.data ?? []) as Array<{ user_id?: string }>;
        ids = Array.from(
          new Set(
            rows.map((row) => row.user_id).filter((id): id is string => !!id && id !== self.id),
          ),
        );
      } catch {
        return;
      }

      ringTargetsRef.current = ids;
      const payload = {
        conversationId: targetConversation,
        callerId: self.id,
        callerName: self.name,
        title,
        joinedAt: myJoinedAtRef.current,
      };
      const stillValid = () =>
        ringSessionRef.current === session &&
        inCallRef.current &&
        callConversationRef.current === targetConversation;

      for (const id of ids) sendRing(id, "ring", payload);
      window.setTimeout(() => {
        if (!stillValid()) return;
        for (const id of ids) sendRing(id, "ring", payload);
      }, 2_000);
      window.setTimeout(() => {
        if (!stillValid()) return;
        for (const id of ids) sendRing(id, "ring", payload);
      }, 5_000);
    },
    [resolveCallTitle, sendRing],
  );

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
    sharing: patch.sharing ?? false,
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
      // A newly elected host inherits the ban list every client kept; publish
      // it so participants that joined late (or missed the original ban)
      // converge on the same moderation state.
      if (isHostRef.current) broadcastBans();
    }
  }, [broadcastBans]);

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
      // Autoplay can be rejected before the first user gesture; retry quietly
      // on every volume/state application (which follows gestures too).
      if (peer.audioEl.paused) void peer.audioEl.play().catch(() => undefined);
    }
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;

      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);
      connectAttemptsRef.current.delete(peerId);

      if (peer.disconnectTimer !== null) {
        window.clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = null;
      }

      try {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onnegotiationneeded = null;
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

  /** Forgets a participant and tears down its connection (kick / ban / leave). */
  const dropParticipant = useCallback(
    (participantId: string) => {
      if (!participantId) return;
      volumesRef.current.delete(participantId);
      localMutedRef.current.delete(participantId);
      if (peersRef.current.has(participantId)) closePeer(participantId);
      if (knownRef.current.delete(participantId)) commitParticipants();
      recomputeHost();
    },
    [closePeer, commitParticipants, recomputeHost],
  );

  /** Adds an id to the session ban list and drops it from the call. */
  const applyBan = useCallback(
    (participantId: string) => {
      if (!participantId) return;
      const wasKnown = bannedRef.current.has(participantId);
      bannedRef.current.add(participantId);
      dropParticipant(participantId);
      if (!wasKnown && hostIdRef.current) broadcastBans();
    },
    [broadcastBans, dropParticipant],
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

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const stream = new MediaStream();
      const peer: Peer = {
        pc,
        stream,
        videoSender: null,
        videoTransceiver: null,
        audioEl: null,
        gain: null,
        source: null,
        name: name ?? "Someone",
        makingOffer: false,
        disconnectTimer: null,
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
      peer.videoTransceiver = transceiver;

      const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack && peer.videoSender) {
        void peer.videoSender.replaceTrack(cameraTrack).catch(() => undefined);
      }

      // A late media change (e.g. a camera track swapped into a transceiver
      // the remote never negotiated) must be re-offered, otherwise the other
      // side never learns about it. The initial offer is sent explicitly by
      // offerPeer, so only renegotiate once a remote description exists.
      pc.onnegotiationneeded = () => {
        if (!pc.remoteDescription) return;
        negotiatePeerRef.current(peerId);
      };

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

      // An ICE "disconnected" often recovers on its own; if it does not, the
      // connection is torn down so the heartbeat/presence sync can rebuild it.
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === "connected" || state === "completed") {
          if (peer.disconnectTimer !== null) {
            window.clearTimeout(peer.disconnectTimer);
            peer.disconnectTimer = null;
          }
          return;
        }
        if (state === "failed") {
          closePeer(peerId);
          return;
        }
        if (state === "disconnected" && peer.disconnectTimer === null) {
          peer.disconnectTimer = window.setTimeout(() => {
            peer.disconnectTimer = null;
            if (peersRef.current.get(peerId) !== peer) return;
            const current = peer.pc.iceConnectionState;
            if (current === "disconnected" || current === "failed") closePeer(peerId);
          }, ICE_DISCONNECT_GRACE_MS);
        }
      };

      peersRef.current.set(peerId, peer);
      // Any freshly created connection (offerer *or* answerer) gets a grace
      // window: the answerer never goes through maybeConnectPeer before its
      // answer, so without this a duplicate join announcement could tear the
      // just-negotiated connection down again.
      connectAttemptsRef.current.set(peerId, Date.now());
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
      // A duplicate/parallel attempt while we are already negotiating must not
      // tear the connection down.
      if (peer.makingOffer || peer.pc.signalingState !== "stable") return;
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

  /**
   * Renegotiates an already-connected peer: used when local media changed in a
   * way the negotiated SDP does not cover (camera track swapped into a
   * transceiver the remote never accepted). Follows the same polite/impolite
   * tie-break as the initial connect so simultaneous renegotiations resolve.
   */
  const negotiatePeer = useCallback(
    async (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer || !inCallRef.current) return;
      if (peer.makingOffer || peer.pc.signalingState !== "stable") return;
      if (meRef.current.id > peerId) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, POLITE_WAIT_MS));
        if (peersRef.current.get(peerId) !== peer || !inCallRef.current) return;
        if (peer.makingOffer || peer.pc.signalingState !== "stable") return;
      }
      await offerPeer(peerId, peer.name);
    },
    [offerPeer],
  );
  negotiatePeerRef.current = negotiatePeer;

  /**
   * Connects to a peer if there is no healthy connection yet. Called on join,
   * on every heartbeat `state` and on presence sync, so a missed `join`
   * broadcast or a refreshed peer still converges. The higher user id waits a
   * beat before also offering; perfect negotiation resolves any overlap.
   */
  const maybeConnectPeer = useCallback(
    async (peerId: string, name?: string, options?: { force?: boolean }) => {
      const self = meRef.current;
      if (!inCallRef.current || !peerId || peerId === self.id) return;
      if ((assignmentsRef.current[peerId] ?? null) !== myRoomIdRef.current) return;

      const hasHealthyPeer = () => {
        const current = peersRef.current.get(peerId);
        if (!current) return false;
        const state = current.pc.connectionState;
        if (current.pc.signalingState !== "stable" || state === "connected") return true;
        if (state === "connecting") return true;
        if (
          state === "failed" ||
          state === "closed" ||
          current.pc.iceConnectionState === "failed"
        ) {
          return false;
        }
        // A brand-new connection may still be gathering candidates or running
        // its first ICE checks. Give it a grace window instead of tearing it
        // down and restarting from scratch (duplicate join announcements used
        // to do exactly that, which broke camera/audio setup mid-handshake).
        const lastAttempt = connectAttemptsRef.current.get(peerId) ?? 0;
        return state === "new" && Date.now() - lastAttempt < CONNECT_GRACE_MS;
      };
      // `force` only bypasses the retry throttle; it never tears down a
      // connection that is alive or being negotiated.
      if (hasHealthyPeer()) return;

      const lastAttempt = connectAttemptsRef.current.get(peerId) ?? 0;
      if (!options?.force && Date.now() - lastAttempt < CONNECT_THROTTLE_MS) return;

      if (!options?.force && self.id > peerId) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, POLITE_WAIT_MS));
        if (!inCallRef.current) return;
        if (hasHealthyPeer()) return;
      }

      connectAttemptsRef.current.set(peerId, Date.now());
      if (peersRef.current.get(peerId)) closePeer(peerId);
      await offerPeer(peerId, name);
    },
    [closePeer, offerPeer],
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
      sharing: screenSharingRef.current,
      deafened: deafenedRef.current,
      serverMuted: serverMutedRef.current,
      guest: isGuestRef.current,
      joinedAt: myJoinedAtRef.current,
      roomId: myRoomIdRef.current,
      host: isHostRef.current,
      ...(isHostRef.current && guestKeyRef.current ? { guestKey: guestKeyRef.current } : {}),
    });
  }, [send]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  /**
   * Periodic `state` broadcast plus a reconnect sweep. This keeps presence,
   * mute/camera flags and connections in sync when the other side joins late,
   * refreshes, or a single broadcast was lost.
   */
  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatRef.current = window.setInterval(() => {
      if (!inCallRef.current) return;
      broadcastState();
      for (const participant of [...knownRef.current.values()]) {
        if (participant.id === meRef.current.id) continue;
        void maybeConnectPeer(participant.id, participant.name);
      }
    }, HEARTBEAT_MS);
  }, [broadcastState, maybeConnectPeer, stopHeartbeat]);

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

      // Banned participants are never re-admitted. The host reminds the
      // banned client (which may have reloaded and lost its local ban list),
      // so it leaves the UI with the ban notice instead of hanging.
      if (bannedRef.current.has(userId)) {
        if (isHostRef.current) send("ban", { target: userId, by: self.id });
        return;
      }

      if (data.guest === true || data.key) {
        const expected = guestKeyRef.current;
        // A joiner that carries a link key (guest, or a signed-in user who
        // opened /call/<id>?k=...) must present the exact invite key once any
        // participant knows it.
        if (expected && data.key !== expected) return;
      }

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
        // Bring the newcomer up to date on breakouts, invites and bans.
        broadcastRooms(roomsRef.current, assignmentsRef.current);
        if (guestKeyRef.current) broadcastState();
        if (bannedRef.current.size > 0) broadcastBans();
      }

      // Peers in other breakout rooms stay disconnected.
      if (theirRoom !== myRoomIdRef.current) return;

      // A peer re-announcing after a reload: the old connection is dead but may
      // not have flipped to "failed" yet, so rebuild it explicitly (the healthy
      // / still-negotiating checks live in maybeConnectPeer).
      await maybeConnectPeer(userId, data.name, { force: true });
    },
    [
      broadcastBans,
      broadcastRooms,
      broadcastState,
      maybeConnectPeer,
      patchParticipant,
      recomputeHost,
      send,
    ],
  );

  const handleOffer = useCallback(
    async (data: OfferPayload | null) => {
      const self = meRef.current;
      if (!data?.from || !data.sdp || !inCallRef.current) return;
      if (data.to && data.to !== self.id) return;
      if (data.from === self.id) return;
      if (bannedRef.current.has(data.from)) return;
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

        // The remote offer is what actually negotiates the video m-line. Adopt
        // the transceiver Chrome associated with it (the one that has a mid),
        // so camera toggles always replaceTrack into the *negotiated* sender.
        // A stray local transceiver the remote never accepted is stopped: it
        // would otherwise send camera frames into the void.
        const videoTransceivers = peer.pc
          .getTransceivers()
          .filter((item) => item.receiver.track?.kind === "video");
        const negotiatedVideo =
          videoTransceivers.find((item) => item.mid !== null) ?? videoTransceivers[0] ?? null;
        if (negotiatedVideo) {
          peer.videoTransceiver = negotiatedVideo;
          peer.videoSender = negotiatedVideo.sender;
          try {
            negotiatedVideo.direction = "sendrecv";
          } catch {
            // Some browsers reject direction changes; replaceTrack still works.
          }
          for (const stray of videoTransceivers) {
            if (stray === negotiatedVideo || stray.mid !== null) continue;
            try {
              stray.stop();
            } catch {
              // Already stopped.
            }
          }
          const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack) {
            void negotiatedVideo.sender.replaceTrack(cameraTrack).catch(() => undefined);
          }
        }

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
        sharing: data.sharing === true,
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

      // A heartbeat from a late-joining or refreshed participant: make sure we
      // have a live connection to them.
      if (inCallRef.current) void maybeConnectPeer(data.userId, data.name);
    },
    [maybeConnectPeer, patchParticipant, recomputeHost],
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

  /** Host kicked a participant: everyone drops it, the target leaves. */
  const handleKick = useCallback(
    (data: KickPayload | null) => {
      if (!data?.target || !data.by) return;
      if (data.by === meRef.current.id) return;
      // Only the current host's kick is honored.
      if (hostIdRef.current && data.by !== hostIdRef.current) return;

      if (data.target === meRef.current.id) {
        const message = "You were removed from this call";
        setNotice(message);
        setError(null);
        toast.error(message);
        leaveCallRef.current();
        return;
      }
      dropParticipant(data.target);
    },
    [dropParticipant],
  );

  /** Host banned a participant for the rest of the call session. */
  const handleBan = useCallback(
    (data: BanPayload | null) => {
      if (!data?.target || !data.by) return;
      if (data.by === meRef.current.id) return;
      if (hostIdRef.current && data.by !== hostIdRef.current) return;

      if (data.target === meRef.current.id) {
        const message = "You are banned from this call";
        bannedRef.current.add(meRef.current.id);
        const conversation = callConversationRef.current;
        if (conversation) selfBanRef.current = { conversationId: conversation, message };
        setNotice(message);
        setError(null);
        toast.error(message);
        leaveCallRef.current();
        return;
      }
      applyBan(data.target);
    },
    [applyBan],
  );

  /** Host re-broadcast of the full ban list (on join / host election). */
  const handleBans = useCallback(
    (data: BansPayload | null) => {
      if (!data?.by || !Array.isArray(data.ids)) return;
      if (data.by === meRef.current.id) return;
      if (hostIdRef.current && data.by !== hostIdRef.current) return;

      for (const id of data.ids) {
        if (typeof id !== "string" || !id || bannedRef.current.has(id)) continue;
        if (id === meRef.current.id) {
          const message = "You are banned from this call";
          bannedRef.current.add(id);
          const conversation = callConversationRef.current;
          if (conversation) selfBanRef.current = { conversationId: conversation, message };
          setNotice(message);
          toast.error(message);
          leaveCallRef.current();
          continue;
        }
        applyBan(id);
      }
    },
    [applyBan],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const handleSound = useCallback((data: SoundPayload | null) => {
    if (!data?.soundId || data.userId === meRef.current.id) return;
    playCallSound(data.soundId);
  }, []);

  // ---- Lifecycle -------------------------------------------------------------

  const teardown = useCallback(() => {
    // Cancel any in-flight join and periodic work first, so nothing resurrects
    // the call after this teardown.
    joinAttemptRef.current += 1;
    stopHeartbeat();
    for (const timer of joinAnnounceTimersRef.current) window.clearTimeout(timer);
    joinAnnounceTimersRef.current = [];
    if (joinWatchdogRef.current !== null) {
      window.clearTimeout(joinWatchdogRef.current);
      joinWatchdogRef.current = null;
    }

    for (const entry of ringOutRef.current.values()) {
      void clientRef.current.removeChannel(entry.channel);
    }
    ringOutRef.current.clear();
    ringTargetsRef.current = [];
    ringSessionRef.current += 1;
    connectAttemptsRef.current.clear();

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
    // Session bans only live for one call; the local block against rejoining a
    // call this client was banned from (selfBanRef) intentionally survives so
    // the rejoin attempt is declined immediately.
    bannedRef.current.clear();

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
  }, [closePeer, stopHeartbeat]);

  const joinCall = useCallback(
    async (targetConversationOverride?: string | null) => {
      const self = meRef.current;
      const targetConversation = targetConversationOverride ?? conversationIdRef.current;
      if (!targetConversation || !self.id || inCallRef.current || joiningRef.current) return;

      // A client banned from this call stays banned for the page session; the
      // link/rejoin path is declined immediately with the same notice. (A full
      // reload loses this local block and the host re-bans on the next join.)
      if (selfBanRef.current && selfBanRef.current.conversationId === targetConversation) {
        setError(null);
        setNotice(selfBanRef.current.message);
        return;
      }

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("This browser does not support calls.");
        return;
      }

      const attempt = ++joinAttemptRef.current;
      const cancelled = () => joinAttemptRef.current !== attempt;

      joiningRef.current = true;
      setJoining(true);
      setError(null);
      setNotice(null);
      myJoinedAtRef.current = Date.now();

      // Watchdog: never leave the UI stuck on "Joining…".
      joinWatchdogRef.current = window.setTimeout(() => {
        if (!joiningRef.current || joinAttemptRef.current !== attempt) return;
        joinAttemptRef.current += 1; // cancels the in-flight attempt
        joiningRef.current = false;
        setJoining(false);
        setError(
          "Couldn't join the call — the connection timed out. Check your microphone permission and try again.",
        );
        const stalled = channelRef.current;
        channelRef.current = null;
        if (stalled) void clientRef.current.removeChannel(stalled);
        const stalledStream = localStreamRef.current;
        if (stalledStream) {
          stalledStream.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
        }
      }, JOIN_WATCHDOG_MS);

      let channel: RealtimeChannel | null = null;

      try {
        // Joining is a user gesture: unlock Web Audio here so remote volume and
        // the soundboard work immediately.
        void resumeCallAudio();

        // Refresh the relay configuration for this call before any peer exists.
      iceServersRef.current = await loadIceServers();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Noise suppression for mics: echo cancellation, background-noise
          // suppression and auto gain are all on by default now.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
        if (cancelled()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;

        const targetChannel = clientRef.current.channel(`call:${targetConversation}`, {
          config: { broadcast: { self: false }, presence: { key: self.id } },
        });
        channel = targetChannel;
        channelRef.current = targetChannel;

        targetChannel
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
          .on("broadcast", { event: "kick" }, (message) => {
            handleKick(asPayload<KickPayload>(message["payload"]));
          })
          .on("broadcast", { event: "ban" }, (message) => {
            handleBan(asPayload<BanPayload>(message["payload"]));
          })
          .on("broadcast", { event: "bans" }, (message) => {
            handleBans(asPayload<BansPayload>(message["payload"]));
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
          })
          // Presence is how late joiners (and clients whose `join` broadcast
          // was lost) discover each other and repair the mesh.
          .on("presence", { event: "sync" }, () => {
            if (channelRef.current !== targetChannel || !inCallRef.current) return;
            let presence: Record<string, PresenceMeta[]> = {};
            try {
              presence = targetChannel.presenceState<PresenceMeta>();
            } catch {
              return;
            }
            for (const [peerId, metas] of Object.entries(presence)) {
              if (peerId === self.id) continue;
              const meta = metas[0];
              if (!meta) continue;
              patchParticipant(peerId, {
                ...(meta.name ? { name: meta.name } : {}),
                ...(typeof meta.joinedAt === "number" && meta.joinedAt > 0
                  ? { joinedAt: meta.joinedAt }
                  : {}),
              });
              void maybeConnectPeer(peerId, meta.name);
            }
          })
          .on("presence", { event: "leave" }, ({ leftPresences }) => {
            for (const presence of leftPresences ?? []) {
              const peerId = presence["userId"];
              if (!peerId || peerId === self.id) continue;
              volumesRef.current.delete(peerId);
              localMutedRef.current.delete(peerId);
              closePeer(peerId);
              knownRef.current.delete(peerId);
              commitParticipants();
              recomputeHost();
            }
          });

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("Could not connect to the call."));
          }, CHANNEL_TIMEOUT_MS);

          targetChannel.subscribe((status) => {
            if (settled) return;
            if (status === "SUBSCRIBED") {
              settled = true;
              window.clearTimeout(timer);
              void targetChannel
                .track({ userId: self.id, name: self.name, joinedAt: myJoinedAtRef.current })
                .catch(() => undefined);
              resolve();
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              settled = true;
              window.clearTimeout(timer);
              reject(new Error("Could not connect to the call."));
            }
          });
        });

        if (cancelled()) return;

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

        // Repeated announcements: a single `join` can race the others'
        // subscriptions, so send it a few times; the heartbeat continues after.
        const announce = () => {
          if (cancelled() || !inCallRef.current) return;
          send("join", {
            userId: self.id,
            name: self.name,
            host: isHostRef.current,
            guest: isGuestRef.current,
            joinedAt: myJoinedAtRef.current,
            roomId: myRoomIdRef.current,
            ...(guestKeyRef.current ? { key: guestKeyRef.current } : {}),
          });
          broadcastState();
        };
        joinAnnounceTimersRef.current = JOIN_ANNOUNCE_DELAYS_MS.map((delay) =>
          window.setTimeout(announce, delay),
        );

        startHeartbeat();

        if (isHostRef.current) ensureGuestKey();
        // Tell the members of this conversation on their personal ring channel
        // (skipped for link joins, who were already told by the link).
        if (!isGuestRef.current && ringOnJoinRef.current) {
          void ringConversationMembers(targetConversation);
        }
      } catch (cause) {
        if (cancelled()) {
          // The watchdog or teardown already cleaned up and set the error.
          const stalled = channelRef.current;
          channelRef.current = null;
          if (stalled) void clientRef.current.removeChannel(stalled);
          return;
        }

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
        if (joinAttemptRef.current === attempt) {
          joiningRef.current = false;
          setJoining(false);
        }
        if (joinWatchdogRef.current !== null) {
          window.clearTimeout(joinWatchdogRef.current);
          joinWatchdogRef.current = null;
        }
      }
    },
    [
      applyPeerVolume,
      broadcastState,
      closePeer,
      commitParticipants,
      ensureGuestKey,
      handleAnswer,
      handleBan,
      handleBans,
      handleIce,
      handleJoin,
      handleKick,
      handleLeave,
      handleMod,
      handleOffer,
      handleRooms,
      handleSound,
      handleState,
      maybeConnectPeer,
      patchParticipant,
      recomputeHost,
      ringConversationMembers,
      send,
      startHeartbeat,
    ],
  );

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

    // If nobody else is connected, the call is over: stop distant ringers.
    if (!isGuestRef.current && callConversationRef.current && peersRef.current.size === 0) {
      const payload = { conversationId: callConversationRef.current, callerId: meRef.current.id };
      for (const target of ringTargetsRef.current) sendRing(target, "ring-cancel", payload);
    }

    teardown();
  }, [sendRing, teardown]);
  leaveCallRef.current = () => {
    void leaveCall();
  };

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
    if (screenSharingRef.current) {
      toast.info("Stop screen sharing first to use the camera");
      return;
    }

    if (cameraOnRef.current) {
      cameraOnRef.current = false;
      setCameraOn(false);

      const camera = cameraStreamRef.current;
      cameraStreamRef.current = null;
      const track = camera?.getVideoTracks()[0] ?? null;
      const local = localStreamRef.current;
      if (track && local) local.removeTrack(track);

      for (const peer of peersRef.current.values()) {
        const sender = peer.videoTransceiver?.sender ?? peer.videoSender;
        if (!sender) continue;
        try {
          await sender.replaceTrack(null);
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

      const renegotiate: string[] = [];
      for (const [peerId, peer] of peersRef.current.entries()) {
        const sender = peer.videoTransceiver?.sender ?? peer.videoSender;
        if (!sender) continue;
        try {
          await sender.replaceTrack(track);
        } catch {
          // Peer is closing; ignore.
        }
        // If the peer never negotiated this video m-line (e.g. a connection
        // that was re-created mid-call), replaceTrack alone sends nothing:
        // the offer/answer has to be redone. That is the "turning the camera
        // on later does nothing on the other side" bug.
        const transceiver = peer.videoTransceiver;
        const current = transceiver?.currentDirection ?? null;
        if (
          !transceiver ||
          transceiver.mid === null ||
          current === null ||
          current === "inactive" ||
          current === "recvonly"
        ) {
          renegotiate.push(peerId);
        }
      }

      setCameraOn(true);
      broadcastState();
      for (const peerId of renegotiate) negotiatePeerRef.current(peerId);
    } catch (cause) {
      setError(mediaErrorMessage(cause, "camera"));
    }
  }, [broadcastState]);

  /** Stops an active screen share and hands the video track back to the camera. */
  const stopScreenShare = useCallback(() => {
    if (!screenSharingRef.current) return;
    screenSharingRef.current = false;
    setScreenSharing(false);

    const display = screenStreamRef.current;
    screenStreamRef.current = null;
    setScreenStream(null);
    display?.getTracks().forEach((item) => item.stop());

    const restore =
      (cameraOnRef.current ? cameraStreamRef.current?.getVideoTracks()[0] : null) ?? null;
    for (const peer of peersRef.current.values()) {
      const sender = peer.videoTransceiver?.sender ?? peer.videoSender;
      if (!sender) continue;
      void sender.replaceTrack(restore).catch(() => undefined);
    }
    broadcastState();
  }, [broadcastState]);

  const toggleScreenShare = useCallback(async () => {
    if (!inCallRef.current) return;

    if (screenSharingRef.current) {
      stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen sharing is not supported in this browser");
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (!inCallRef.current) {
        display.getTracks().forEach((item) => item.stop());
        return;
      }
      const track = display.getVideoTracks()[0];
      if (!track) {
        display.getTracks().forEach((item) => item.stop());
        throw new Error("No screen was selected");
      }

      // Stopping from the browser's own "Stop sharing" bar ends the track.
      track.addEventListener("ended", () => {
        if (screenSharingRef.current) stopScreenShare();
      });

      screenStreamRef.current = display;
      screenSharingRef.current = true;

      const renegotiate: string[] = [];
      for (const [peerId, peer] of peersRef.current.entries()) {
        const sender = peer.videoTransceiver?.sender ?? peer.videoSender;
        if (!sender) continue;
        try {
          await sender.replaceTrack(track);
        } catch {
          // Peer is closing; ignore.
        }
        // Same rule as the camera path: a peer that never negotiated this
        // video m-line needs a fresh offer before frames flow.
        const transceiver = peer.videoTransceiver;
        const current = transceiver?.currentDirection ?? null;
        if (
          !transceiver ||
          transceiver.mid === null ||
          current === null ||
          current === "inactive" ||
          current === "recvonly"
        ) {
          renegotiate.push(peerId);
        }
      }

      setScreenSharing(true);
      setScreenStream(display);
      broadcastState();
      for (const peerId of renegotiate) negotiatePeerRef.current(peerId);
    } catch (cause) {
      // User cancelled the picker, or the browser blocked it.
      const name = cause instanceof DOMException ? cause.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        toast.error("Could not start screen sharing");
      }
    }
  }, [broadcastState, stopScreenShare]);

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

  /** Host action: remove a participant from the call. They may rejoin. */
  const kickParticipant = useCallback(
    (participantId: string) => {
      if (!isHostRef.current || !participantId || participantId === meRef.current.id) return;
      send("kick", { target: participantId, by: meRef.current.id });
      dropParticipant(participantId);
      toast.success("Participant removed from the call");
    },
    [dropParticipant, send],
  );

  /** Host action: ban a participant for the rest of the call session. */
  const banParticipant = useCallback(
    (participantId: string) => {
      if (!isHostRef.current || !participantId || participantId === meRef.current.id) return;
      send("ban", { target: participantId, by: meRef.current.id });
      applyBan(participantId);
      broadcastBans();
      toast.success("Participant banned from this call");
    },
    [applyBan, broadcastBans, send],
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

  // Switching conversations or accounts hangs up the current call — unless the
  // call was accepted from an incoming ring while another conversation was
  // open, in which case it keeps running in the background.
  useEffect(() => {
    if (!inCallRef.current) return;
    if (callConversationRef.current === conversationId) {
      // The UI caught up with a remotely accepted call; switching away again
      // should hang up as usual.
      remoteAcceptedRef.current = false;
      if (joinedAsRef.current === me.id) return;
    }
    if (remoteAcceptedRef.current) return;
    void leaveCall();
  }, [me.id, conversationId, leaveCall]);

  // ---- Global ring channel (`call-ring:{userId}`) -----------------------------

  const handleRing = useCallback(
    (data: RingPayload | null) => {
      const self = meRef.current;
      if (!data?.conversationId || !data.callerId || data.callerId === self.id) return;

      // Already in this very call: nothing to ring.
      if (inCallRef.current && callConversationRef.current === data.conversationId) return;

      if (inCallRef.current || joiningRef.current) {
        sendRing(data.callerId, "ring-decline", {
          conversationId: data.conversationId,
          userId: self.id,
          name: self.name,
          reason: "busy",
        });
        return;
      }

      const current = incomingCallRef.current;
      if (current) {
        // A repeated ring for the same call (announce retries) is ignored; a
        // different caller is told we are busy.
        if (current.userId === data.callerId && current.conversationId === data.conversationId) {
          return;
        }
        sendRing(data.callerId, "ring-decline", {
          conversationId: data.conversationId,
          userId: self.id,
          name: self.name,
          reason: "busy",
        });
        return;
      }

      const next: IncomingCall = {
        userId: data.callerId,
        name: data.callerName ?? "Someone",
        conversationId: data.conversationId,
        conversationTitle: data.title ?? null,
        guestKey: data.key ?? null,
      };
      incomingCallRef.current = next;
      setIncomingCall(next);
      startRinging();
    },
    [sendRing, startRinging],
  );

  const handleRingCancel = useCallback(
    (data: RingCancelPayload | null) => {
      if (!data?.conversationId) return;
      const current = incomingCallRef.current;
      if (!current || current.conversationId !== data.conversationId) return;
      if (data.callerId && current.userId !== data.callerId) return;
      clearIncoming();
    },
    [clearIncoming],
  );

  const handleRingDecline = useCallback((data: RingDeclinePayload | null) => {
    if (!data?.conversationId || !data.userId) return;
    if (!inCallRef.current || callConversationRef.current !== data.conversationId) return;
    if (Date.now() - ringDeclinedAtRef.current < 2_500) return;
    ringDeclinedAtRef.current = Date.now();
    if (data.reason === "busy") {
      toast(`${data.name ?? "Someone"} is already in another call`);
    } else {
      toast(`${data.name ?? "Someone"} declined the call`);
    }
  }, []);

  const handleRingAccept = useCallback(
    (data: RingAcceptPayload | null) => {
      if (!data?.conversationId || !data.userId || data.userId === meRef.current.id) return;
      if (!inCallRef.current || callConversationRef.current !== data.conversationId) return;
      // The accepter is joining: make sure we have a connection to them even if
      // their `join` broadcast never arrived.
      patchParticipant(data.userId, { name: data.name ?? "Someone" });
      void maybeConnectPeer(data.userId, data.name, { force: true });
    },
    [maybeConnectPeer, patchParticipant],
  );

  // Every signed-in client subscribes to its personal ring channel for the
  // whole chat session, so an incoming call rings no matter which conversation
  // is open. (Guests never subscribe: they are always the callee of one link.)
  useEffect(() => {
    const self = meRef.current;
    if (!listenForIncoming || !self.id) return;

    const client = clientRef.current;
    const channel = client.channel(`${RING_CHANNEL_PREFIX}${self.id}`, {
      config: { broadcast: { self: false } },
    });
    ringInRef.current = channel;

    channel
      .on("broadcast", { event: "ring" }, (message) => {
        handleRing(asPayload<RingPayload>(message["payload"]));
      })
      .on("broadcast", { event: "ring-cancel" }, (message) => {
        handleRingCancel(asPayload<RingCancelPayload>(message["payload"]));
      })
      .on("broadcast", { event: "ring-decline" }, (message) => {
        handleRingDecline(asPayload<RingDeclinePayload>(message["payload"]));
      })
      .on("broadcast", { event: "ring-accept" }, (message) => {
        handleRingAccept(asPayload<RingAcceptPayload>(message["payload"]));
      })
      .subscribe();

    return () => {
      ringInRef.current = null;
      void client.removeChannel(channel);
    };
  }, [listenForIncoming, me.id, handleRing, handleRingCancel, handleRingDecline, handleRingAccept]);

  const acceptIncomingCall = useCallback(async () => {
    const incoming = incomingCallRef.current;
    clearIncoming();
    if (!incoming) return;

    // Accepting a call that belongs to another conversation keeps the call
    // alive even while a different conversation is displayed.
    remoteAcceptedRef.current = true;
    onSwitchConversationRef.current?.(incoming.conversationId);

    await joinCall(incoming.conversationId);
    if (!inCallRef.current) {
      remoteAcceptedRef.current = false;
      return;
    }

    // Proactive confirmation to the caller: lets them offer us a connection
    // even if they missed our `join` broadcast.
    sendRing(incoming.userId, "ring-accept", {
      conversationId: incoming.conversationId,
      userId: meRef.current.id,
      name: meRef.current.name,
    });
  }, [clearIncoming, joinCall, sendRing]);

  const declineIncomingCall = useCallback(() => {
    const incoming = incomingCallRef.current;
    clearIncoming();
    if (!incoming) return;
    sendRing(incoming.userId, "ring-decline", {
      conversationId: incoming.conversationId,
      userId: meRef.current.id,
      name: meRef.current.name,
      reason: "declined",
    });
  }, [clearIncoming, sendRing]);

  // ---- Shareable invite link --------------------------------------------------

  const waitForGuestKey = useCallback(async (timeoutMs: number): Promise<string | null> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (guestKeyRef.current) return guestKeyRef.current;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
    }
    return guestKeyRef.current;
  }, []);

  /**
   * Joins the current call if needed, makes sure the host's guest key is
   * available and copies the shareable `/call/<id>?k=<key>` link. This is what
   * the `/call` slash command calls.
   */
  const copyCallInviteLink = useCallback(async (): Promise<boolean> => {
    const target = callConversationRef.current ?? conversationIdRef.current;
    if (!target) {
      toast.error("Open a conversation before starting a call");
      return false;
    }

    if (!inCallRef.current) {
      await joinCall(target);
      if (!inCallRef.current) return false;
    }

    const key = await waitForGuestKey(6_000);
    if (!key) {
      toast.error("The call host hasn't enabled invite links yet — try again in a moment.");
      return false;
    }

    const link = buildGuestCallLink(target, key);
    if (!link) return false;

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      toast.success("Call link copied — anyone with it can join as a guest");
      return true;
    } catch {
      toast.message("Share this call link", { description: link, duration: 20_000 });
      return false;
    }
  }, [joinCall, waitForGuestKey]);

  /** Same as {@link copyCallInviteLink} but also returns the link. */
  const startCallWithLink = useCallback(async (): Promise<string | null> => {
    await copyCallInviteLink();
    const target = callConversationRef.current;
    const key = guestKeyRef.current;
    if (!target || !key) return null;
    return buildGuestCallLink(target, key);
  }, [copyCallInviteLink]);

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
    notice,
    incomingCall,
    isHost: hostId !== null && hostId === me.id,
    hostId,
    selfId: me.id,
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
    toggleScreenShare,
    screenSharing,
    screenStream,
    toggleDeafen,
    setParticipantVolume,
    toggleParticipantLocalMute,
    setParticipantServerMute,
    kickParticipant,
    banParticipant,
    clearNotice,
    playSound,
    createBreakoutRoom,
    moveParticipantToRoom,
    closeBreakoutRooms,
    ensureGuestKey,
    retryRingtone,
    copyCallInviteLink,
    startCallWithLink,
  };
}

export type UseCallResult = ReturnType<typeof useCall>;
