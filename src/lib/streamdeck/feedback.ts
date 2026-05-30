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
      return vmixFeedback(action, opts, scope, binding.preset.id);
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

function vmixFeedback(
  action: string,
  opts: Record<string, unknown>,
  vars: Record<string, unknown>,
  presetId: string
): FeedbackOverride | null {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined;
  const inputOpt = num(opts.input);

  // Cut / Preview tally — fire-red when this input is currently PGM,
  // green when it's on PVW. Lets the operator use a "Cut to input"
  // button as a live tally indicator at the same time.
  if (action === "cut" || action === "pgm") {
    if (inputOpt !== undefined && num(vars.tally_active) === inputOpt) {
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
        badge: { color: "#ffffff" },
      };
    }
    if (inputOpt !== undefined && num(vars.tally_preview) === inputOpt) {
      return {
        bgcolor: "#34c759",
        fgcolor: "#000000",
        badge: { color: "#ffffff" },
      };
    }
    return null;
  }
  if (action === "preview-input" || action === "prv") {
    if (inputOpt !== undefined && num(vars.tally_preview) === inputOpt) {
      return {
        bgcolor: "#34c759",
        fgcolor: "#000000",
        badge: { color: "#ffffff" },
      };
    }
    if (inputOpt !== undefined && num(vars.tally_active) === inputOpt) {
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
      };
    }
    return null;
  }

  // Stream toggle — show red "LIVE" when streaming.
  if (
    action === "start-stop-streaming" ||
    action === "start-streaming" ||
    action === "stop-streaming"
  ) {
    if (vars.streaming === true) {
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
        text: "● LIVE",
        badge: { color: "#ffffff" },
      };
    }
    return null;
  }

  // Record toggle — purple/recording badge when active.
  if (
    action === "start-stop-recording" ||
    action === "start-recording" ||
    action === "stop-recording"
  ) {
    if (vars.recording === true) {
      return {
        bgcolor: "#8e44ad",
        fgcolor: "#ffffff",
        text: "● REC",
        badge: { color: "#ffffff" },
      };
    }
    return null;
  }

  // FTB — dimmed indicator when active.
  if (action === "fade-to-black") {
    if (vars.fade_to_black === true) {
      return {
        bgcolor: "#000000",
        fgcolor: "#ff3b30",
        text: "● FTB",
      };
    }
    return null;
  }

  // Go Live / End Show bundles — derive from streaming + recording
  // composite state so the bundle key visually confirms both ops
  // landed.
  if (presetId === "go-live" || presetId === "fn-go-live") {
    if (vars.streaming === true && vars.recording === true) {
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
        text: "● LIVE\n● REC",
      };
    }
    return null;
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
      return {
        bgcolor: "#ff3b30",
        fgcolor: "#ffffff",
        badge: { color: "#ffffff" },
      };
    }
    return null;
  }
  if (action === "set-preview-scene") {
    if (sceneName && vars.current_preview_scene === sceneName) {
      return {
        bgcolor: "#34c759",
        fgcolor: "#000000",
        badge: { color: "#ffffff" },
      };
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
        badge: { color: "#ffffff" },
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
