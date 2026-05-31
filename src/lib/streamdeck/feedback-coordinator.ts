import { variableBus } from "@/lib/core/variable-bus";
import { connectionManager } from "@/lib/core/connection-manager";
import { peekStreamdeckStore } from "@/lib/db/streamdeck";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { streamdeckDriver } from "./driver";
import { evaluateFeedback, type VarsByConnection } from "./feedback";

/**
 * Bridge between the VariableBus and the Stream Deck driver. Subscribes
 * once at boot; whenever a published variable changes, walks every
 * persisted layout's bindings and re-pushes the affected keys with
 * feedback overrides applied.
 *
 * Naive full-walk is fine at our scale (a typical operator has 1-2
 * decks × 32 keys = 64 bindings). Optimizing to a dep graph would
 * cost more code than it saves in CPU.
 *
 * Coordinator also pushes the initial render for every paired layout
 * on boot — without it, the operator would see stale keys until the
 * first variable change fires.
 */


class CoordinatorImpl {
  private unsubVariables: (() => void) | null = null;
  private booted = false;
  /** Single-flight recompute flag: many `set()` calls in the same
   *  tick batch into one walk. Without this, a vMix poll that
   *  publishes 5 variables fires 5 walks back-to-back. */
  private recomputeQueued = false;
  /** Trailing-debounce for refresh() so a satellite reconnect storm
   *  (each announce calls refresh) coalesces into ONE recompute instead
   *  of N back-to-back HID re-enumerations. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.booted) return;
    this.booted = true;
    this.unsubVariables = variableBus.subscribe(() => {
      if (this.recomputeQueued) return;
      this.recomputeQueued = true;
      queueMicrotask(() => {
        this.recomputeQueued = false;
        void this.recompute();
      });
    });
  }

  /**
   * Walk every paired layout × bound key, evaluate feedback, fire a
   * render with the override. The driver itself debounces per-key
   * (60 ms window) so back-to-back recomputes coalesce into one
   * HID write — cheap to call eagerly.
   *
   * No cache layer here on purpose: the previous version cached
   * override JSON per key and ate legitimate re-renders when the
   * BINDING changed under an unchanged override. Push everything to
   * the driver and let its debounce handle the work.
   */
  private async recompute(): Promise<void> {
    const status = await streamdeckDriver.status();
    if (status.state !== "ready") return;
    const devices = await streamdeckDriver.listDevices();
    if (devices.length === 0) return;
    // Read-only peek — the coordinator never mutates this, and at
    // satellite scale a per-tick structuredClone of every layout was the
    // dominant cost. See peek* docs in the db module.
    const layouts = peekStreamdeckStore().layouts;
    const vars = buildVarsByConnection();
    const kinds = buildKindIndex();

    for (const layout of layouts) {
      if (layout.deviceSerials.length === 0) continue;
      // A layout can drive several decks (local + satellites) — render its
      // bindings to every connected one.
      const paths = layout.deviceSerials
        .map((serial) => devices.find((d) => d.serialNumber === serial)?.path)
        .filter((p): p is string => !!p);
      if (paths.length === 0) continue;
      for (const [keyStr, binding] of Object.entries(layout.bindings)) {
        const keyIndex = Number(keyStr);
        if (!Number.isFinite(keyIndex)) continue;
        const override = evaluateFeedback(binding, vars, kinds);
        for (const path of paths) {
          streamdeckDriver.renderKey(path, keyIndex, binding, override ?? undefined);
        }
      }
    }
  }

  /** Force a recompute across the board — useful after a layout change
   *  or fresh device connect. Trailing-debounced (150 ms) so a burst of
   *  satellite (re)announces collapses into one walk. */
  refresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.recompute();
    }, 150);
  }

  dispose(): void {
    this.unsubVariables?.();
    this.unsubVariables = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.booted = false;
  }
}

function buildVarsByConnection(): VarsByConnection {
  const out: VarsByConnection = {};
  for (const entry of variableBus.snapshot()) {
    if (!out[entry.connectionId]) out[entry.connectionId] = {};
    out[entry.connectionId][entry.varId] = entry.value;
  }
  return out;
}

function buildKindIndex(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of connectionManager.list()) {
    if (!out[c.kind]) out[c.kind] = [];
    out[c.kind].push(c.id);
  }
  return out;
}

export const feedbackCoordinator = hmrSingleton(
  "streamdeck-feedback-coordinator",
  CoordinatorImpl
);
