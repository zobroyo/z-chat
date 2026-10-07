/*
 * Synthesized incoming-call ringtone — Web Audio only, no audio assets.
 *
 * A classic double-tone ring pattern (440 Hz + 480 Hz burst, repeating) until
 * stopped. Browsers block AudioContext before the first user interaction, so
 * the handle reports `isBlocked()` and the UI falls back to a visual prompt;
 * `resume()` retries playback after a gesture. Nothing in here throws.
 */

const CADENCE_MS = 2600;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  if (typeof AudioContext !== "undefined") return AudioContext;
  const legacy = (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return legacy ?? null;
}

export type RingtoneHandle = {
  stop: () => void;
  resume: () => void;
  isBlocked: () => boolean;
};

export function startRingtone(onBlockedChange?: (blocked: boolean) => void): RingtoneHandle {
  let context: AudioContext | null = null;
  let interval: number | null = null;
  let stopped = false;
  const live = new Set<OscillatorNode>();

  const Ctor = audioContextCtor();
  if (Ctor) {
    try {
      context = new Ctor();
    } catch {
      context = null;
    }
  }

  const playBurst = () => {
    if (!context || context.state !== "running") return;
    try {
      const now = context.currentTime;
      const master = context.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
      master.gain.setValueAtTime(0.16, now + 0.75);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
      master.connect(context.destination);

      for (const frequency of [440, 480]) {
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(master);
        oscillator.start(now);
        oscillator.stop(now + 1);
        live.add(oscillator);
        oscillator.onended = () => live.delete(oscillator);
      }
    } catch {
      // A dying context is not worth crashing a call over.
    }
  };

  const resumeContext = () => {
    if (!context) return;
    try {
      void context.resume().catch(() => undefined);
    } catch {
      // Ignore — the visual fallback still shows.
    }
  };

  if (context) {
    try {
      context.onstatechange = () => onBlockedChange?.(context?.state !== "running");
    } catch {
      // property assignment on a hostile context implementation
    }
    resumeContext();
    playBurst();
    onBlockedChange?.(context.state !== "running");

    interval = window.setInterval(() => {
      if (stopped || !context) return;
      if (context.state === "suspended") resumeContext();
      playBurst();
      onBlockedChange?.(context.state !== "running");
    }, CADENCE_MS);
  } else {
    onBlockedChange?.(true);
  }

  return {
    stop: () => {
      stopped = true;
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
      for (const oscillator of live) {
        try {
          oscillator.stop();
        } catch {
          // Already stopped.
        }
      }
      live.clear();
      if (context) {
        try {
          context.onstatechange = null;
          void context.close().catch(() => undefined);
        } catch {
          // Ignore.
        }
        context = null;
      }
    },
    resume: () => {
      if (!context) return;
      resumeContext();
      window.setTimeout(() => {
        if (!stopped) onBlockedChange?.(context?.state !== "running");
      }, 250);
    },
    isBlocked: () => !context || context.state !== "running",
  };
}
