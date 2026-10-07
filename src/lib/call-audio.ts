/*
 * Shared Web Audio plumbing for the call stack.
 *
 * One AudioContext powers:
 *  - remote participant playback, routed through per-peer GainNodes so the
 *    volume slider can express 0-200% (HTMLMediaElement.volume caps at 1),
 *  - synthesized soundboard jingles.
 *
 * Everything here is defensive: browsers block AudioContext until a user
 * gesture, so callers must tolerate a `null` context or a suspended state and
 * fall back to plain <audio> playback.
 */

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  if (typeof AudioContext !== "undefined") return AudioContext;
  const legacy = (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return legacy ?? null;
}

let sharedContext: AudioContext | null = null;

/** Returns the shared call AudioContext, creating it on first use. */
export function getCallAudioContext(): AudioContext | null {
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
  } catch {
    sharedContext = null;
  }
  return sharedContext;
}

/** Best-effort resume. Safe to call on user gestures; never throws. */
export function resumeCallAudio(): Promise<boolean> {
  const context = getCallAudioContext();
  if (!context) return Promise.resolve(false);
  if (context.state === "running") return Promise.resolve(true);
  try {
    return context.resume().then(
      () => context.state === "running",
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export function callAudioRunning(): boolean {
  const context = sharedContext;
  return !!context && context.state === "running";
}
