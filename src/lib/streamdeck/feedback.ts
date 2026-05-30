import type { DeckBinding } from "@/lib/db/streamdeck";

/**
 * Surface feedbacks for Stream Deck keys: when the world's
 * state (tally, stream/record status, current scene…) matches the
 * binding's intent, the key gets a runtime style override so the
 * operator sees the state at a glance.
 *
 * Implementation is intentionally hardcoded per kind / action id —
 * we don't yet have a generic per-action `feedback` SDK. The
 * payoff for that abstraction is small at this scale; the rules
 * here cover the 90% (tally, stream, record, ftb, OBS scenes) and
 * adding more is a few lines.
 */

export interface FeedbackOverride {
  bgcolor?: string;
  fgcolor?: string;
  /** Replace the button face text — e.g. show the active scene name
   *  on a generic "Set program scene" button. */
  text?: string;
  /** Small dot in the top-right corner. */
  badge?: { color: string; symbol?: string };
}

/** Variables snapshot keyed by `<connectionId>.<varId>`. The bus's
 *  flat list is reshaped before calling so lookups stay O(1) per
 *  evaluation. */
export type VarsByConnection = Record<string, Record<string, unknown>>;

/**
 * Resolve the variables namespace a binding's feedback should read.
 *
 * Resolution mirrors dispatch (`resolveConnectionId`) so the key shows
 * the state of the SAME instance it will control:
 *   1. The step's pin, then the binding's pin (the operator chose
 *      "this key controls vMix #2").
 *   2. The kind's default connection.
 *   3. The first connection of that kind with published variables.
 */
function pickVars(
  kind: string,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  pinned?: string,
  defaultByKind?: Record<string, string>
): Record<string, unknown> | undefined {
  if (pinned && vars[pinned]) return vars[pinned];
  const def = defaultByKind?.[kind];
  if (def && vars[def]) return vars[def];
  const ids = connectionIdsByKind[kind] ?? [];
  for (const id of ids) {
    if (vars[id]) return vars[id];
  }
  return undefined;
}

export function evaluateFeedback(
  binding: DeckBinding,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  defaultByKind?: Record<string, string>
): FeedbackOverride | null {
  const kind = binding.preset.kind;
  const step = binding.preset.steps[0];
  if (!step) return null;
  const action = step.actionId;
  const opts = step.options ?? {};
  const pinned = step.connectionId ?? binding.connectionId;
  const scope = pickVars(
    kind,
    vars,
    connectionIdsByKind,
    pinned,
    defaultByKind
  );
  if (!scope) return null;

  switch (kind) {
    case "vmix":
      return vmixFeedback(action, opts, scope);
    case "obs":
      return obsFeedback(action, opts, scope);
    case "ableton":
      return abletonFeedback(action, opts, scope);
    case "x32":
    case "grandma3":
      return genericConnectivityFeedback(scope);
    default:
      return null;
  }
}

// ─────────────────────────── vMix rules ───────────────────────────────

// Generated action ids (from vmix-shortcut-actions.ts, `sc-<fn-kebab>`)
// whose press takes an Input to PROGRAM via a transition — these double as
// live tally indicators.
const VMIX_PROGRAM_TAKE = new Set([
  "sc-cut",
  "sc-cutdirect",
  "sc-quickplay",
  "sc-fade",
  "sc-merge",
  "sc-wipe",
  "sc-slide",
  "sc-fly",
  "sc-flyrotate",
  "sc-zoom",
  "sc-crosszoom",
  "sc-cube",
  "sc-cubezoom",
  "sc-alphafade",
]);
const VMIX_STREAM = new Set([
  "sc-startstopstreaming",
  "sc-startstreaming",
  "sc-stopstreaming",
]);
const VMIX_RECORD = new Set([
  "sc-startstoprecording",
  "sc-startrecording",
  "sc-stoprecording",
]);

/** The audio bus an action targets, lowercase ("m","a".."g"), or null. */
function vmixBusOf(
  action: string,
  opts: Record<string, unknown>
): string | null {
  if (action.startsWith("sc-masteraudio")) return "m";
  const fixed = /^sc-bus([a-g])audio/.exec(action);
  if (fixed) return fixed[1];
  if (action.startsWith("sc-busxaudio")) {
    const v = typeof opts.value === "string" ? opts.value.toLowerCase() : "";
    return /^[mabcdefg]$/.test(v) ? v : null;
  }
  return null;
}

function vmixFeedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
  const inputOpt = num(opts.input);
  const RED: FeedbackOverride = { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
  const GREEN: FeedbackOverride = { bgcolor: "#34c759", fgcolor: "#000000" };

  // Tally — fire-red when this input is on PROGRAM, green when on PREVIEW.
  // PROGRAM always wins (live priority), on both cut/transition and preview
  // buttons.
  if (VMIX_PROGRAM_TAKE.has(action) || action === "sc-previewinput") {
    if (inputOpt !== undefined && num(vars.tally_active) === inputOpt) return RED;
    if (inputOpt !== undefined && num(vars.tally_preview) === inputOpt) return GREEN;
    return null;
  }

  // Overlay tally — RED when this overlay channel is LIVE (on program) with
  // the button's Input, GREEN when it's staged on PREVIEW (vMix's @_preview).
  // Covers both OverlayInput* and PreviewOverlayInput* buttons. Off/Out/Zoom
  // carry no Input → red when the channel is live, green when only previewed.
  if (
    action.startsWith("sc-overlayinput") ||
    action.startsWith("sc-previewoverlayinput")
  ) {
    const ch = num(opts.ch);
    if (ch === undefined) return null;
    const live = num(vars[`overlay_${ch}`]); // program input, 0 = none
    const pvw = num(vars[`overlay_${ch}_pvw`]); // preview input, 0 = none
    if (inputOpt !== undefined) {
      if (live && live === inputOpt) return RED;
      if (pvw && pvw === inputOpt) return GREEN;
      return null;
    }
    if (live) return RED;
    if (pvw) return GREEN;
    return null;
  }

  // Audio bus on/off — green when the bus is ON, dim when muted.
  const bus = vmixBusOf(action, opts);
  if (bus) {
    const on = vars[`bus_${bus}_on`];
    if (on === true) return GREEN;
    if (on === false) return { bgcolor: "#3a3a3c", fgcolor: "#8e8e93" };
    return null;
  }

  // Per-input audio mute — red MUTE when that input is muted (mic-mute tally).
  if (action === "sc-audio" || action === "sc-audioon" || action === "sc-audiooff") {
    if (inputOpt === undefined) return null;
    return vars[`input_${inputOpt}_muted`] === true
      ? { bgcolor: "#ff3b30", fgcolor: "#ffffff", text: "MUTE" }
      : null;
  }

  // Stream / Record / FTB toggles.
  if (VMIX_STREAM.has(action)) {
    return vars.streaming === true
      ? { bgcolor: "#ff3b30", fgcolor: "#ffffff", text: "● LIVE" }
      : null;
  }
  if (VMIX_RECORD.has(action)) {
    return vars.recording === true
      ? { bgcolor: "#8e44ad", fgcolor: "#ffffff", text: "● REC" }
      : null;
  }
  if (action === "sc-fadetoblack") {
    return vars.fade_to_black === true
      ? { bgcolor: "#000000", fgcolor: "#ff3b30", text: "● FTB" }
      : null;
  }

  return null;
}

// ─────────────────────────── OBS rules ────────────────────────────────

function obsFeedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  const sceneName = typeof opts.sceneName === "string" ? opts.sceneName : undefined;

  if (action === "set-program-scene") {
    if (sceneName && vars.current_program_scene === sceneName) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    return null;
  }
  if (action === "set-preview-scene") {
    // Live priority: a scene that's on PROGRAM stays red even on a
    // preview button (program wins over preview).
    if (sceneName && vars.current_program_scene === sceneName) {
      return { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
    }
    if (sceneName && vars.current_preview_scene === sceneName) {
      return { bgcolor: "#34c759", fgcolor: "#000000" };
    }
    return null;
  }
  if (
    action === "toggle-stream" ||
    action === "start-stream" ||
    action === "stop-stream"
  ) {
    if (vars.streaming === true) {
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
        text: "● LIVE",
      };
    }
    return null;
  }
  if (
    action === "toggle-record" ||
    action === "start-record" ||
    action === "stop-record"
  ) {
    if (vars.recording === true) {
      return {
        bgcolor: "#8e44ad",
        fgcolor: "#ffffff",
        text: "● REC",
      };
    }
    return null;
  }
  if (action === "set-studio-mode") {
    if (vars.studio_mode === true) {
      return { badge: { color: "#34c759" } };
    }
    return null;
  }
  return null;
}

// ─────────────────────────── Ableton rules ────────────────────────────

function abletonFeedback(
  action: string,
  _opts: Record<string, unknown>,
  vars: Record<string, unknown>
): FeedbackOverride | null {
  if (action === "play" || action === "stop" || action === "continue") {
    if (vars.is_playing === true) {
      return { bgcolor: "#34c759", fgcolor: "#000000", text: "● PLAY" };
    }
    return null;
  }
  if (action === "set-metronome") {
    if (vars.metronome === true) {
      return { badge: { color: "#af52de" } };
    }
    return null;
  }
  return null;
}

// ─────────────────────────── Generic ──────────────────────────────────

/**
 * Per-kind fallback for kinds that don't have rich feedbacks yet:
 * dim the key when the underlying connection isn't healthy. Better
 * than a key that visually fires but does nothing because the
 * connection dropped.
 */
function genericConnectivityFeedback(
  vars: Record<string, unknown>
): FeedbackOverride | null {
  if (vars.connected === false) {
    return { fgcolor: "rgba(255,255,255,0.35)", badge: { color: "#ff3b30" } };
  }
  return null;
}
