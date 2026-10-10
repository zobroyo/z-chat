import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  DoorOpen,
  HeadphoneOff,
  Headphones,
  Link2,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Music,
  PictureInPicture2,
  PhoneCall,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CallBreakoutPanel } from "@/components/call/CallBreakoutPanel";
import { CallDeviceSettings } from "@/components/call/CallDeviceSettings";
import { CallGuestInvitePanel } from "@/components/call/CallGuestInvitePanel";
import { CallParticipantTile } from "@/components/call/CallParticipantTile";
import { CallSoundboardPanel } from "@/components/call/CallSoundboardPanel";
import type { BreakoutRoom, UseCallResult } from "@/hooks/use-call";
import { initialsOf } from "@/lib/chat";
import { cn } from "@/lib/utils";

type CallOverlayProps = {
  call: UseCallResult;
  conversationTitle: string;
};

type ControlButtonProps = {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function roomName(roomId: string | null, rooms: BreakoutRoom[]): string {
  if (!roomId) return "Main room";
  return rooms.find((room) => room.id === roomId)?.name ?? "Breakout room";
}

/**
 * Google-Meet-style auto-sizing grid:
 * 1 → one tile, 2-4 → up to 2 columns (2x2), 5-6 → 3 columns (3x2),
 * 7+ → up to 4 columns. Tiles always stretch to fill their cell.
 */
function participantGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 6) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
}

function ControlButton({
  label,
  active = false,
  danger = false,
  onClick,
  children,
}: ControlButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={danger ? "destructive" : "ghost"}
          size="icon"
          className={cn(
            "size-11 shrink-0 rounded-full border border-white/10 text-white sm:size-12",
            !danger &&
              "bg-white/10 hover:bg-white/20 hover:text-white focus-visible:bg-white/20",
            !danger && active && "border-primary/70 bg-primary text-primary-foreground",
          )}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Round ghost button used as a popover trigger inside the controls pill. */
const BarPopoverButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button> & { label: string }
>(function BarPopoverButton({ label, children, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-11 shrink-0 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:size-12",
        className,
      )}
      {...props}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
});

/**
 * Full-screen call surface: incoming ring, a Google-Meet-style participant
 * grid that fills the viewport, and a floating dynamic-island controls pill
 * (mic / camera / deafen / soundboard / breakouts / guest link / leave).
 */
export function CallOverlay({ call, conversationTitle }: CallOverlayProps) {
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  /** Minimised ("picture-in-picture") mode: keep the call alive but out of the way. */
  const [minimized, setMinimized] = useState(false);
  /** Participant pinned to the full-screen spotlight (null = normal grid). */
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  /** The screen-sharer we auto-focused, so a manual unpin isn't fought. */
  const autoSharedRef = useRef<string | null>(null);

  // --- Picture-in-Picture ----------------------------------------------------
  // iOS suspends a backgrounded PWA (mic + audio stop). A live PiP window keeps
  // the media session going, so entering PiP before leaving the app is the only
  // way a web call can keep flowing on iPhone.
  const [pipActive, setPipActive] = useState(false);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipStreamRef = useRef<MediaStream | null>(null);
  const pipRafRef = useRef<number | null>(null);

  const pipSourceStream = call.screenSharing ? call.screenStream : null;

  /** A canvas "in call" animation used as the PiP carrier for audio-only calls. */
  const ensurePipStream = useCallback((): MediaStream | null => {
    if (pipStreamRef.current) return pipStreamRef.current;
    if (typeof document === "undefined") return null;
    const canvas = pipCanvasRef.current ?? document.createElement("canvas");
    pipCanvasRef.current = canvas;
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      if (ctx) {
        const t = performance.now() / 1000;
        ctx.fillStyle = "#0a0c11";
        ctx.fillRect(0, 0, 640, 360);
        for (let i = 0; i < 5; i += 1) {
          const h = 28 + Math.abs(Math.sin(t * 2 + i)) * 96;
          ctx.fillStyle = "rgba(99,102,241,0.85)";
          ctx.fillRect(140 + i * 76, 240 - h, 40, h);
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 30px system-ui, sans-serif";
        ctx.fillText("Z Chat", 40, 70);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "400 18px system-ui, sans-serif";
        ctx.fillText(`In call · ${conversationTitle.slice(0, 40)}`, 40, 100);
      }
      pipRafRef.current = window.requestAnimationFrame(draw);
    };
    draw();
    try {
      pipStreamRef.current = canvas.captureStream(15);
    } catch {
      pipStreamRef.current = null;
    }
    return pipStreamRef.current;
  }, [conversationTitle]);

  const enterPip = useCallback(async (): Promise<boolean> => {
    const video = pipVideoRef.current as
      | (HTMLVideoElement & {
          requestPictureInPicture?: () => Promise<unknown>;
          webkitSetPresentationMode?: (mode: string) => void;
        })
      | null;
    if (!video) return false;

    const source = pipSourceStream ?? ensurePipStream();
    if (source && video.srcObject !== source) video.srcObject = source;
    try {
      await video.play();
    } catch {
      /* autoplay/gesture rules may block; PiP request below also needs a gesture */
    }

    try {
      if (typeof video.requestPictureInPicture === "function") {
        if (document.pictureInPictureElement === video) return true;
        await video.requestPictureInPicture();
        return true;
      }
      if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
        return true;
      }
    } catch {
      /* blocked without a user gesture (e.g. on visibilitychange) */
    }
    return false;
  }, [pipSourceStream, ensurePipStream]);

  const togglePip = useCallback(async () => {
    const video = pipVideoRef.current as
      | (HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void })
      | null;
    if (pipActive) {
      try {
        await document.exitPictureInPicture?.();
      } catch {
        /* ignore */
      }
      try {
        video?.webkitSetPresentationMode?.("inline");
      } catch {
        /* ignore */
      }
      setPipActive(false);
      return;
    }
    const ok = await enterPip();
    if (ok) setPipActive(true);
    else toast.info("Picture-in-Picture isn't supported here — on iPhone, use the Z Chat app for background calls");
  }, [pipActive, enterPip]);

  // Track PiP state (standard API + iOS webkit presentation modes).
  useEffect(() => {
    const video = pipVideoRef.current as
      | (HTMLVideoElement & { webkitPresentationMode?: string })
      | null;
    if (!video) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    const onMode = () => setPipActive(video.webkitPresentationMode === "picture-in-picture");
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    video.addEventListener("webkitpresentationmodechanged", onMode);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      video.removeEventListener("webkitpresentationmodechanged", onMode);
    };
  }, [call.inCall, minimized]);

  // Best effort: pop into PiP when the app is sent to the background mid-call.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && call.inCall) void enterPip();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [call.inCall, enterPip]);

  // Keep the screen awake while in a call: a sleeping/locked screen suspends the
  // call (especially in the PWA) — the "it cuts out after a while" symptom.
  useEffect(() => {
    if (!call.inCall) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let released = false;
    const request = async () => {
      try {
        const wakeLock = (
          navigator as Navigator & {
            wakeLock?: {
              request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
            };
          }
        ).wakeLock;
        if (!wakeLock) return;
        sentinel = await wakeLock.request("screen");
      } catch {
        /* unsupported or denied */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !released) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [call.inCall]);

  useEffect(
    () => () => {
      if (pipRafRef.current !== null) window.cancelAnimationFrame(pipRafRef.current);
      pipStreamRef.current?.getTracks().forEach((track) => track.stop());
      pipStreamRef.current = null;
    },
    [],
  );

  // Draggable picture-in-picture position (null = default bottom-right corner).
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const pipRef = useRef<HTMLDivElement | null>(null);
  const pipDragRef = useRef<{
    id: number;
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const pipMovedRef = useRef(false);

  const onPipPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = pipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pipDragRef.current = {
      id: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    // Freeze the current spot so the pill doesn't jump when it starts moving.
    setPipPos({ x: rect.left, y: rect.top });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    event.preventDefault();
  };

  const onPipPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pipDragRef.current;
    const el = pipRef.current;
    if (!drag || drag.id !== event.pointerId || !el) return;
    if (!drag.moved) {
      // Ignore tiny jitters so a plain click still restores the call.
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      drag.moved = true;
    }
    const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
    setPipPos({
      x: Math.min(maxX, Math.max(0, event.clientX - drag.dx)),
      y: Math.min(maxY, Math.max(0, event.clientY - drag.dy)),
    });
  };

  const onPipPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pipDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    pipMovedRef.current = drag.moved;
    pipDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  const onPipClick = () => {
    if (pipMovedRef.current) {
      pipMovedRef.current = false;
      return;
    }
    setMinimized(false);
  };

  // Keep the pill on screen when the window shrinks.
  useEffect(() => {
    const onResize = () => {
      const el = pipRef.current;
      if (!el) return;
      setPipPos((pos) =>
        pos
          ? {
              x: Math.max(0, Math.min(pos.x, window.innerWidth - el.offsetWidth)),
              y: Math.max(0, Math.min(pos.y, window.innerHeight - el.offsetHeight)),
            }
          : pos,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Join/leave activity: transient banner + the tile pop-in animation.
  const [activity, setActivity] = useState<{ key: number; text: string } | null>(null);
  const activityKey = useRef(0);
  const knownParticipants = useRef<Map<string, string> | null>(null);

  // Auto-dismiss the activity banner. This is keyed on the banner itself (not on
  // `call.participants`) so the frequent presence/state heartbeats — which
  // recreate the participant list and re-run that effect — can no longer cancel
  // the timeout and leave the banner stuck on screen forever.
  useEffect(() => {
    if (!activity) return;
    const timer = window.setTimeout(() => setActivity(null), 3200);
    return () => window.clearTimeout(timer);
  }, [activity]);

  useEffect(() => {
    const current = new Map(
      call.participants.map((participant) => [participant.id, participant.name] as const),
    );
    const previous = knownParticipants.current;
    knownParticipants.current = current;
    if (!previous) return;
    const show = (text: string) => {
      activityKey.current += 1;
      setActivity({ key: activityKey.current, text });
    };
    for (const [id, name] of current) {
      if (!previous.has(id)) show(`${name} joined the call`);
    }
    for (const [id, name] of previous) {
      if (!current.has(id)) show(`${name} left the call`);
    }
  }, [call.participants]);

  // A fresh call always starts full-screen (leave/join must never inherit the
  // previous session's minimised state).
  useEffect(() => {
    if (!call.inCall && !call.joining) setMinimized(false);
  }, [call.inCall, call.joining]);

  // Auto-focus the active screen share (spotlight). A manual pin takes
  // precedence; when the sharer stops, drop the auto-pin so the grid returns.
  useEffect(() => {
    const activeSharer = call.screenSharing
      ? call.selfId
      : (call.participants.find(
          (participant) =>
            participant.sharing && (participant.roomId ?? null) === (call.myRoomId ?? null),
        )?.id ?? null);

    if (!activeSharer) {
      if (autoSharedRef.current && pinnedId === autoSharedRef.current) setPinnedId(null);
      autoSharedRef.current = null;
      return;
    }
    if (pinnedId === null && autoSharedRef.current !== activeSharer) {
      autoSharedRef.current = activeSharer;
      setPinnedId(activeSharer);
    }
  }, [call.screenSharing, call.participants, call.selfId, call.myRoomId, pinnedId]);

  if (call.incomingCall && !call.inCall && !call.joining) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 backdrop-blur-xl sm:items-center">
        <div className="call-incoming-enter w-full max-w-sm rounded-3xl border border-border bg-surface p-6 text-center shadow-2xl">
          <Avatar className="mx-auto size-20">
            <AvatarFallback className="bg-surface-2 font-display text-2xl font-semibold text-muted-foreground">
              {initialsOf(call.incomingCall.name)}
            </AvatarFallback>
          </Avatar>

          <p className="mt-4 font-display text-lg font-semibold">{call.incomingCall.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {call.incomingCall.conversationTitle
              ? `is calling in ${call.incomingCall.conversationTitle}…`
              : "is calling you…"}
          </p>

          {call.ringAudioBlocked && (
            <button
              type="button"
              onClick={call.retryRingtone}
              className="mt-4 w-full rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 transition-colors hover:bg-amber-400/20"
            >
              Ringing sound is blocked by your browser — tap to enable it
            </button>
          )}

          <div className="mt-6 flex items-center justify-center gap-4">
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="size-14 rounded-full"
              aria-label="Decline call"
              onClick={call.declineIncomingCall}
            >
              <PhoneOff className="size-6" />
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-14 rounded-full bg-green-600 text-white hover:bg-green-500"
              aria-label="Accept call"
              onClick={() => void call.acceptIncomingCall()}
            >
              <PhoneCall className="size-6" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!call.inCall && !call.joining) return null;

  const showJoining = call.joining && !call.inCall;
  const myRoomId = call.myRoomId ?? null;
  const roomParticipants = call.participants.filter(
    (participant) => (participant.roomId ?? null) === myRoomId,
  );
  const otherRoomParticipants = call.participants.filter(
    (participant) => (participant.roomId ?? null) !== myRoomId,
  );
  const inBreakout = myRoomId !== null;
  const totalTiles = roomParticipants.length + 1;

  // Hidden carrier <video> for Picture-in-Picture (screen share, else a canvas
  // "in call" animation). Kept rendered-but-invisible so PiP can be requested.
  const pipCarrier = (
    <video
      ref={pipVideoRef}
      playsInline
      muted
      className="pointer-events-none fixed right-2 bottom-2 size-1 opacity-0"
      aria-hidden
    />
  );

  // Picture-in-picture: the call stays connected (audio + WebRTC keep running
  // because the hook owns the streams), but the full-screen surface is replaced
  // by a small floating pill so the rest of Z Chat stays reachable.
  if (minimized) {
    return (
      <div
        ref={pipRef}
        data-testid="call-minimized"
        style={pipPos ? { left: pipPos.x, top: pipPos.y } : undefined}
        className={cn(
          "fixed z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-1.5 rounded-full border border-white/10 bg-[#0a0c11]/95 p-1.5 pl-3 text-white shadow-2xl backdrop-blur-xl",
          !pipPos && "right-3 bottom-24 sm:right-4 sm:bottom-24",
        )}
      >
        {pipCarrier}
        <button
          type="button"
          onPointerDown={onPipPointerDown}
          onPointerMove={onPipPointerMove}
          onPointerUp={onPipPointerUp}
          onPointerCancel={onPipPointerUp}
          onClick={onPipClick}
          className="flex min-w-0 cursor-grab touch-none items-center gap-2 rounded-full pr-2 text-left active:cursor-grabbing"
          aria-label="Drag to move · tap to expand the call"
          title="Drag to move · tap to return to the call"
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-green-600/20 text-green-400">
            <PhoneCall className="size-3.5" />
            <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-green-500" />
          </span>
          <span className="min-w-0">
            <span className="block max-w-36 truncate text-xs font-semibold">
              {conversationTitle}
            </span>
            <span className="block truncate text-[10px] text-white/60">
              {showJoining ? "Connecting…" : `${call.participants.length + 1} in call`}
            </span>
          </span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-9 shrink-0 rounded-full border border-white/10 text-white hover:bg-white/20 hover:text-white",
            (call.muted || call.serverMuted) && "border-primary/70 bg-primary text-primary-foreground",
          )}
          aria-label={call.muted ? "Unmute" : "Mute"}
          aria-pressed={call.muted || call.serverMuted}
          title={call.muted ? "Unmute" : "Mute"}
          onClick={call.toggleMute}
        >
          {call.muted || call.serverMuted ? (
            <MicOff className="size-4" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-9 shrink-0 rounded-full border border-white/10 text-white hover:bg-white/20 hover:text-white",
            pipActive && "border-primary/70 bg-primary text-primary-foreground",
          )}
          aria-label="Picture-in-Picture"
          aria-pressed={pipActive}
          title="Picture-in-Picture (keeps the call alive in the background)"
          onClick={() => void togglePip()}
        >
          <PictureInPicture2 className="size-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          aria-label="Back to call"
          title="Back to call"
          onClick={() => setMinimized(false)}
        >
          <Maximize2 className="size-4" />
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label="Leave call"
          title="Leave call"
          onClick={() => void call.leaveCall()}
        >
          <PhoneOff className="size-4" />
        </Button>
      </div>
    );
  }

  const featuredId =
    pinnedId && (pinnedId === call.selfId || roomParticipants.some((p) => p.id === pinnedId))
      ? pinnedId
      : null;

  const togglePin = (id: string) =>
    setPinnedId((current) => (current === id ? null : id));

  const renderTile = (id: string, spotlight: boolean) => {
    if (id === call.selfId) {
      return (
        <CallParticipantTile
          name="You"
          muted={call.muted || call.deafened || call.serverMuted}
          video={call.cameraOn || call.screenSharing}
          stream={call.screenSharing ? call.screenStream : call.localStream}
          self
          sharing={call.screenSharing}
          speaking={call.activeSpeakerId === call.selfId}
          avatarUrl={call.selfAvatar}
          deafened={call.deafened}
          serverMuted={call.serverMuted}
          isHost={call.isHost}
          spotlight={spotlight}
          pinned={pinnedId === call.selfId}
          onTogglePin={() => togglePin(call.selfId)}
        />
      );
    }

    const participant = roomParticipants.find((item) => item.id === id);
    if (!participant) return null;
    return (
      <CallParticipantTile
        key={participant.id}
        name={participant.name}
        muted={participant.muted || participant.serverMuted}
        video={participant.video || participant.sharing}
        sharing={participant.sharing}
        speaking={call.activeSpeakerId === participant.id}
        avatarUrl={participant.avatar}
        stream={call.remoteStreams[participant.id] ?? null}
        deafened={participant.deafened}
        serverMuted={participant.serverMuted}
        localMuted={participant.localMuted}
        isHost={participant.id === call.hostId}
        isAdmin={participant.isAdmin}
        isGuest={participant.isGuest}
        volume={participant.volume}
        canModerate={call.canModerate}
        spotlight={spotlight}
        pinned={pinnedId === participant.id}
        onTogglePin={() => togglePin(participant.id)}
        onVolumeChange={(volume) => call.setParticipantVolume(participant.id, volume)}
        onToggleLocalMute={() => call.toggleParticipantLocalMute(participant.id)}
        onToggleServerMute={() =>
          call.setParticipantServerMute(participant.id, !participant.serverMuted)
        }
        onKick={() => call.kickParticipant(participant.id)}
        onBan={() => call.banParticipant(participant.id)}
      />
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-1.5 backdrop-blur-2xl sm:p-3">
      <div
        data-testid="call-overlay"
        className="relative flex h-[96vh] w-[98vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c11]/95 text-white shadow-2xl sm:rounded-3xl"
      >
        {pipCarrier}
        <header className="flex shrink-0 items-center gap-2.5 px-3 py-2 sm:px-4 sm:py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <PhoneCall className="size-4" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold">{conversationTitle}</p>
            <p className="truncate text-xs text-white/60">
              {showJoining
                ? "Connecting…"
                : call.participants.length === 0
                  ? "Ringing…"
                  : inBreakout
                    ? `${roomParticipants.length + 1} in ${roomName(myRoomId, call.breakoutRooms)}`
                    : `${roomParticipants.length + 1} in call`}
              {!showJoining && otherRoomParticipants.length > 0
                ? ` · ${otherRoomParticipants.length} in other rooms`
                : ""}
            </p>
          </div>

          {call.isHost && (
            <span className="hidden rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase sm:inline">
              Host
            </span>
          )}
          {call.isAdmin && !call.isHost && (
            <span className="hidden rounded-full border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase sm:inline">
              Admin
            </span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Minimize call"
            title="Minimize call — keep chatting"
            onClick={() => setMinimized(true)}
          >
            <Minimize2 className="size-4" />
          </Button>
        </header>

        {activity && (
          <div
            key={activity.key}
            className="call-banner pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/75 px-4 py-1.5 text-xs font-medium text-white shadow-2xl backdrop-blur"
          >
            {activity.text}
          </div>
        )}

        {call.error && (
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300 sm:mx-4">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0">{call.error}</span>
          </div>
        )}

        {!showJoining && inBreakout && (
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 sm:mx-4">
            <DoorOpen className="size-4 shrink-0" />
            <span className="min-w-0">
              You&apos;re in {roomName(myRoomId, call.breakoutRooms)} — only people in this room
              can hear you.
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden px-2 pt-2 pb-24 sm:px-3 sm:pb-28">
          {showJoining ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm">Joining call…</p>
            </div>
          ) : featuredId ? (
            <div
              data-testid="call-spotlight"
              className="flex h-full w-full flex-col gap-1.5 sm:gap-2.5"
            >
              <div className="min-h-0 flex-1">{renderTile(featuredId, true)}</div>

              {[call.selfId, ...roomParticipants.map((participant) => participant.id)].filter(
                (id) => id !== featuredId,
              ).length > 0 && (
                <div className="flex h-20 shrink-0 items-stretch gap-1.5 overflow-x-auto sm:h-24 sm:gap-2.5">
                  {[call.selfId, ...roomParticipants.map((participant) => participant.id)]
                    .filter((id) => id !== featuredId)
                    .map((id) => (
                      <div key={id} className="aspect-video h-full shrink-0">
                        {renderTile(id, false)}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div
              data-testid="call-grid"
              className={cn(
                "grid h-full w-full place-items-center auto-rows-fr gap-1.5 sm:gap-2.5",
                participantGridClass(totalTiles),
              )}
            >
              {renderTile(call.selfId, false)}
              {roomParticipants.map((participant) => renderTile(participant.id, false))}
            </div>
          )}
        </div>

        {/* Floating dynamic-island controls pill, bottom center. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-2 pb-2.5 sm:pb-3.5">
          <TooltipProvider delayDuration={200}>
            <div
              data-testid="call-controls"
              className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-[28px] border border-white/10 bg-black/70 px-2 py-2 shadow-2xl backdrop-blur-xl sm:gap-2 sm:rounded-full sm:px-3"
            >
              <ControlButton
                label={call.muted ? "Unmute" : "Mute"}
                active={call.muted || call.serverMuted}
                onClick={call.toggleMute}
              >
                {call.muted || call.serverMuted ? (
                  <MicOff className="size-5" />
                ) : (
                  <Mic className="size-5" />
                )}
              </ControlButton>

              <ControlButton
                label={call.cameraOn ? "Turn camera off" : "Turn camera on"}
                active={call.cameraOn}
                onClick={() => void call.toggleCamera()}
              >
                {call.cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
              </ControlButton>

              <ControlButton
                label={call.screenSharing ? "Stop sharing screen" : "Share screen"}
                active={call.screenSharing}
                onClick={() => void call.toggleScreenShare()}
              >
                {call.screenSharing ? (
                  <ScreenShareOff className="size-5" />
                ) : (
                  <ScreenShare className="size-5" />
                )}
              </ControlButton>

              <ControlButton
                label={call.deafened ? "Undeafen" : "Deafen"}
                active={call.deafened}
                onClick={call.toggleDeafen}
              >
                {call.deafened ? (
                  <HeadphoneOff className="size-5" />
                ) : (
                  <Headphones className="size-5" />
                )}
              </ControlButton>

              <Popover open={soundboardOpen} onOpenChange={setSoundboardOpen}>
                <PopoverTrigger asChild>
                  <BarPopoverButton label="Soundboard">
                    <Music className="size-5" />
                  </BarPopoverButton>
                </PopoverTrigger>
                <CallSoundboardPanel sounds={call.sounds} onPlay={call.playSound} />
              </Popover>

              <Popover open={breakoutOpen} onOpenChange={setBreakoutOpen}>
                <PopoverTrigger asChild>
                  <BarPopoverButton
                    label="Breakout rooms"
                    className={cn(inBreakout && "border-amber-400/50 text-amber-300")}
                  >
                    <DoorOpen className="size-5" />
                  </BarPopoverButton>
                </PopoverTrigger>
                <CallBreakoutPanel
                  rooms={call.breakoutRooms}
                  participants={call.participants}
                  selfId={call.selfId}
                  myRoomId={myRoomId}
                  isHost={call.canModerate}
                  onCreateRoom={call.createBreakoutRoom}
                  onMove={call.moveParticipantToRoom}
                  onCloseAll={call.closeBreakoutRooms}
                />
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <BarPopoverButton label="Audio & camera settings">
                    <Settings className="size-5" />
                  </BarPopoverButton>
                </PopoverTrigger>
                <CallDeviceSettings />
              </Popover>

              {!call.isGuest && (
                <Popover open={inviteOpen} onOpenChange={setInviteOpen}>
                  <PopoverTrigger asChild>
                    <BarPopoverButton label="Guest join link">
                      <Link2 className="size-5" />
                    </BarPopoverButton>
                  </PopoverTrigger>
                  <CallGuestInvitePanel
                    isHost={call.canModerate}
                    guestKey={call.guestKey}
                    conversationId={call.conversationId}
                    onEnsureKey={call.ensureGuestKey}
                  />
                </Popover>
              )}

              {!call.isGuest && (
                <ControlButton
                  label="Copy call link"
                  onClick={() => void call.copyCallInviteLink()}
                >
                  <Copy className="size-5" />
                </ControlButton>
              )}

              <ControlButton
                label={pipActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
                active={pipActive}
                onClick={() => void togglePip()}
              >
                <PictureInPicture2 className="size-5" />
              </ControlButton>

              <ControlButton label="Leave call" danger onClick={() => void call.leaveCall()}>
                <PhoneOff className="size-5" />
              </ControlButton>
            </div>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
