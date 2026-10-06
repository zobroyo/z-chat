import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  HeadphoneOff,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { UseCallResult } from "@/hooks/use-call";
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

/** Video element that always follows the supplied MediaStream. */
function StreamVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);

  // Always muted: remote audio is played by the hook's hidden <audio> element,
  // so unmuting here would double the sound.
  return <video ref={ref} autoPlay playsInline muted className="size-full object-cover" />;
}

function ParticipantTile({
  name,
  muted,
  video,
  stream,
  self = false,
}: {
  name: string;
  muted: boolean;
  video: boolean;
  stream?: MediaStream | null;
  self?: boolean;
}) {
  const showVideo = video && stream instanceof MediaStream;

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
          {muted && <MicOff className="size-3.5 shrink-0 text-destructive" />}
          <span className="max-w-40 truncate">{self ? "You" : name}</span>
        </span>
      </div>
    </div>
  );
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
 * Full-screen call surface shown while joining or inside a call. Renders the
 * participant grid plus mic / camera / deafen / leave controls in the app's
 * existing surface language.
 */
export function CallOverlay({ call, conversationTitle }: CallOverlayProps) {
  if (!call.inCall && !call.joining) return null;

  const showJoining = call.joining && !call.inCall;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-xl">
      <header className="ios-safe-top flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PhoneCall className="size-4" />
        </span>

        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{conversationTitle}</p>
          <p className="truncate text-xs text-muted-foreground">
            {showJoining ? "Connecting…" : `${call.participants.length + 1} in call`}
          </p>
        </div>
      </header>

      {call.error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0">{call.error}</span>
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
              <ParticipantTile
                name="You"
                muted={call.muted || call.deafened}
                video={call.cameraOn}
                stream={call.localStream}
                self
              />

              {call.participants.map((participant) => (
                <ParticipantTile
                  key={participant.id}
                  name={participant.name}
                  muted={participant.muted}
                  video={participant.video}
                  stream={call.remoteStreams[participant.id] ?? null}
                />
              ))}
            </div>

            {call.participants.length === 0 && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Waiting for others to join…
              </p>
            )}
          </>
        )}
      </div>

      <div className="ios-safe-bottom flex shrink-0 items-center justify-center gap-3 border-t border-border bg-surface/70 px-4 py-4 backdrop-blur">
        <TooltipProvider delayDuration={200}>
          <ControlButton
            label={call.muted ? "Unmute" : "Mute"}
            active={call.muted}
            onClick={call.toggleMute}
          >
            {call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
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

          <ControlButton label="Leave call" danger onClick={() => void call.leaveCall()}>
            <PhoneOff className="size-5" />
          </ControlButton>
        </TooltipProvider>
      </div>
    </div>
  );
}
