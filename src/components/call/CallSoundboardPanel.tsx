import { AudioLines, Bell, Bug, Drum, Droplet, Hand, Music, PartyPopper } from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import type { CallSound } from "@/lib/call-sounds";

const SOUND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  ding: Bell,
  pop: Droplet,
  chime: Music,
  tada: PartyPopper,
  boing: AudioLines,
  drumroll: Drum,
  buzz: Bug,
  applause: Hand,
};

type Props = {
  sounds: CallSound[];
  onPlay: (soundId: string) => void;
};

/** Compact grid of synthesized jingles any participant can fire into the call. */
export function CallSoundboardPanel({ sounds, onPlay }: Props) {
  return (
    <PopoverContent align="center" className="w-72">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Soundboard
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Everyone in the call hears it. Generated live, no clips.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {sounds.map((sound) => {
          const Icon = SOUND_ICONS[sound.id] ?? Music;
          return (
            <Button
              key={sound.id}
              type="button"
              variant="secondary"
              size="sm"
              className="justify-start gap-2"
              onClick={() => onPlay(sound.id)}
            >
              <Icon className="size-4 shrink-0" />
              {sound.label}
            </Button>
          );
        })}
      </div>
    </PopoverContent>
  );
}
