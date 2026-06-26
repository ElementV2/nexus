import { readJson, writeJson } from "./index";
import {
  defaultConfig,
  type AutoCamera,
  type AutoPreset,
  type AutoSwitchConfig,
  type TransitionType,
} from "@/lib/auto-switch/types";

/**
 * Persistence for the auto-switching config — a single `auto-switch.json`
 * (the feature targets the DEFAULT vMix only, so there's one config, not one
 * per connection). Read/written through the same atomic JSON helpers as the
 * rest of the app; every field is clamped/sanitized on read so a hand-edited
 * or schema-drifted file can never feed the engine a NaN threshold.
 */

const FILE = "auto-switch.json";

const TRANSITIONS: TransitionType[] = [
  "Cut",
  "Fade",
  "AlphaFade",
  "Merge",
  "Wipe",
  "Zoom",
];
const PRESETS: AutoPreset[] = ["calm", "standard", "reactive", "custom"];

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function inputNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function sanitizeAudioInputs(raw: unknown): number[] {
  // New shape: `audioInputs: number[]`. Legacy shape: `audioInput: number`.
  // An explicitly empty list is kept (a camera with no mic — a pure visual
  // source). The "default to own input" is applied only when the field is
  // ABSENT (see sanitizeCameras).
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw !== undefined) list = [raw];
  const out: number[] = [];
  for (const v of list) {
    const n = inputNum(v);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

function sanitizeCameras(raw: unknown): AutoCamera[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoCamera[] = [];
  const seen = new Set<number>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const input = inputNum(r.input);
    if (input === null || seen.has(input)) continue;
    seen.add(input);
    // Default to the camera's own input ONLY when no audio field was provided
    // (fresh add / legacy migration). An explicitly emptied list stays empty so
    // a mic can be fully removed, even from a camera input.
    const hasAudioField = r.audioInputs !== undefined || r.audioInput !== undefined;
    const audioInputs = hasAudioField
      ? sanitizeAudioInputs(r.audioInputs ?? r.audioInput)
      : [input];
    out.push({
      input,
      audioInputs,
      label: typeof r.label === "string" ? r.label.slice(0, 64) : undefined,
      enabled: bool(r.enabled, true),
    });
  }
  return out;
}

/** Fully sanitize an arbitrary raw object into a valid config. Every field is
 *  clamped / type-checked / defaulted, so a hand-edited or schema-drifted blob
 *  (or an unvalidated PUT body) can never feed the engine a bad value. Pure —
 *  unit-tested directly. */
export function sanitizeConfig(raw: unknown): AutoSwitchConfig {
  const def = defaultConfig();
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Record<string, unknown>;
  const det = (r.detection ?? {}) as Record<string, unknown>;
  const tim = (r.timing ?? {}) as Record<string, unknown>;
  const tr = (r.transition ?? {}) as Record<string, unknown>;
  const preset = PRESETS.includes(r.preset as AutoPreset)
    ? (r.preset as AutoPreset)
    : def.preset;
  const transitionType = TRANSITIONS.includes(tr.type as TransitionType)
    ? (tr.type as TransitionType)
    : def.transition.type;
  return {
    enabled: bool(r.enabled, false),
    cameras: sanitizeCameras(r.cameras),
    transition: {
      type: transitionType,
      durationMs: num(tr.durationMs, def.transition.durationMs, 0, 10000),
    },
    preset,
    detection: {
      openDb: num(det.openDb, def.detection.openDb, -90, 0),
      closeDb: num(det.closeDb, def.detection.closeDb, -90, 0),
      activationHoldMs: num(det.activationHoldMs, def.detection.activationHoldMs, 0, 5000),
      releaseHangMs: num(det.releaseHangMs, def.detection.releaseHangMs, 0, 10000),
    },
    timing: {
      minOnCamMs: num(tim.minOnCamMs, def.timing.minOnCamMs, 0, 120000),
      reactionHoldMs: num(tim.reactionHoldMs, def.timing.reactionHoldMs, 0, 30000),
    },
    manualOverrideMs: num(r.manualOverrideMs, def.manualOverrideMs, 0, 60000),
    manualHold: bool(r.manualHold, def.manualHold),
  };
}

/** Read + fully sanitize. Missing file → built-in default (disabled). */
export function getAutoSwitchConfig(): AutoSwitchConfig {
  return sanitizeConfig(readJson<unknown>(FILE, null));
}

export function setAutoSwitchConfig(config: unknown): AutoSwitchConfig {
  // Sanitize FIRST so the on-disk file only ever holds valid, clamped values
  // (a bad PUT body can't persist garbage), then return the clean config.
  const clean = sanitizeConfig(config);
  writeJson(FILE, clean);
  return clean;
}
