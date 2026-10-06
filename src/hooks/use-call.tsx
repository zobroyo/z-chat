import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/*
 * Discord-style mesh voice/video calls on top of Supabase Realtime + WebRTC.
 *
 * One public broadcast channel per conversation: `call:{conversationId}`.
 *
 * Event contract
 * --------------
 * join   { userId, name }                     broadcast once when joining
 * offer  { to, from, name?, sdp }             existing peers -> newcomer
 * answer { to, from, name?, sdp }             newcomer -> existing peer
 * ice    { to, from, candidate }              trickled ICE candidates
 * state  { userId, muted, video, name? }      mute / camera flags
 * leave  { userId }                           graceful disconnect
 *
 * Every event carrying `to` is ignored unless `to` is my own user id. The
 * joiner never initiates: after the `join` broadcast, each participant that is
 * already in the call creates an RTCPeerConnection, adds the local tracks and
 * sends an offer to the newcomer, who answers.
 *
 * Camera handling: both sides negotiate a `sendrecv` video transceiver up
 * front, so turning the camera on/off is a `replaceTrack` on the existing
 * sender and never requires a renegotiation.
 *
 * `name` is an optional extra on offer/answer/state so tile labels survive a
 * late join (the joiner never saw the earlier `join` broadcasts).
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

const CHANNEL_TIMEOUT_MS = 15_000;

export type CallParticipant = {
  id: string;
  name: string;
  muted: boolean;
  video: boolean;
};

type JoinPayload = { userId?: string; name?: string };
type OfferPayload = { to?: string; from?: string; name?: string; sdp?: string };
type AnswerPayload = { to?: string; from?: string; name?: string; sdp?: string };
type IcePayload = { to?: string; from?: string; candidate?: RTCIceCandidateInit | null };
type StatePayload = { userId?: string; name?: string; muted?: boolean; video?: boolean };
type LeavePayload = { userId?: string };

type Peer = {
  pc: RTCPeerConnection;
  /** Hidden <audio> that plays this peer's remote stream (audio-only peers included). */
  audioEl: HTMLAudioElement | null;
  /** Single remote MediaStream for this peer, fed by `ontrack`. */
  stream: MediaStream;
  /** Sender for the up-front video transceiver; camera tracks are swapped in here. */
  videoSender: RTCRtpSender | null;
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

export function useCall(conversationId: string | null, me: { id: string; name: string }) {
  const [inCall, setInCall] = useState(false);
  const [joining, setJoining] = useState(false);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest props/state available to stable callbacks without
  // re-creating them (channel handlers need the values at call time).
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

  const inCallRef = useRef(false);
  const joiningRef = useRef(false);
  const mutedRef = useRef(false);
  const cameraOnRef = useRef(false);
  const deafenedRef = useRef(false);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      void channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
    } catch {
      // `_push` throws when the channel has not finished joining; drop the event.
    }
  }, []);

  const updateParticipant = useCallback(
    (id: string, patch: { name?: string; muted?: boolean; video?: boolean }) => {
      setParticipants((current) => {
        const index = current.findIndex((participant) => participant.id === id);
        if (index < 0) {
          return [
            ...current,
            {
              id,
              name: patch.name ?? "Someone",
              muted: patch.muted ?? false,
              video: patch.video ?? false,
            },
          ];
        }

        const previous = current[index];
        if (!previous) return current;

        const next = current.slice();
        next[index] = {
          ...previous,
          name: patch.name ?? previous.name,
          muted: patch.muted ?? previous.muted,
          video: patch.video ?? previous.video,
        };
        return next;
      });
    },
    [],
  );

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
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

      peer.audioEl?.remove();
      removeRemoteStream(peerId);
      setParticipants((current) => current.filter((participant) => participant.id !== peerId));
    },
    [removeRemoteStream],
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

  const createPeer = useCallback(
    (peerId: string, name: string | undefined) => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        if (name && name !== existing.name) {
          existing.name = name;
          updateParticipant(peerId, { name });
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

        if (peer.audioEl) {
          if (peer.audioEl.srcObject !== stream) peer.audioEl.srcObject = stream;
          peer.audioEl.muted = deafenedRef.current;
          void peer.audioEl.play().catch(() => undefined);
        }

        setRemoteStreams((current) =>
          current[peerId] === stream ? current : { ...current, [peerId]: stream },
        );
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") closePeer(peerId);
      };

      peersRef.current.set(peerId, peer);
      updateParticipant(peerId, { name: peer.name });
      return peer;
    },
    [closePeer, send, updateParticipant],
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

  const handleJoin = useCallback(
    async (data: JoinPayload | null) => {
      const self = meRef.current;
      const userId = data?.userId;
      if (!inCallRef.current || !userId || userId === self.id) return;

      // A peer re-announcing after a reload: the old connection is dead but may
      // not have flipped to "failed" yet, so rebuild it explicitly. Anything
      // still negotiating (or healthy) is left alone.
      const existing = peersRef.current.get(userId);
      if (existing) {
        const busy =
          existing.pc.signalingState !== "stable" ||
          existing.pc.connectionState === "connected" ||
          existing.pc.connectionState === "connecting";
        if (busy) return;
        closePeer(userId);
      }

      await offerPeer(userId, data?.name);
    },
    [closePeer, offerPeer],
  );

  const handleOffer = useCallback(
    async (data: OfferPayload | null) => {
      const self = meRef.current;
      if (!data?.from || !data.sdp || !inCallRef.current) return;
      if (data.to && data.to !== self.id) return;
      if (data.from === self.id) return;

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
        updateParticipant(data.from, { name: data.name });
      }

      try {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        flushIce(data.from);
      } catch {
        // Stale or duplicate answer; ignore.
      }
    },
    [flushIce, updateParticipant],
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
      updateParticipant(data.userId, {
        ...(data.name ? { name: data.name } : {}),
        muted: data.muted === true,
        video: data.video === true,
      });
    },
    [updateParticipant],
  );

  const handleLeave = useCallback(
    (data: LeavePayload | null) => {
      if (!data?.userId) return;
      closePeer(data.userId);
    },
    [closePeer],
  );

  const applyLocalAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = !mutedRef.current && !deafenedRef.current;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  const broadcastState = useCallback(() => {
    const self = meRef.current;
    send("state", {
      userId: self.id,
      name: self.name,
      muted: mutedRef.current || deafenedRef.current,
      video: cameraOnRef.current,
    });
  }, [send]);

  const teardown = useCallback(() => {
    if (pageHideRef.current) {
      window.removeEventListener("pagehide", pageHideRef.current);
      pageHideRef.current = null;
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
    if (channel) void supabase.removeChannel(channel);

    inCallRef.current = false;
    joiningRef.current = false;
    mutedRef.current = false;
    cameraOnRef.current = false;
    deafenedRef.current = false;

    setParticipants([]);
    setRemoteStreams({});
    setLocalStream(null);
    setInCall(false);
    setJoining(false);
    setMuted(false);
    setCameraOn(false);
    setDeafened(false);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      channel = supabase.channel(`call:${targetConversation}`, {
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

      callConversationRef.current = targetConversation;
      joinedAsRef.current = self.id;
      setLocalStream(stream);
      inCallRef.current = true;
      setInCall(true);

      send("join", { userId: self.id, name: self.name });
      send("state", {
        userId: self.id,
        name: self.name,
        muted: mutedRef.current || deafenedRef.current,
        video: cameraOnRef.current,
      });
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
      if (channel) {
        channelRef.current = null;
        void supabase.removeChannel(channel);
      }
      setError(mediaErrorMessage(cause, "microphone"));
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }, [handleAnswer, handleIce, handleJoin, handleLeave, handleOffer, handleState, send]);

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
    mutedRef.current = !mutedRef.current;
    applyLocalAudio();
    setMuted(mutedRef.current);
    broadcastState();
  }, [applyLocalAudio, broadcastState]);

  const toggleDeafen = useCallback(() => {
    if (!inCallRef.current) return;
    const next = !deafenedRef.current;
    deafenedRef.current = next;

    for (const peer of peersRef.current.values()) {
      if (peer.audioEl) peer.audioEl.muted = next;
    }

    applyLocalAudio();
    setDeafened(next);
    broadcastState();
  }, [applyLocalAudio, broadcastState]);

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

  return {
    inCall,
    joining,
    participants,
    localStream,
    remoteStreams,
    muted,
    cameraOn,
    deafened,
    error,
    joinCall,
    leaveCall,
    toggleMute,
    toggleCamera,
    toggleDeafen,
  };
}

export type UseCallResult = ReturnType<typeof useCall>;
