import { variableBus } from "@/lib/core/variable-bus";
import { connectionManager } from "@/lib/core/connection-manager";
import { getStreamdeckStore } from "@/lib/db/streamdeck";
import { getPreferences } from "@/lib/db/preferences";
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
    const layouts = getStreamdeckStore().layouts;
    const vars = buildVarsByConnection();
    const kinds = buildKindIndex();
    const defaults = getPreferences().defaultConnections ?? {};

    for (const layout of layouts) {
      if (!layout.deviceSerial) continue;
      const device = devices.find(
        (d) => d.serialNumber === layout.deviceSerial
      );
      if (!device) continue;
      for (const [keyStr, binding] of Object.entries(layout.bindings)) {
        const keyIndex = Number(keyStr);
        if (!Number.isFinite(keyIndex)) continue;
        const override = evaluateFeedback(binding, vars, kinds, defaults);
        streamdeckDriver.renderKey(
          device.path,
          keyIndex,
          binding,
          override ?? undefined
        );
      }
    }
  }

  /** Force a recompute across the board — useful after a layout
   *  change or fresh device connect. */
  async refresh(): Promise<void> {
    await this.recompute();
  }

  dispose(): void {
    this.unsubVariables?.();
    this.unsubVariables = null;
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
