import { useEffect, useRef, useState } from "react";
import {
  Ban,
  Crown,
  HeadphoneOff,
  Mic,
  MicOff,
  MoreHorizontal,
  UserMinus,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { initialsOf } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** Video element that always follows the supplied MediaStream. */
function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);

  // Always muted: remote audio is played by the hook's audio graph / hidden
  // <audio> element, so unmuting here would double the sound.
  return <video ref={ref} autoPlay playsInline muted className="size-full object-cover" />;
}

export type CallParticipantTileProps = {
  name: string;
  muted: boolean;
  video: boolean;
  stream?: MediaStream | null;
  self?: boolean;
  deafened?: boolean;
  serverMuted?: boolean;
  localMuted?: boolean;
  isHost?: boolean;
  isGuest?: boolean;
  volume?: number;
  /** Current user is the host and may moderate this tile. */
  canModerate?: boolean;
  onVolumeChange?: (volume: number) => void;
  onToggleLocalMute?: () => void;
  onToggleServerMute?: () => void;
  /** Host only: remove the participant (they may rejoin). */
  onKick?: () => void;
  /** Host only: ban the participant for the call session. */
  onBan?: () => void;
};

/**
 * One large "floating island" participant tile: video fills the tile
 * (object-cover), avatar/initials when the camera is off, a name pill with mic
 * status bottom-left and a hover-revealed options menu (volume, local mute,
 * host server-mute / kick / ban).
 */
export function CallParticipantTile({
  name,
  muted,
  video,
  stream,
  self = false,
  deafened = false,
  serverMuted = false,
  localMuted = false,
  isHost = false,
  isGuest = false,
  volume = 100,
  canModerate = false,
  onVolumeChange,
  onToggleLocalMute,
  onToggleServerMute,
  onKick,
  onBan,
}: CallParticipantTileProps) {
  const [confirm, setConfirm] = useState<null | "kick" | "ban">(null);
  const showVideo = video && stream instanceof MediaStream;
  const showOptions = !self && (!!onVolumeChange || (canModerate && (!!onKick || !!onBan)));

  return (
    <div
      data-testid="call-tile"
      className="group relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] ring-1 ring-white/5 sm:rounded-3xl"
    >
      {showVideo ? (
        <>
          <StreamVideo stream={stream} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        </>
      ) : (
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-white/[0.07] via-transparent to-black/40">
          <Avatar className="size-16 sm:size-24">
            <AvatarFallback className="bg-white/10 font-display text-lg font-semibold text-white/80 sm:text-2xl">
              {initialsOf(name)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      <div className="absolute right-2 bottom-2 left-2 flex items-end justify-between gap-2 sm:right-3 sm:bottom-3 sm:left-3">
        <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white shadow-lg backdrop-blur">
          {muted ? (
            <MicOff className="size-3.5 shrink-0 text-red-400" />
          ) : (
            <Mic className="size-3.5 shrink-0 text-white/70" />
          )}
          {deafened && <HeadphoneOff className="size-3.5 shrink-0 text-amber-400" />}
          {localMuted && <VolumeX className="size-3.5 shrink-0 text-amber-400" />}
          {isHost && <Crown className="size-3.5 shrink-0 text-primary" aria-label="Call host" />}
          <span className="max-w-40 truncate sm:max-w-56">{self ? "You" : name}</span>
          {isGuest && !self && (
            <span className="rounded bg-white/15 px-1 text-[10px] font-semibold tracking-wide text-white/70 uppercase">
              guest
            </span>
          )}
          {serverMuted && !self && (
            <span className="shrink-0 text-[10px] font-semibold text-red-400">muted by host</span>
          )}
        </span>

        {showOptions && (
          <div className="flex shrink-0 items-center gap-1.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <Popover
              onOpenChange={(open) => {
                if (!open) setConfirm(null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 rounded-full border border-white/15 bg-black/60 text-white backdrop-blur hover:bg-black/80 hover:text-white",
                    localMuted && "border-amber-400/60 text-amber-300",
                  )}
                  aria-label={`Participant options for ${name}`}
                  title={`Participant options for ${name}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </PopoverTrigger>

              <PopoverContent align="end" className="w-64 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="truncate">{name}</span>
                    <span className="text-muted-foreground">{volume}%</span>
                  </div>
                  {onVolumeChange && (
                    <>
                      <Slider
                        className="mt-2"
                        value={[volume]}
                        min={0}
                        max={200}
                        step={5}
                        onValueChange={(values) => {
                          const next = values[0];
                          if (typeof next === "number") onVolumeChange(next);
                        }}
                        aria-label={`Volume for ${name}`}
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>0%</span>
                        <span>100%</span>
                        <span>200%</span>
                      </div>
                    </>
                  )}
                </div>

                {onToggleLocalMute && (
                  <Button
                    type="button"
                    variant={localMuted ? "secondary" : "outline"}
                    size="sm"
                    className="w-full"
                    onClick={onToggleLocalMute}
                  >
                    {localMuted ? <Volume2 className="mr-2 size-4" /> : <VolumeX className="mr-2 size-4" />}
                    {localMuted ? "Unmute for me" : "Mute for me only"}
                  </Button>
                )}

                {canModerate && onToggleServerMute && (
                  <Button
                    type="button"
                    variant={serverMuted ? "secondary" : "destructive"}
                    size="sm"
                    className="w-full"
                    onClick={onToggleServerMute}
                  >
                    {serverMuted ? "Remove server mute" : "Server mute (everyone)"}
                  </Button>
                )}

                {canModerate && (onKick || onBan) && (
                  <div className="space-y-2 border-t border-border pt-3">
                    {confirm === null ? (
                      <>
                        {onKick && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => setConfirm("kick")}
                            aria-label={`Kick ${name} from call`}
                          >
                            <UserMinus className="mr-2 size-4" />
                            Kick {name} from call
                          </Button>
                        )}
                        {onBan && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => setConfirm("ban")}
                            aria-label={`Ban ${name} from call`}
                          >
                            <Ban className="mr-2 size-4" />
                            Ban {name} from call
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {confirm === "kick"
                            ? `Remove ${name} from the call? They can rejoin.`
                            : `Ban ${name}? They cannot rejoin this call.`}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={confirm === "ban" ? "destructive" : "default"}
                            onClick={() => {
                              if (confirm === "kick") onKick?.();
                              else onBan?.();
                              setConfirm(null);
                            }}
                            aria-label={
                              confirm === "kick" ? `Confirm kick ${name}` : `Confirm ban ${name}`
                            }
                          >
                            {confirm === "kick" ? "Kick" : "Ban"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirm(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </div>
  );
}
