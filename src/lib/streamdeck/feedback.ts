import type { DeckBinding } from "@/lib/db/streamdeck";
import {
  feedbackFor,
  OFFLINE_OVERRIDE,
  type FeedbackOverride,
} from "@/lib/core/feedback";

/**
 * Stream Deck feedback dispatcher. The per-kind rules used to live here in
 * one big hardcoded `switch (kind)`; they now live in co-located
 * `kinds/<kind>-feedback.ts` modules that self-register via
 * `registerFeedback(...)`. This file just:
 *   1. side-effect-imports every kind's feedback module (one line per kind,
 *      mirroring `boot.ts`) so the registry is populated, and
 *   2. resolves the variable scope a binding should read, then delegates to
 *      the registered rule.
 *
 * Imported by BOTH the server coordinator and the browser editor preview,
 * so it (and everything it pulls in) must stay client-safe — the feedback
 * modules are pure by construction (see `core/feedback.ts`).
 */

// Side-effect registration — adding a device = one new import line here.
import "@/lib/kinds/vmix-feedback";
import "@/lib/kinds/obs-feedback";
import "@/lib/kinds/ableton-feedback";
import "@/lib/kinds/x32-feedback";
import "@/lib/kinds/generic-feedback";

export type { FeedbackOverride };

/** Red glow for a "Play scenario" key while its scenario is running — the
 *  same reserved live red as a program tally. */
const SCENARIO_PLAYING_OVERRIDE: FeedbackOverride = {
  bgcolor: "#ff3b30",
  fgcolor: "#ffffff",
};

/** Variables snapshot keyed by `<connectionId>` → `<varId>` → value. The
 *  bus's flat list is reshaped before calling so lookups stay O(1). */
export type VarsByConnection = Record<string, Record<string, unknown>>;

/** Per-connection "is the link up?" map (`<connectionId>` → connected). The
 *  coordinator builds it from `broker.getStatus()`, the browser preview from
 *  `/api/connections` status. When provided, a key whose target connection
 *  isn't connected shows the offline marker regardless of kind feedback. */
export type ConnectedByConnection = Record<string, boolean>;

/**
 * Resolve the connection id whose state a key reflects — used for BOTH the
 * variable scope and the offline check so they can never disagree (the bug
 * where a connected key showed "offline" because the status check picked a
 * different instance than the tally did).
 *
 * Decks are INDEPENDENT of the per-kind "default" connection (which only
 * drives the legacy single-instance pages):
 *   1. The step's pin, then the binding's pin (the operator chose
 *      "this key controls OBS #2").
 *   2. Fallback for an unpinned legacy binding: the first connection of that
 *      kind with published variables (i.e. the live one), so a broken
 *      instance at index 0 doesn't shadow the working one the key reflects.
 *   3. If NONE has vars yet (e.g. a device that's been down since boot),
 *      fall back to the first connection in config order — the same one the
 *      press targets — so the offline marker can still flag it instead of
 *      the key looking like it just has "no feedback".
 */
function resolveTargetId(
  kind: string,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  pinned?: string
): string | undefined {
  if (pinned) return pinned;
  const ids = connectionIdsByKind[kind] ?? [];
  for (const id of ids) {
    if (vars[id]) return id;
  }
  return ids[0];
}

/**
 * Evaluate a binding's feedback: apply the offline marker if the button's
 * connection is down, otherwise hand off to the kind's registered rule.
 * Returns the style override, or null.
 *
 * Feedback reflects the FIRST step whose action actually produces an override
 * — so a multi-step button (e.g. "cut to input 2 + mute mic") still shows the
 * tally even when the tally-relevant action isn't step[0] (audit B4). Each
 * step is evaluated against its OWN pinned connection's variables.
 */
export function evaluateFeedback(
  binding: DeckBinding,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  connectedByConnection?: ConnectedByConnection,
  /** The scenario the timeline engine is currently running — id AND label, so
   *  a "Play scenario" key stored by name (the runner resolves id-or-name) is
   *  matched too. Server coordinator passes it; the editor preview omits it.
   *  Drives the red "Play scenario" feedback. */
  playingScenario?: { id: string; label?: string } | null
): FeedbackOverride | null {
  const kind = binding.preset.kind;
  const steps = binding.preset.steps;
  if (steps.length === 0) return null;
  // Internal actions (delay, go-to-page, play-scenario) target no device, so
  // there's no connection that could be "offline". They get no device tally —
  // EXCEPT "Play scenario", which glows red while its scenario is running
  // (driven by the engine's active scenario id, not by device variables).
  if (kind === "internal") {
    if (playingScenario) {
      const label = playingScenario.label?.toLowerCase();
      for (const step of steps) {
        const id = step.actionId.includes(":")
          ? step.actionId.slice(step.actionId.indexOf(":") + 1)
          : step.actionId;
        if (id === "play-scenario") {
          const sid = String((step.options ?? {}).scenarioId ?? "");
          // Match by id OR name — the runner resolves the stored ref either
          // way, so the feedback must too.
          if (
            sid &&
            (sid === playingScenario.id ||
              (!!label && sid.toLowerCase() === label))
          ) {
            return SCENARIO_PLAYING_OVERRIDE;
          }
        }
      }
    }
    return null;
  }
  // Offline marker takes priority over any kind rule. It fires when ANY of the
  // button's DEVICE actions has no live target — so a multi-action button that
  // drives different gear (vMix #1 + OBS) flags offline if EITHER device is
  // down, not just the first. Internal steps (delay, play-scenario) target no
  // device and are skipped. Only checked when connection status is available
  // (real callers pass it; the feedback-rule unit tests don't, so they still
  // exercise the tally paths below):
  //   • UNPINNED / "None" step — not assigned to any device → offline (the
  //     press does nothing for it, see catalog).
  //   • Pinned but NOT actively connected → offline (stale tally would
  //     mislead). Anything other than explicit `true` counts as offline —
  //     false, "connecting", OR absent from the map (disabled/missing).
  if (connectedByConnection) {
    for (const step of steps) {
      const sKind =
        step.kind ??
        (step.actionId.includes(":")
          ? step.actionId.slice(0, step.actionId.indexOf(":"))
          : kind);
      if (sKind === "internal") continue;
      const pin = step.connectionId ?? binding.connectionId;
      if (!pin || connectedByConnection[pin] !== true) return OFFLINE_OVERRIDE;
    }
  }

  // Scan steps; the first action that yields an override wins. Each step is
  // matched against ITS OWN kind's rule and the BARE action id — a step may
  // store a full "<kind>:<id>" (e.g. after a show↔deck round-trip) while the
  // rules key off the bare id, so "ableton:fire-clip" must still match the
  // "fire-clip" rule. Per-step kind also lets a cross-kind button (vMix + OBS)
  // light each action from the right device.
  for (const step of steps) {
    const sKind =
      step.kind ??
      (step.actionId.includes(":")
        ? step.actionId.slice(0, step.actionId.indexOf(":"))
        : kind);
    const rule = feedbackFor(sKind);
    if (!rule) continue;
    const targetId = resolveTargetId(
      sKind,
      vars,
      connectionIdsByKind,
      step.connectionId ?? binding.connectionId
    );
    const scope = targetId ? vars[targetId] : undefined;
    if (!scope) continue;
    const bareAction = step.actionId.includes(":")
      ? step.actionId.slice(step.actionId.indexOf(":") + 1)
      : step.actionId;
    const override = rule(bareAction, step.options ?? {}, scope);
    if (override) return override;
  }
  return null;
}
