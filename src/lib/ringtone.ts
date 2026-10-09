/*
 * Incoming-call ringtone — two audio assets: 90% of the time the "du bist
 * gut genug" ring, 10% the "german ringtone call" ring, looped until stopped.
 * Browsers block audio playback before the first user interaction, so the
 * handle reports `isBlocked()` and the UI shows a visual prompt; `resume()`
 * retries after a gesture. Nothing in here throws.
 */

const RING_SOURCES = [
  { src: "/ringtones/ring-main.mp3", probability: 0.9 },
  { src: "/ringtones/ring-alt.mp3", probability: 0.1 },
] as const;

export type RingtoneHandle = {
  stop: () => void;
  resume: () => void;
  isBlocked: () => boolean;
};

function pickSource(): string {
  return Math.random() < RING_SOURCES[0].probability
    ? RING_SOURCES[0].src
    : RING_SOURCES[1].src;
}

export function startRingtone(onBlockedChange?: (blocked: boolean) => void): RingtoneHandle {
  let stopped = false;
  let blocked = true;
  let audio: HTMLAudioElement | null = null;

  const setBlocked = (value: boolean) => {
    blocked = value;
    onBlockedChange?.(value);
  };

  const attemptPlay = () => {
    if (stopped || !audio) return;
    try {
      const promise = audio.play();
      if (promise && typeof promise.then === "function") {
        promise
          .then(() => setBlocked(false))
          .catch(() => setBlocked(true));
        return;
      }
    } catch {
      /* fall through to the paused check */
    }
    setBlocked(audio ? audio.paused : true);
  };

  if (typeof window !== "undefined" && typeof Audio !== "undefined") {
    try {
      audio = new Audio(pickSource());
      audio.loop = true;
      audio.volume = 0.9;
      audio.preload = "auto";
      attemptPlay();
    } catch {
      audio = null;
    }
  }
  if (!audio) setBlocked(true);

  return {
    stop: () => {
      stopped = true;
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
          // A dying element is not worth crashing a call over.
        }
        audio = null;
      }
    },
    resume: () => {
      if (stopped || !audio) return;
      attemptPlay();
      window.setTimeout(() => {
        if (!stopped && audio && !audio.paused) setBlocked(false);
      }, 300);
    },
    isBlocked: () => blocked,
  };
}
