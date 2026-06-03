import { getKind, listKinds } from "./registry";
import { connectionManager } from "./connection-manager";
import { peekPreferences } from "@/lib/db/preferences";
import { createLogger } from "./logger";
import {
  INTERNAL_ACTIONS,
  INTERNAL_KIND,
  getInternalAction,
} from "./internal-actions";
import { getStreamdeckStore, upsertLayout } from "@/lib/db/streamdeck";

/** Optional runtime context for a command run — e.g. which deck a press
 *  originated from, needed by internal actions like "go to page". */
export interface RunContext {
  deckSerial?: string;
}
import type {
  ActionDefinition,
  PresetDefinition,
  VariableDefinition,
} from "./types";

/**
 * Flat enumeration helpers over the kind registry's actions /
 * presets / variables. These are the surface every editor (preset
 * browser, surface configurator, automation triggers) consumes.
 *
 * Stream Deck feedback is NOT declared here — it lives as imperative
 * per-kind rules in `kinds/<kind>-feedback.ts` (registered via
 * `registerFeedback`), evaluated by `streamdeck/feedback.ts`.
 *
 * Action and preset ids are namespaced as `<kind>:<id>` here so the
 * caller can use a single string key everywhere without juggling
 * pairs. The runner re-splits before lookup.
 */

export interface CatalogActionEntry {
  /** "<kind>:<id>" — unique across the whole app. */
  globalId: string;
  kind: string;
  def: ActionDefinition;
}

export interface CatalogPresetEntry {
  globalId: string;
  kind: string;
  def: PresetDefinition;
}

export interface CatalogVariableEntry {
  globalId: string;
  kind: string;
  def: VariableDefinition;
}

export function listActions(): CatalogActionEntry[] {
  const out: CatalogActionEntry[] = [];
  for (const k of listKinds()) {
    for (const a of k.actions ?? []) {
      out.push({ globalId: `${k.kind}:${a.id}`, kind: k.kind, def: a });
    }
  }
  // App-level "internal" actions (delay, goto-page) — not tied to any device
  // kind, but surfaced in the same catalog so the browser + inspector list
  // them and runAction can execute them.
  for (const a of INTERNAL_ACTIONS) {
    out.push({ globalId: `${INTERNAL_KIND}:${a.id}`, kind: INTERNAL_KIND, def: a });
  }
  return out;
}

// Per-kind action index, cached by the kind's `actions` array identity.
// `getAction` is on the press critical path and `runStep` calls it per
// step; a linear `.find()` over a large catalog (vMix ships ~450 actions)
// ran on every press. The WeakMap is keyed by the array REFERENCE, so an
// HMR re-register (which produces a fresh array) transparently rebuilds
// the index and lets the stale one be collected.
const actionIndexCache = new WeakMap<
  ActionDefinition[],
  Map<string, ActionDefinition>
>();

function actionIndexFor(
  actions: ActionDefinition[]
): Map<string, ActionDefinition> {
  let idx = actionIndexCache.get(actions);
  if (!idx) {
    idx = new Map(actions.map((a) => [a.id, a]));
    actionIndexCache.set(actions, idx);
  }
  return idx;
}

export function getAction(globalId: string): CatalogActionEntry | undefined {
  const [kind, id] = splitGlobalId(globalId);
  if (!kind || !id) return undefined;
  if (kind === INTERNAL_KIND) {
    const def = getInternalAction(id);
    return def ? { globalId, kind, def } : undefined;
  }
  const k = getKind(kind);
  if (!k?.actions) return undefined;
  const def = actionIndexFor(k.actions).get(id);
  return def ? { globalId, kind, def } : undefined;
}

export function listPresets(): CatalogPresetEntry[] {
  const out: CatalogPresetEntry[] = [];
  for (const k of listKinds()) {
    for (const p of k.presets ?? []) {
      out.push({ globalId: `${k.kind}:${p.id}`, kind: k.kind, def: p });
    }
  }
  return out;
}

export function listVariables(): CatalogVariableEntry[] {
  const out: CatalogVariableEntry[] = [];
  for (const k of listKinds()) {
    for (const v of k.variables ?? []) {
      out.push({ globalId: `${k.kind}:${v.id}`, kind: k.kind, def: v });
    }
  }
  return out;
}

function splitGlobalId(globalId: string): [string, string] | [null, null] {
  const idx = globalId.indexOf(":");
  if (idx < 0) return [null, null];
  return [globalId.slice(0, idx), globalId.slice(idx + 1)];
}

// ─────────────────────────── ActionRunner ─────────────────────────────

export interface ActionRunResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Hard cap on how long ONE step may take. The brokers have their own
 * (longer) transport timeouts — vMix aborts a command fetch at 5 s, OBS a
 * request at 5 s. On a multi-step button fired sequentially, a single
 * step pointed at a slow/dead device would otherwise FREEZE every step
 * after it for up to that full transport timeout (the "press cut+mute,
 * cut lands, everything else hangs 5 s" failure). This caps the per-step
 * wait so the surface stays responsive; a genuinely reachable LAN device
 * answers in single-digit ms, far under this. The underlying send still
 * runs to completion in the background (and may land late) — we just stop
 * blocking the sequence on it. (audit N1)
 */
const STEP_TIMEOUT_MS = 1500;

/** Resolve `p`, or reject with a timeout error after `ms`. Does NOT cancel
 *  `p` — the broker owns its own abort/cleanup; this only bounds the wait. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Execute one action against one connection. Looks up the action
 * definition in the registry, validates that the connection's kind
 * matches, asks the kind to translate options into a command, then
 * forwards to the broker.
 *
 * If `connectionId` is omitted the first enabled connection of the
 * action's kind is used — convenient for surfaces (Stream Deck) that
 * want to fire a "vmix:cut" preset without pinning a connection id
 * at config time.
 */
const cmdLog = createLogger("command");

/** Readable one-liner for a kind command body: vMix uses `Function`, OBS/
 *  Ableton use `action`; fall back to the action label. */
function commandSummary(command: unknown, fallback: string): string {
  if (command && typeof command === "object") {
    const o = command as Record<string, unknown>;
    const key =
      typeof o.Function === "string"
        ? "Function"
        : typeof o.action === "string"
          ? "action"
          : null;
    if (key) {
      const name = String(o[key]);
      const rest: Record<string, unknown> = { ...o };
      delete rest[key];
      let detail = Object.keys(rest).length ? JSON.stringify(rest) : "";
      if (detail.length > 120) detail = detail.slice(0, 117) + "…";
      return detail ? `${name} ${detail}` : name;
    }
  }
  return fallback;
}

export async function runAction(
  globalActionId: string,
  options: Record<string, unknown>,
  connectionId?: string,
  allowDefault = true,
  context?: RunContext
): Promise<ActionRunResult> {
  const entry = getAction(globalActionId);
  if (!entry) {
    return { ok: false, error: `Unknown action "${globalActionId}"` };
  }
  // Internal actions (delay, goto-page) run app-side, with no broker.
  if (entry.kind === INTERNAL_KIND) {
    return runInternalAction(entry.def.id, options ?? {}, context);
  }
  const target = resolveConnectionId(entry.kind, connectionId, allowDefault);
  if (!target) {
    return {
      ok: false,
      error: `No enabled connection of kind "${entry.kind}"`,
    };
  }
  const conn = connectionManager.get(target);
  if (!conn) {
    return {
      ok: false,
      error: `Connection "${target}" not in manager (boot pending?)`,
    };
  }
  let command: unknown;
  try {
    command = entry.def.toCommand(options ?? {});
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Option validation failed",
    };
  }
  // Server-side command log: makes EVERY command that reaches a broker
  // visible in Server Activity — including deck/preset presses, which fire
  // here (runSteps → runAction) and otherwise left no trace on success.
  const summary = commandSummary(command, entry.def.label);
  try {
    const data = await withTimeout(
      conn.broker.send(command),
      STEP_TIMEOUT_MS,
      `Action "${globalActionId}"`
    );
    cmdLog.info(`${entry.kind} ${summary} → "${conn.label}"`);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Broker rejected command";
    cmdLog.warn(`${entry.kind} ${summary} → "${conn.label}" ✗ ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Execute an app-level "internal" action (no device broker):
 *   • delay     — await N ms (sequences "A, wait, B" on one key).
 *   • goto-page — switch the deck the press came from to another page,
 *                 by re-pairing its serial to the target layout + pushing.
 */
async function runInternalAction(
  id: string,
  options: Record<string, unknown>,
  context?: RunContext
): Promise<ActionRunResult> {
  if (id === "delay") {
    const ms = Math.max(0, Math.min(600000, Number(options.ms) || 0));
    cmdLog.info(`internal delay ${ms}ms`);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    return { ok: true, data: { delayed: ms } };
  }
  if (id === "goto-page") {
    const serial = context?.deckSerial;
    if (!serial) {
      return { ok: false, error: "Go to page: no deck context (fire from a deck)" };
    }
    const page = String(options.page ?? "").trim();
    if (!page) return { ok: false, error: "Go to page: no page chosen" };
    const store = getStreamdeckStore();
    const target = store.layouts.find(
      (l) => l.id === page || l.label.toLowerCase() === page.toLowerCase()
    );
    if (!target) return { ok: false, error: `Go to page: no page "${page}"` };
    // Re-pair this deck to the target page (applyLayoutUpsert claims the
    // serial, releasing it from whatever page it was on), then paint it.
    upsertLayout({
      ...target,
      deviceSerials: [...new Set([...target.deviceSerials, serial])],
    });
    // Paint the deck immediately WITH feedback (tally / offline / state) in a
    // single pass, and clear any keys the previous page filled but this one
    // doesn't. Without this, go-to-page only pushed STATIC faces and feedback
    // appeared on the next variable tick (up to the 5 s status poll) — the
    // visible "feedback loads slowly after switching pages". The pressing
    // deck's handle is live (it just sent this press) so no HID reopen needed.
    const { feedbackCoordinator } = await import(
      "@/lib/streamdeck/feedback-coordinator"
    );
    await feedbackCoordinator.renderLayout(target.id);
    cmdLog.info(`internal goto-page "${target.label}" on ${serial}`);
    return { ok: true, data: { page: target.id } };
  }
  if (id === "play-scenario") {
    const ref = String(options.scenarioId ?? "").trim();
    if (!ref) return { ok: false, error: "Play scenario: none chosen" };
    const { getTimelineStore } = await import("@/lib/db/timeline");
    const { timelineEngine } = await import("@/lib/timeline/engine");
    // Resolve id-or-name so hand-written/imported configs and renames work.
    const target = getTimelineStore().scenarios.find(
      (s) => s.id === ref || s.label.toLowerCase() === ref.toLowerCase()
    );
    if (!target) return { ok: false, error: `Play scenario: no scenario "${ref}"` };
    timelineEngine.play(target.id, { skipWaits: Boolean(options.skipWaits) });
    cmdLog.info(`internal play-scenario "${target.label}"`);
    return { ok: true, data: { scenarioId: target.id } };
  }
  if (id === "stop-scenario") {
    const { timelineEngine } = await import("@/lib/timeline/engine");
    timelineEngine.stop();
    cmdLog.info("internal stop-scenario");
    return { ok: true, data: { stopped: true } };
  }
  return { ok: false, error: `Unknown internal action "${id}"` };
}

/**
 * Run an explicit list of steps against `kind`'s first enabled
 * connection (or `connectionId` if pinned). Used by:
 *   • Stream Deck key presses — feeds `binding.preset.steps`
 *     directly so the operator's per-key option overrides take
 *     effect, NOT the catalog's original defaults.
 *   • `/api/bindings/run` route from the Test button.
 *
 * Pure data-driven: caller passes the steps as-is, we resolve action
 * ids to globals + invoke `runAction` per step. Stops at first
 * failure, returns partial results so surfaces can pinpoint which
 * step broke.
 *
 * Each step may override the target:
 *   • `step.kind`         — fire against a different device kind than
 *                           the binding's (a button mixing vMix + OBS).
 *   • `step.connectionId` — pin a specific instance (which of several
 *                           vMix machines). Falls back to the
 *                           binding-level `connectionId`, then the
 *                           kind's default (see `resolveConnectionId`).
 */
export async function runSteps(
  steps: Array<{
    actionId: string;
    options?: Record<string, unknown>;
    connectionId?: string;
    kind?: string;
    enabled?: boolean;
  }>,
  kind: string,
  connectionId?: string,
  allowDefault = true,
  context?: RunContext
): Promise<{ results: ActionRunResult[] }> {
  const results: ActionRunResult[] = [];
  for (const step of steps) {
    // Disabled steps stay in the sequence but are skipped at run time.
    if (step.enabled === false) continue;
    // Step's own kind > the global id's prefix > the binding kind.
    const stepKind =
      step.kind ??
      (step.actionId.includes(":")
        ? step.actionId.slice(0, step.actionId.indexOf(":"))
        : kind);
    const stepGlobalId = step.actionId.includes(":")
      ? step.actionId
      : `${stepKind}:${step.actionId}`;
    // Per-step pin wins; otherwise the binding-level pin; otherwise
    // runAction resolves the kind default. We let runAction do the
    // final resolution so the kind match is validated there.
    const pin = step.connectionId ?? connectionId;
    const r = await runAction(
      stepGlobalId,
      step.options ?? {},
      pin,
      allowDefault,
      context
    );
    results.push(r);
    if (!r.ok) break;
  }
  return { results };
}

/**
 * Run a multi-step preset by id. Looks up the catalog's pristine
 * preset and runs its steps. Distinct from `runSteps` which accepts
 * potentially-modified steps from a binding — surfaces that allow
 * per-key option editing must use `runSteps` to honour the user's
 * overrides.
 */
export async function runPreset(
  globalPresetId: string,
  connectionId?: string,
  allowDefault = true
): Promise<{ results: ActionRunResult[] }> {
  const [kind, id] = splitGlobalId(globalPresetId);
  if (!kind || !id) {
    return { results: [{ ok: false, error: "Bad preset id" }] };
  }
  const k = getKind(kind);
  const preset = k?.presets?.find((p) => p.id === id);
  if (!preset) {
    return { results: [{ ok: false, error: `Unknown preset "${globalPresetId}"` }] };
  }
  return runSteps(preset.steps, kind, connectionId, allowDefault);
}

function resolveConnectionId(
  kind: string,
  preferred?: string,
  allowDefault = true
): string | null {
  // 1. An explicit, valid pin always wins (per-action / per-button
  //    target chosen in the inspector).
  if (preferred) {
    const c = connectionManager.get(preferred);
    if (c && c.kind === kind) return preferred;
  }
  // 2. Non-deck callers only (`allowDefault` true — ad-hoc browser
  //    action/preset runs + legacy pages): the operator-chosen default for
  //    this kind, else the first live connection. Convenience fallbacks.
  if (allowDefault) {
    const def = peekPreferences().defaultConnections?.[kind];
    if (def) {
      const c = connectionManager.get(def);
      if (c && c.kind === kind) return def;
    }
    const matches = connectionManager.listByKind(kind);
    return matches[0]?.id ?? null;
  }
  // 3. Deck context (`allowDefault` false): NO implicit fallback. A button
  //    with no valid pin (unpinned / set to "None" / pinned to a deleted
  //    connection) has NO target → return null so the press does nothing.
  //    The key also shows the offline marker. The operator assigns a
  //    connection (or "None") explicitly in the inspector — a deck never
  //    silently fires at "some" instance.
  return null;
}
