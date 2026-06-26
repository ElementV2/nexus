/**
 * Auto-switching ("auto-réalisation") — types + presets.
 *
 * The engine watches per-input audio meters on the DEFAULT vMix (same
 * instance the Live page drives) and switches the program output to whoever
 * is talking, with a director's restraint: a cough never triggers a cut, a
 * camera is held a minimum time, and the wide shot is used to breathe
 * (silence, debate, periodic aération).
 *
 * All thresholds are in dB on the meter scale where 0 dB = digital full
 * scale and silence ≈ -∞ (see `meterToDb` in `lib/utils/audio.ts`). Speech
 * typically peaks around -20…-10 dB, so a gate around -38 dB is a sane open
 * point.
 */

/** vMix transition Function used for a switch. Mirrors the curated set on the
 *  Live page header (`AlphaFade` = vMix 29+ alpha-correct fade). `Cut` ignores
 *  the duration. */
export type TransitionType =
  | "Cut"
  | "Fade"
  | "AlphaFade"
  | "Merge"
  | "Wipe"
  | "Zoom";

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  Cut: "Cut",
  Fade: "Fade",
  AlphaFade: "α Fade",
  Merge: "Merge",
  Wipe: "Wipe",
  Zoom: "Zoom",
};

/** A camera participating in the auto-mix. `input` is the vMix input switched
 *  to program; `audioInputs` are the input(s) whose meters drive it — the cam
 *  counts as "talking" when ANY of them is active on air, and its level is the
 *  loudest of them. Defaults to `[input]` (the cam carries its own mic) but can
 *  be any set of other inputs / audio-only inputs (e.g. a group shot framing
 *  three people, driven by their three mics). An empty list = never auto-
 *  selected by speech (e.g. a visual you only insert via the wide shot). */
export interface AutoCamera {
  input: number;
  audioInputs: number[];
  label?: string;
  enabled: boolean;
}

export type AutoPreset = "calm" | "standard" | "reactive" | "custom";

/** Detection tuning — how a raw meter becomes a clean "is talking" signal. */
export interface AutoDetection {
  /** dB above which a source starts counting toward "talking". */
  openDb: number;
  /** dB below which it starts counting toward "silent" (hysteresis band
   *  between close and open prevents flapping at the threshold). */
  closeDb: number;
  /** ms a source must stay above `openDb` before it's accepted as talking.
   *  This is the cough/transient reject — a short spike never reaches it. */
  activationHoldMs: number;
  /** ms a source must stay below `closeDb` before it's dropped. Holds the
   *  shot across the natural gaps between words/sentences. */
  releaseHangMs: number;
}

export interface AutoTiming {
  /** Minimum ms a camera stays on air before ANY switch is allowed — the core
   *  anti-ping-pong dwell, and the minimum on-air time a freshly-cut shot (e.g.
   *  a 2-shot that just arrived) gets before we can move off it. */
  minOnCamMs: number;
  /** How long a monologue reaction shot is held before returning to the
   *  speaker. */
  reactionHoldMs: number;
}

export interface AutoSwitchConfig {
  enabled: boolean;
  cameras: AutoCamera[];
  transition: { type: TransitionType; durationMs: number };
  preset: AutoPreset;
  detection: AutoDetection;
  timing: AutoTiming;
  /** After a manual operator switch (or any external program change), pause
   *  the auto-mix for this long so it never fights the human (0 = off). Ignored
   *  when `manualHold` is on. */
  manualOverrideMs: number;
  /** When true, a manual switch fully STOPS the auto-mix (turns it OFF) until
   *  the operator relaunches it (clicks AUTO) — no timer. Takes precedence over
   *  `manualOverrideMs`. */
  manualHold: boolean;
}

/** Live per-camera readout pushed to the UI for the "talking" dot. Keyed by
 *  the camera's program input (a camera can aggregate several mics). */
export interface AutoSourceStatus {
  camInput: number;
  /** Smoothed level, dB (loudest mic of the camera). */
  db: number;
  /** 0..1 for a VU bar (see `meterToLevel`). */
  level: number;
  speaking: boolean;
}

/** Engine state streamed over SSE. */
export interface AutoSwitchState {
  enabled: boolean;
  /** Engine is actively deciding (enabled AND a connected default vMix). */
  running: boolean;
  connected: boolean;
  /** Human-readable explanation of the current shot, for the status chip. */
  reason: string;
  /** Input currently on program (read from vMix), or null. */
  programInput: number | null;
  /** ms the current program input has been on air. */
  msOnCurrent: number;
  /** ms until the next monologue reaction cut may fire, or null. */
  nextVarietyInMs: number | null;
  /** ms remaining of a manual-override pause, or null. */
  overrideForMs: number | null;
  sources: AutoSourceStatus[];
}

// ─────────────────────────── Presets ──────────────────────────────────

/** Detection + timing bundles. "Custom" keeps whatever the operator last set;
 *  the three named presets push these values.
 *
 *  The mix follows the conversation (1 talker → solo, 2 → 2-shot). `minOnCamMs`
 *  is the dwell — the floor before any switch (incl. following a new speaker)
 *  AND the minimum on-air time a freshly-cut shot gets — so keep it short for
 *  responsiveness but long enough to avoid a flicker. */
export const PRESETS: Record<
  Exclude<AutoPreset, "custom">,
  { detection: AutoDetection; timing: AutoTiming }
> = {
  calm: {
    detection: { openDb: -38, closeDb: -46, activationHoldMs: 600, releaseHangMs: 1500 },
    timing: { minOnCamMs: 2500, reactionHoldMs: 3500 },
  },
  standard: {
    detection: { openDb: -38, closeDb: -45, activationHoldMs: 400, releaseHangMs: 1000 },
    timing: { minOnCamMs: 2000, reactionHoldMs: 3000 },
  },
  reactive: {
    detection: { openDb: -40, closeDb: -46, activationHoldMs: 250, releaseHangMs: 700 },
    timing: { minOnCamMs: 1200, reactionHoldMs: 2500 },
  },
};

export function defaultConfig(): AutoSwitchConfig {
  const p = PRESETS.standard;
  return {
    enabled: false,
    cameras: [],
    transition: { type: "AlphaFade", durationMs: 500 },
    preset: "standard",
    detection: { ...p.detection },
    timing: { ...p.timing },
    manualOverrideMs: 8000,
    manualHold: false,
  };
}

/** Merge a preset's tuning into a config (keeps cameras / transition).
 *  Used when the operator picks a preset. */
export function applyPreset(
  config: AutoSwitchConfig,
  preset: AutoPreset
): AutoSwitchConfig {
  if (preset === "custom") return { ...config, preset };
  const p = PRESETS[preset];
  return {
    ...config,
    preset,
    detection: { ...p.detection },
    timing: { ...p.timing },
  };
}
