import type { DeckBinding } from "@/lib/db/streamdeck";
import { feedbackFor, type FeedbackOverride } from "@/lib/core/feedback";

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

/** Variables snapshot keyed by `<connectionId>` → `<varId>` → value. The
 *  bus's flat list is reshaped before calling so lookups stay O(1). */
export type VarsByConnection = Record<string, Record<string, unknown>>;

/**
 * Resolve the variables namespace a binding's feedback should read.
 *
 * Decks are INDEPENDENT of the per-kind "default" connection (which only
 * drives the legacy single-instance pages). A key reflects the state of the
 * connection it's PINNED to — never the default — so changing the default
 * never changes what a deck shows:
 *   1. The step's pin, then the binding's pin (the operator chose
 *      "this key controls vMix #2").
 *   2. Fallback ONLY for an unpinned legacy binding: the first connection
 *      of that kind with published variables (deterministic, not the
 *      default).
 */
function pickVars(
  kind: string,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  pinned?: string
): Record<string, unknown> | undefined {
  if (pinned && vars[pinned]) return vars[pinned];
  if (pinned) return undefined; // pinned but no vars yet → no feedback
  const ids = connectionIdsByKind[kind] ?? [];
  for (const id of ids) {
    if (vars[id]) return vars[id];
  }
  return undefined;
}

/**
 * Evaluate a binding's feedback: pick the variable scope for the pinned
 * connection, then hand off to the kind's registered rule. Returns the
 * style override, or null for "no feedback / unknown kind".
 *
 * Only the FIRST step drives feedback — a multi-step button reflects the
 * state of its primary action.
 */
export function evaluateFeedback(
  binding: DeckBinding,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>
): FeedbackOverride | null {
  const kind = binding.preset.kind;
  const step = binding.preset.steps[0];
  if (!step) return null;
  const opts = step.options ?? {};
  const pinned = step.connectionId ?? binding.connectionId;
  const scope = pickVars(kind, vars, connectionIdsByKind, pinned);
  if (!scope) return null;
  return feedbackFor(kind)?.(step.actionId, opts, scope) ?? null;
}
