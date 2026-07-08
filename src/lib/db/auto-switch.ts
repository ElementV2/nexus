import { readJson, writeJson } from "./index";
import {
  defaultConfig,
  refId,
  type AutoCamera,
  type AutoInputRef,
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

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v ? v.slice(0, max) : undefined;
}

/** One input ref: v2 `{key, input, label}` object, or a legacy bare number
 *  (pre-GUID configs) which migrates with an empty key — the engine backfills
 *  the GUID from the live snapshot on the first connected tick. Valid as long
 *  as it has a key OR a positive number. */
function sanitizeRef(raw: unknown): AutoInputRef | null {
  if (typeof raw === "number" || typeof raw === "string") {
    const input = inputNum(raw);
    return input === null ? null : { key: "", input, label: undefined };
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = str(r.key, 64) ?? "";
  const input = inputNum(r.input) ?? 0;
  if (!key && input === 0) return null;
  return { key, input, label: str(r.label, 64) };
}

function sanitizeMics(raw: unknown): AutoInputRef[] {
  // An explicitly empty list is kept (a camera with no mic — a pure visual
  // source). The "default to own input" is applied only when the field is
  // ABSENT (see sanitizeCameras).
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw !== undefined) list = [raw];
  const out: AutoInputRef[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const ref = sanitizeRef(v);
    if (ref && !seen.has(refId(ref))) {
      seen.add(refId(ref));
      out.push(ref);
    }
  }
  return out;
}

function sanitizeCameras(raw: unknown): AutoCamera[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoCamera[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const ref = sanitizeRef(c);
    if (ref === null || seen.has(refId(ref))) continue;
    seen.add(refId(ref));
    // Default to the camera's own input ONLY when no mic field was provided
    // (fresh add / legacy migration). An explicitly emptied list stays empty so
    // a mic can be fully removed, even from a camera input. Legacy fields:
    // `audioInputs: number[]` then, further back, `audioInput: number`.
    const hasMicField =
      r.mics !== undefined || r.audioInputs !== undefined || r.audioInput !== undefined;
    const mics = hasMicField
      ? sanitizeMics(r.mics ?? r.audioInputs ?? r.audioInput)
      : [{ ...ref }];
    out.push({ ...ref, mics, enabled: bool(r.enabled, true) });
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
