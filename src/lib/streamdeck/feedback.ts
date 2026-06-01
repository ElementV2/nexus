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
 *   2. Fallback ONLY for an unpinned legacy binding: the first connection
 *      of that kind with published variables (i.e. the live one), NOT the
 *      first in config order — otherwise a broken instance at index 0
 *      would shadow the working one the key actually reflects.
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
  return undefined;
}

/**
 * Evaluate a binding's feedback: resolve the connection it reflects, apply
 * the offline marker if that connection is down, otherwise hand off to the
 * kind's registered rule. Returns the style override, or null.
 *
 * Only the FIRST step drives feedback — a multi-step button reflects the
 * state of its primary action.
 */
export function evaluateFeedback(
  binding: DeckBinding,
  vars: VarsByConnection,
  connectionIdsByKind: Record<string, string[]>,
  connectedByConnection?: ConnectedByConnection
): FeedbackOverride | null {
  const kind = binding.preset.kind;
  const step = binding.preset.steps[0];
  if (!step) return null;
  const opts = step.options ?? {};
  const pinned = step.connectionId ?? binding.connectionId;
  const targetId = resolveTargetId(kind, vars, connectionIdsByKind, pinned);

  // Connection-down marker takes priority and short-circuits the kind rule:
  // a dropped link makes any tally stale, and the operator needs to SEE the
  // key has no connection. Only flag when we actually know this connection's
  // status AND it reports not-connected — never guess "offline" otherwise.
  if (
    connectedByConnection &&
    targetId &&
    connectedByConnection[targetId] === false
  ) {
    return OFFLINE_OVERRIDE;
  }

  const scope = targetId ? vars[targetId] : undefined;
  if (!scope) return null;
  return feedbackFor(kind)?.(step.actionId, opts, scope) ?? null;
}
