/**
 * Feedback registry — the data-driven replacement for the old central
 * hardcoded `switch (kind)` in `streamdeck/feedback.ts`.
 *
 * Each device kind contributes its own feedback rules from a co-located
 * `kinds/<kind>-feedback.ts` module that calls `registerFeedback(...)` at
 * import time (same pattern as the variable bridges). Adding feedback for a
 * new device is then "one file next to the kind", not an edit to a shared
 * file.
 *
 * IMPORTANT — purity: a `FeedbackFn` runs in BOTH contexts:
 *   • server-side (the feedback coordinator → HID / satellite render),
 *   • client-side (the Stream Deck editor's live deck preview).
 * So a `*-feedback.ts` module must import ONLY this file + plain types —
 * never a broker / `node:*` / anything server-only — or it would break the
 * browser bundle. Keeping the rules here (core, dependency-free) makes that
 * constraint easy to honour.
 */

/** Style overrides a feedback applies to a Stream Deck key. */
export interface FeedbackOverride {
  bgcolor?: string;
  fgcolor?: string;
  /** Replace the button face text — e.g. show the active scene name on a
   *  generic "Set program scene" button. */
  text?: string;
  /** Small dot in the top-right corner. */
  badge?: { color: string; symbol?: string };
}

/**
 * A kind's feedback rule. Given the pressed action's id, its frozen option
 * values, and the resolved variable scope for the connection the key is
 * pinned to, return a style override — or `null` for "no feedback". Pure.
 */
export type FeedbackFn = (
  action: string,
  options: Record<string, unknown>,
  vars: Record<string, unknown>
) => FeedbackOverride | null;

const REGISTRY: Record<string, FeedbackFn> = {};

/** Register (or replace) the feedback rule for a kind. Idempotent — an HMR
 *  re-import of the kind's feedback module overwrites the previous fn. */
export function registerFeedback(kind: string, fn: FeedbackFn): void {
  REGISTRY[kind] = fn;
}

/** The feedback rule for a kind, or undefined if the kind registered none. */
export function feedbackFor(kind: string): FeedbackFn | undefined {
  return REGISTRY[kind];
}

/**
 * Shared "connection unhealthy" dim. Used by kinds without rich feedback
 * (grandMA) and as the X32 disconnected state: better than a key that
 * visually fires but does nothing because the link dropped. Reads the
 * `connected` boolean every bridge publishes.
 */
export function disconnectedOverride(
  vars: Record<string, unknown>
): FeedbackOverride | null {
  if (vars.connected === false) {
    return { fgcolor: "rgba(255,255,255,0.35)", badge: { color: "#ff3b30" } };
  }
  return null;
}
