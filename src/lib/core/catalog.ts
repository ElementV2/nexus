import { getKind, listKinds } from "./registry";
import { connectionManager } from "./connection-manager";
import { getPreferences } from "@/lib/db/preferences";
import type {
  ActionDefinition,
  FeedbackDefinition,
  PresetDefinition,
  VariableDefinition,
} from "./types";

/**
 * Flat enumeration helpers over the kind registry's actions /
 * presets / variables / feedbacks. These are the surface every
 * editor (preset browser, surface configurator, automation triggers)
 * consumes.
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

export interface CatalogFeedbackEntry {
  globalId: string;
  kind: string;
  def: FeedbackDefinition;
}

export function listActions(): CatalogActionEntry[] {
  const out: CatalogActionEntry[] = [];
  for (const k of listKinds()) {
    for (const a of k.actions ?? []) {
      out.push({ globalId: `${k.kind}:${a.id}`, kind: k.kind, def: a });
    }
  }
  return out;
}

export function getAction(globalId: string): CatalogActionEntry | undefined {
  const [kind, id] = splitGlobalId(globalId);
  if (!kind || !id) return undefined;
  const k = getKind(kind);
  const def = k?.actions?.find((a) => a.id === id);
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

export function listFeedbacks(): CatalogFeedbackEntry[] {
  const out: CatalogFeedbackEntry[] = [];
  for (const k of listKinds()) {
    for (const f of k.feedbacks ?? []) {
      out.push({ globalId: `${k.kind}:${f.id}`, kind: k.kind, def: f });
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
export async function runAction(
  globalActionId: string,
  options: Record<string, unknown>,
  connectionId?: string
): Promise<ActionRunResult> {
  const entry = getAction(globalActionId);
  if (!entry) {
    return { ok: false, error: `Unknown action "${globalActionId}"` };
  }
  const target = resolveConnectionId(entry.kind, connectionId);
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
  try {
    const data = await conn.broker.send(command);
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Broker rejected command",
    };
  }
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
  }>,
  kind: string,
  connectionId?: string
): Promise<{ results: ActionRunResult[] }> {
  const results: ActionRunResult[] = [];
  for (const step of steps) {
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
    const r = await runAction(stepGlobalId, step.options ?? {}, pin);
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
  connectionId?: string
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
  return runSteps(preset.steps, kind, connectionId);
}

function resolveConnectionId(
  kind: string,
  preferred?: string
): string | null {
  // 1. An explicit, valid pin always wins (per-action / per-button
  //    target chosen in the inspector).
  if (preferred) {
    const c = connectionManager.get(preferred);
    if (c && c.kind === kind) return preferred;
  }
  // 2. The operator-chosen default for this kind (set in the
  //    connections panel). This is what un-pinned surface actions and
  //    the legacy pages converge on.
  const def = getPreferences().defaultConnections?.[kind];
  if (def) {
    const c = connectionManager.get(def);
    if (c && c.kind === kind) return def;
  }
  // 3. Fall back to the first live connection of the kind.
  const matches = connectionManager.listByKind(kind);
  return matches[0]?.id ?? null;
}
