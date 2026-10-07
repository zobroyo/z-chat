/*
 * Soundboard: short synthesized jingles any call participant can trigger for
 * everyone. Every sound is generated with oscillators / filtered noise at
 * playback time — no samples, no copyrighted material.
 *
 * Transport: the trigger is broadcast on the call channel and every client
 * synthesizes the sound locally, so the audio is never mixed into WebRTC.
 */

import { getCallAudioContext, resumeCallAudio } from "./call-audio";

export type CallSound = {
  id: string;
  label: string;
};

export const CALL_SOUNDS: CallSound[] = [
  { id: "ding", label: "Ding" },
  { id: "pop", label: "Pop" },
  { id: "chime", label: "Chime" },
  { id: "tada", label: "Tada" },
  { id: "boing", label: "Boing" },
  { id: "drumroll", label: "Drumroll" },
  { id: "buzz", label: "Buzz" },
  { id: "applause", label: "Applause" },
];

type ToneOptions = {
  frequency: number;
  start: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
  glideTo?: number;
  attack?: number;
};

function tone(context: AudioContext, options: ToneOptions): void {
  const peak = options.gain ?? 0.18;
  const attack = options.attack ?? 0.015;
  const end = options.start + options.duration;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, options.start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), options.start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = options.type ?? "sine";
  oscillator.frequency.setValueAtTime(Math.max(options.frequency, 1), options.start);
  if (options.glideTo !== undefined) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(options.glideTo, 1), end);
  }
  oscillator.connect(gain);
  oscillator.start(options.start);
  oscillator.stop(end + 0.03);
}

function noiseBurst(
  context: AudioContext,
  start: number,
  duration: number,
  gainValue: number,
  centerFrequency: number,
): void {
  const frames = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = centerFrequency;
  filter.Q.value = 0.7;

  const gain = context.createGain();
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration + 0.03);
}

function synth(context: AudioContext, id: string): void {
  const now = context.currentTime + 0.02;

  switch (id) {
    case "ding":
      tone(context, { frequency: 880, start: now, duration: 0.4, gain: 0.2 });
      tone(context, { frequency: 1318.5, start: now + 0.12, duration: 0.5, gain: 0.16 });
      return;
    case "pop":
      tone(context, { frequency: 340, start: now, duration: 0.16, gain: 0.3, glideTo: 90 });
      return;
    case "chime":
      tone(context, { frequency: 659.25, start: now, duration: 0.55, gain: 0.15 });
      tone(context, { frequency: 880, start: now + 0.16, duration: 0.55, gain: 0.15 });
      tone(context, { frequency: 1108.73, start: now + 0.32, duration: 0.7, gain: 0.15 });
      return;
    case "tada":
      tone(context, { frequency: 523.25, start: now, duration: 0.18, gain: 0.16 });
      tone(context, { frequency: 659.25, start: now + 0.12, duration: 0.18, gain: 0.16 });
      tone(context, { frequency: 783.99, start: now + 0.24, duration: 0.18, gain: 0.16 });
      tone(context, { frequency: 1046.5, start: now + 0.36, duration: 0.6, gain: 0.18 });
      return;
    case "boing":
      tone(context, {
        frequency: 420,
        start: now,
        duration: 0.5,
        gain: 0.24,
        glideTo: 120,
        type: "triangle",
      });
      tone(context, {
        frequency: 212,
        start: now + 0.02,
        duration: 0.45,
        gain: 0.1,
        glideTo: 70,
        type: "sine",
      });
      return;
    case "drumroll": {
      for (let index = 0; index < 14; index += 1) {
        noiseBurst(context, now + index * 0.055, 0.05, 0.12, 900);
      }
      tone(context, { frequency: 140, start: now + 0.8, duration: 0.25, gain: 0.24, type: "triangle" });
      return;
    }
    case "buzz":
      tone(context, { frequency: 130.81, start: now, duration: 0.45, gain: 0.14, type: "square" });
      tone(context, { frequency: 132.5, start: now, duration: 0.45, gain: 0.12, type: "square" });
      return;
    case "applause":
      noiseBurst(context, now, 0.9, 0.16, 2200);
      noiseBurst(context, now + 0.1, 0.7, 0.12, 900);
      noiseBurst(context, now + 0.25, 0.5, 0.08, 3200);
      return;
    default:
      return;
  }
}

/** Plays a sound if Web Audio is available and unlocked; silently gives up otherwise. */
export function playCallSound(id: string): void {
  const context = getCallAudioContext();
  if (!context) return;

  const play = () => {
    try {
      synth(context, id);
    } catch {
      // Never let a sound break the call.
    }
  };

  if (context.state === "running") {
    play();
    return;
  }
  void resumeCallAudio().then((running) => {
    if (running) play();
  });
}
