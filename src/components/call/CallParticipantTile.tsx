import { useEffect, useRef } from "react";
import { Crown, HeadphoneOff, MicOff, Volume2, VolumeX } from "lucide-react";

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
};

/**
 * One participant tile: avatar/video plus, for remote participants, a compact
 * popover with the 0-200% volume slider, local mute and (host only) server mute.
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
}: CallParticipantTileProps) {
  const showVideo = video && stream instanceof MediaStream;
  const showControls = !self && !!onVolumeChange;

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface">
      {showVideo ? (
        <StreamVideo stream={stream} />
      ) : (
        <Avatar className="size-16">
          <AvatarFallback className="bg-surface-2 font-display text-lg font-semibold text-muted-foreground">
            {initialsOf(name)}
          </AvatarFallback>
        </Avatar>
      )}

      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 rounded-lg bg-background/70 px-2 py-1 text-xs font-medium text-foreground backdrop-blur">
          {(serverMuted || muted) && <MicOff className="size-3.5 shrink-0 text-destructive" />}
          {deafened && <HeadphoneOff className="size-3.5 shrink-0 text-amber-400" />}
          {localMuted && <VolumeX className="size-3.5 shrink-0 text-amber-400" />}
          {isHost && <Crown className="size-3.5 shrink-0 text-primary" aria-label="Call host" />}
          <span className="max-w-40 truncate">{self ? "You" : name}</span>
          {isGuest && !self && (
            <span className="rounded bg-surface-2 px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              guest
            </span>
          )}
          {serverMuted && !self && (
            <span className="text-[10px] font-semibold text-destructive">muted by host</span>
          )}
        </span>

        {showControls && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "ml-auto size-8 shrink-0 rounded-lg border border-border bg-background/70 text-foreground backdrop-blur hover:bg-surface",
                  localMuted && "border-amber-400/50 text-amber-400",
                )}
                aria-label={`Audio options for ${name}`}
                title={`Audio options for ${name}`}
              >
                {localMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-64 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="truncate">{name}</span>
                  <span className="text-muted-foreground">{volume}%</span>
                </div>
                <Slider
                  className="mt-2"
                  value={[volume]}
                  min={0}
                  max={200}
                  step={5}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (typeof next === "number") onVolumeChange?.(next);
                  }}
                  aria-label={`Volume for ${name}`}
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>0%</span>
                  <span>100%</span>
                  <span>200%</span>
                </div>
              </div>

              {onToggleLocalMute && (
                <Button
                  type="button"
                  variant={localMuted ? "secondary" : "outline"}
                  size="sm"
                  className="w-full"
                  onClick={onToggleLocalMute}
                >
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
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
