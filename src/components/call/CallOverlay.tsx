import { useState } from "react";
import {
  AlertTriangle,
  Copy,
  DoorOpen,
  HeadphoneOff,
  Headphones,
  Link2,
  Loader2,
  Mic,
  MicOff,
  Music,
  PhoneCall,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CallBreakoutPanel } from "@/components/call/CallBreakoutPanel";
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
function BarPopoverButton({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-11 shrink-0 rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:size-12",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

/**
 * Full-screen call surface: incoming ring, a Google-Meet-style participant
 * grid that fills the viewport, and a floating dynamic-island controls pill
 * (mic / camera / deafen / soundboard / breakouts / guest link / leave).
 */
export function CallOverlay({ call, conversationTitle }: CallOverlayProps) {
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-1.5 backdrop-blur-2xl sm:p-3">
      <div
        data-testid="call-overlay"
        className="relative flex h-[96vh] w-[98vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c11]/95 text-white shadow-2xl sm:rounded-3xl"
      >
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
        </header>

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
          ) : (
            <div
              data-testid="call-grid"
              className={cn(
                "grid h-full w-full auto-rows-fr gap-1.5 sm:gap-2.5",
                participantGridClass(totalTiles),
              )}
            >
              <CallParticipantTile
                name="You"
                muted={call.muted || call.deafened || call.serverMuted}
                video={call.cameraOn}
                stream={call.localStream}
                self
                deafened={call.deafened}
                serverMuted={call.serverMuted}
                isHost={call.isHost}
              />

              {roomParticipants.map((participant) => (
                <CallParticipantTile
                  key={participant.id}
                  name={participant.name}
                  muted={participant.muted || participant.serverMuted}
                  video={participant.video}
                  stream={call.remoteStreams[participant.id] ?? null}
                  deafened={participant.deafened}
                  serverMuted={participant.serverMuted}
                  localMuted={participant.localMuted}
                  isHost={participant.id === call.hostId}
                  isGuest={participant.isGuest}
                  volume={participant.volume}
                  canModerate={call.isHost}
                  onVolumeChange={(volume) => call.setParticipantVolume(participant.id, volume)}
                  onToggleLocalMute={() => call.toggleParticipantLocalMute(participant.id)}
                  onToggleServerMute={() =>
                    call.setParticipantServerMute(participant.id, !participant.serverMuted)
                  }
                  onKick={() => call.kickParticipant(participant.id)}
                  onBan={() => call.banParticipant(participant.id)}
                />
              ))}
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
                  isHost={call.isHost}
                  onCreateRoom={call.createBreakoutRoom}
                  onMove={call.moveParticipantToRoom}
                  onCloseAll={call.closeBreakoutRooms}
                />
              </Popover>

              {!call.isGuest && (
                <Popover open={inviteOpen} onOpenChange={setInviteOpen}>
                  <PopoverTrigger asChild>
                    <BarPopoverButton label="Guest join link">
                      <Link2 className="size-5" />
                    </BarPopoverButton>
                  </PopoverTrigger>
                  <CallGuestInvitePanel
                    isHost={call.isHost}
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
