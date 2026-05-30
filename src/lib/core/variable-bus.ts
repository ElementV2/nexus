/**
 * VariableBus — runtime store of every connection's published
 * variables. Buttons, feedbacks, and `$(connection:var)` text
 * substitution all read through here.
 *
 * Phase-1 design:
 *   • Naive: every variable change fans out to all subscribers; the
 *     subscribers themselves decide what to re-render. No dep graph
 *     yet — premature for our scale. Add later if profiling shows
 *     surfaces churning on irrelevant updates.
 *   • Bridges live next to the kinds (see `src/lib/core/variable-bridges.ts`).
 *     Each bridge subscribes to the broker's events and pushes mapped
 *     values into the bus.
 *   • Variables are keyed by `<connectionId>:<varId>` internally and
 *     surfaced through `set(id, varId, ...)` / `get(id, varId)` for
 *     ergonomics.
 */

import { hmrSingleton } from "@/lib/utils/hmr-singleton";

export type VariableValue = string | number | boolean | null;

export interface VariableEntry {
  connectionId: string;
  varId: string;
  value: VariableValue;
  ts: number;
}

type ChangeListener = (entry: VariableEntry) => void;

class VariableBusImpl {
  private values = new Map<string, VariableEntry>();
  private listeners = new Set<ChangeListener>();

  set(connectionId: string, varId: string, value: VariableValue): void {
    const key = composeKey(connectionId, varId);
    const cur = this.values.get(key);
    if (cur && cur.value === value) return;
    const entry: VariableEntry = {
      connectionId,
      varId,
      value,
      ts: Date.now(),
    };
    this.values.set(key, entry);
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        /* a misbehaving listener should not break the bus */
      }
    }
  }

  setBatch(
    connectionId: string,
    updates: Record<string, VariableValue>
  ): void {
    for (const [varId, value] of Object.entries(updates)) {
      this.set(connectionId, varId, value);
    }
  }

  get(connectionId: string, varId: string): VariableValue | undefined {
    return this.values.get(composeKey(connectionId, varId))?.value;
  }

  /** Snapshot of every known variable. Used by the API list endpoint
   *  and by new SSE subscribers to hydrate before deltas arrive. */
  snapshot(): VariableEntry[] {
    return Array.from(this.values.values());
  }

  /** Drop every variable from one connection — call when a connection
   *  is removed or its kind is unregistered so feedbacks don't keep
   *  showing stale state. */
  clearConnection(connectionId: string): void {
    for (const [k, v] of this.values) {
      if (v.connectionId === connectionId) this.values.delete(k);
    }
  }

  subscribe(cb: ChangeListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Substitute `$(connection:var)` tokens in a template string with
   * their current values. Missing variables become "—" so the result
   * stays readable on a Stream Deck face. Used by surface renderers
   * to compute button text at draw time.
   */
  evaluateTemplate(
    template: string,
    fallback = "—"
  ): string {
    return template.replace(
      /\$\(([a-z0-9_-]+):([a-z0-9_]+)\)/gi,
      (_match, conn, varId) => {
        const v = this.get(conn, varId);
        if (v === undefined || v === null) return fallback;
        return String(v);
      }
    );
  }

  dispose(): void {
    this.values.clear();
    this.listeners.clear();
  }
}

function composeKey(connectionId: string, varId: string): string {
  return `${connectionId}::${varId}`;
}

export const variableBus = hmrSingleton("variable-bus", VariableBusImpl);
