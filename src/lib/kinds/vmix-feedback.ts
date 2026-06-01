import { registerFeedback, type FeedbackOverride } from "@/lib/core/feedback";

/**
 * vMix Stream Deck feedback rules. Pure (no broker imports) — see the
 * purity note in `core/feedback.ts`. Registered for kind "vmix" at import.
 *
 * Action ids are the GENERATED ids from `vmix-shortcut-actions.ts`
 * (`sc-<fn-kebab>`); the sets below must track that scheme.
 */

// Generated action ids whose press takes an Input to PROGRAM via a
// transition — these double as live tally indicators.
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

/** vMix input keys are GUIDs (e.g. "8db8...-...-..."). */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does a binding's `input` option match a slot reported by vMix as number
 * `n` with stable key `key`? Bindings pin by KEY (GUID, rename+reorder
 * safe); legacy bindings pin by number.
 */
function vmixInputMatches(opt: unknown, n: unknown, key: unknown): boolean {
  const s = String(opt ?? "").trim();
  if (!s) return false;
  const k = typeof key === "string" ? key : "";
  if (k && s === k) return true; // pinned by key (GUID)
  if (n && s === String(n)) return true; // legacy: pinned by number
  return false;
}

/** Mute state of the input a mute-button targets (by key or number). */
function vmixMutedFor(
  opt: unknown,
  vars: Record<string, unknown>
): boolean | undefined {
  const s = String(opt ?? "").trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) return vars[`input_${s}_muted`] as boolean | undefined;
  // GUID-pinned → find the input number whose published key matches.
  for (const [k, v] of Object.entries(vars)) {
    const m = /^input_(\d+)_key$/.exec(k);
    if (m && v === s) return vars[`input_${m[1]}_muted`] as boolean | undefined;
  }
  return undefined;
}

/**
 * A key-pinned binding whose input has vanished from vMix → "disconnected"
 * style, so a renamed/deleted input is obvious instead of silently dead.
 * Only triggers when we actually have a live input list (`input_keys`).
 */
function vmixDisconnected(
  opt: unknown,
  vars: Record<string, unknown>
): boolean {
  const s = String(opt ?? "").trim();
  if (!GUID_RE.test(s)) return false; // legacy number / no input → not "disconnected"
  const keys = typeof vars.input_keys === "string" ? vars.input_keys : "";
  if (!keys) return false; // vMix offline / no inputs known → don't flag
  return !keys.split(",").includes(s);
}

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
  const hasInput = String(opts.input ?? "").trim() !== "";
  const RED: FeedbackOverride = { bgcolor: "#ff3b30", fgcolor: "#ffffff" };
  const GREEN: FeedbackOverride = { bgcolor: "#34c759", fgcolor: "#000000" };

  // Disconnected — the bound input (pinned by key) no longer exists on vMix
  // (deleted, or vMix not reporting it). Dim + amber so a stale binding is
  // obvious. Applies to any input-targeting action.
  if (hasInput && vmixDisconnected(opts.input, vars)) {
    return { bgcolor: "#1c1c1e", fgcolor: "#8a6d3b" };
  }

  // Tally — fire-red when this input is on PROGRAM, green when on PREVIEW.
  // PROGRAM always wins (live priority), on both cut/transition and preview
  // buttons. Matches the binding's input by key (GUID) OR legacy number.
  if (VMIX_PROGRAM_TAKE.has(action) || action === "sc-previewinput") {
    if (!hasInput) return null;
    if (vmixInputMatches(opts.input, vars.tally_active, vars.tally_active_key))
      return RED;
    if (vmixInputMatches(opts.input, vars.tally_preview, vars.tally_preview_key))
      return GREEN;
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
    const liveNum = num(vars[`overlay_${ch}`]); // program input #, 0 = none
    const pvwNum = num(vars[`overlay_${ch}_pvw`]); // preview input #, 0 = none
    if (hasInput) {
      if (liveNum && vmixInputMatches(opts.input, liveNum, vars[`overlay_${ch}_key`]))
        return RED;
      if (pvwNum && vmixInputMatches(opts.input, pvwNum, vars[`overlay_${ch}_pvw_key`]))
        return GREEN;
      return null;
    }
    if (liveNum) return RED;
    if (pvwNum) return GREEN;
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

  // Per-input audio mute — red when that input is muted (mic-mute tally).
  // Resolves the input by name or number.
  if (action === "sc-audio" || action === "sc-audioon" || action === "sc-audiooff") {
    if (!hasInput) return null;
    return vmixMutedFor(opts.input, vars) === true
      ? { bgcolor: "#ff3b30", fgcolor: "#ffffff" }
      : null;
  }

  // Stream / Record / FTB toggles.
  if (VMIX_STREAM.has(action)) {
    return vars.streaming === true
      ? { bgcolor: "#ff3b30", fgcolor: "#ffffff" }
      : null;
  }
  if (VMIX_RECORD.has(action)) {
    return vars.recording === true
      ? { bgcolor: "#8e44ad", fgcolor: "#ffffff" }
      : null;
  }
  if (action === "sc-fadetoblack") {
    return vars.fade_to_black === true
      ? { bgcolor: "#000000", fgcolor: "#ff3b30" }
      : null;
  }

  return null;
}

registerFeedback("vmix", vmixFeedback);
