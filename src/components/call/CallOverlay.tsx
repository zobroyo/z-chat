import {
  AlertTriangle,
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
            "size-12 rounded-full border border-border",
            !danger && "bg-surface-2 text-foreground hover:bg-surface",
            !danger &&
              active &&
              "border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90",
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

/**
 * Full-screen call surface: incoming ring, participant grid, breakout rooms,
 * soundboard, guest invite link and the mic / camera / deafen / leave controls.
 */
export function CallOverlay({ call, conversationTitle }: CallOverlayProps) {
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
          <p className="mt-1 text-sm text-muted-foreground">is calling in {conversationTitle}…</p>

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl">
      <header className="ios-safe-top flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PhoneCall className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold">{conversationTitle}</p>
          <p className="truncate text-xs text-muted-foreground">
            {showJoining
              ? "Connecting…"
              : call.participants.length === 0
                ? "Ringing…"
                : inBreakout
                  ? `${roomParticipants.length + 1} in ${roomName(myRoomId, call.breakoutRooms)}`
                  : `${roomParticipants.length + 1} in call`}
          </p>
        </div>

        {!call.isGuest && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Guest join link"
                title="Guest join link"
              >
                <Link2 className="size-5" />
              </Button>
            </PopoverTrigger>
            <CallGuestInvitePanel
              isHost={call.isHost}
              guestKey={call.guestKey}
              conversationId={call.conversationId}
              onEnsureKey={call.ensureGuestKey}
            />
          </Popover>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground hover:text-foreground",
                inBreakout && "text-amber-400 hover:text-amber-300",
              )}
              aria-label="Breakout rooms"
              title="Breakout rooms"
            >
              <DoorOpen className="size-5" />
            </Button>
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
      </header>

      {call.error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0">{call.error}</span>
        </div>
      )}

      {!showJoining && inBreakout && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <DoorOpen className="size-4 shrink-0" />
          <span className="min-w-0">
            You&apos;re in {roomName(myRoomId, call.breakoutRooms)} — only people in this room can
            hear you.
          </span>
        </div>
      )}

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {showJoining ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <p className="text-sm">Joining call…</p>
          </div>
        ) : (
          <>
            <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                />
              ))}
            </div>

            {call.participants.length === 0 && (
              <p className="mt-4 text-center text-xs text-muted-foreground">Ringing…</p>
            )}

            {otherRoomParticipants.length > 0 && (
              <div className="mx-auto mt-4 w-full max-w-5xl rounded-xl border border-border bg-surface/60 px-3 py-2">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  In other rooms
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {otherRoomParticipants
                    .map(
                      (participant) =>
                        `${participant.name} · ${roomName(participant.roomId, call.breakoutRooms)}`,
                    )
                    .join("   ")}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="ios-safe-bottom flex shrink-0 items-center justify-center gap-3 border-t border-border bg-surface/70 px-4 py-4 backdrop-blur">
        <TooltipProvider delayDuration={200}>
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

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-12 rounded-full border border-border bg-surface-2 text-foreground hover:bg-surface"
                aria-label="Soundboard"
                title="Soundboard"
              >
                <Music className="size-5" />
              </Button>
            </PopoverTrigger>
            <CallSoundboardPanel sounds={call.sounds} onPlay={call.playSound} />
          </Popover>

          <ControlButton label="Leave call" danger onClick={() => void call.leaveCall()}>
            <PhoneOff className="size-5" />
          </ControlButton>
        </TooltipProvider>
      </div>
    </div>
  );
}
