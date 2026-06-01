import { variableBus } from "@/lib/core/variable-bus";
import { connectionManager } from "@/lib/core/connection-manager";
import { peekStreamdeckStore } from "@/lib/db/streamdeck";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { streamdeckDriver } from "./driver";
import { evaluateFeedback, type VarsByConnection } from "./feedback";

/**
 * Bridge between the VariableBus and the Stream Deck driver. Subscribes
 * once at boot; when published variables change it re-pushes the affected
 * keys with feedback overrides applied.
 *
 * Targeted recompute (audit N12): a plain variable tick only re-evaluates
 * keys whose TARGET connection actually changed — tracked via the changed
 * `connectionId` the variable bus hands the subscriber. A vMix tally tick no
 * longer walks every OBS/Ableton key. A FULL pass (boot, device change, the
 * 5 s status poll) re-evaluates everything; unpinned keys carry no variable
 * dependency (they're offline) and only refresh on a full pass.
 *
 * Coordinator also pushes the initial render for every paired layout
 * on boot — without it, the operator would see stale keys until the
 * first variable change fires.
 */


/** How often the coordinator re-checks connection health to refresh the
 *  offline marker. Bounds how long a silent DROP can stay hidden; a
 *  reconnect clears the marker sooner via its snapshot's variable updates. */
const STATUS_POLL_MS = 5_000;

class CoordinatorImpl {
  private unsubVariables: (() => void) | null = null;
  private unsubDevices: (() => void) | null = null;
  private booted = false;
  /** Single-flight recompute flag: many `set()` calls in the same
   *  tick batch into one walk. Without this, a vMix poll that
   *  publishes 5 variables fires 5 walks back-to-back. */
  private recomputeQueued = false;
  /** Connections whose variables changed since the last recompute — the
   *  next pass only re-evaluates keys targeting these. */
  private dirty = new Set<string>();
  /** Set when the next pass must re-evaluate EVERY key (boot, device change,
   *  status poll) rather than just the dirty connections'. */
  private fullPending = false;
  /** Trailing-debounce for refresh() so a satellite reconnect storm
   *  (each announce calls refresh) coalesces into ONE recompute instead
   *  of N back-to-back HID re-enumerations. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Periodic recompute so a connection going up/down updates the offline
   *  marker even when it publishes no variable change (a dropped vMix stops
   *  emitting; without this its keys would never gain the offline icon).
   *  Cheap: the driver skips keys whose resolved face is unchanged. */
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.booted) return;
    this.booted = true;
    this.unsubVariables = variableBus.subscribe((entry) => {
      this.dirty.add(entry.connectionId);
      if (this.recomputeQueued) return;
      this.recomputeQueued = true;
      queueMicrotask(() => {
        this.recomputeQueued = false;
        void this.recompute();
      });
    });
    // Re-render every paired deck when the device set changes — a deck is
    // plugged in, or a satellite (re)announces. Without this the coordinator
    // only ever redrew on a VARIABLE change, so a deck connected after boot
    // (or already plugged in at a fresh server start) stayed on the standby
    // logo until the first tally tick instead of showing its last page.
    this.unsubDevices = streamdeckDriver.subscribe((ev) => {
      if (ev.type === "devices-changed") this.refresh();
    });
    // Initial paint, RETRIED: push the persisted layouts onto whatever is
    // connected so launching the server restores each deck's last page
    // headless — without opening the web UI or waiting for a variable tick.
    // A single attempt wasn't enough: a deck isn't always enumerable the
    // instant the server boots (the previous process just released it), and
    // an offline device produces no variable updates to drive a later
    // recompute, so the deck stayed on the logo until a page was opened.
    void this.bootRender(0);
    // Poll connection health so the offline marker tracks status changes
    // that don't ride on a variable update (a dropped link stops publishing).
    // A reconnect's fresh snapshot DOES publish variables, so the marker
    // clears instantly then — this 5 s tick only bounds how long a *drop*
    // can hide. Every broker reconnects on its own within ≤5 s, so the whole
    // loop self-heals without the operator touching the Network page.
    this.statusTimer = setInterval(() => {
      if (this.booted) this.refresh();
    }, STATUS_POLL_MS);
  }

  /** Keep trying to render the persisted layouts until at least one deck is
   *  actually connected, then do a full recompute. Gives up after ~60s; a
   *  deck connected later is picked up by the devices-changed listener. The
   *  `booted` guard makes a stray late timer a no-op after dispose. */
  private async bootRender(attempt: number): Promise<void> {
    if (!this.booted) return;
    try {
      const status = await streamdeckDriver.status();
      if (status.state === "ready") {
        const devices = await streamdeckDriver.listDevices();
        if (devices.length > 0) {
          this.fullPending = true;
          await this.recompute();
          return; // decks are up and painted — variable/hotplug events take over
        }
      }
    } catch {
      /* transient (HID still enumerating / optional deps loading) — retry */
    }
    if (attempt < 40) {
      setTimeout(() => void this.bootRender(attempt + 1), 1500);
    }
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
    // Capture + reset the dirty/full state up-front: variable changes that
    // land during the awaits below go into a fresh batch and queue another
    // pass, so none are lost.
    const full = this.fullPending;
    const dirty = this.dirty;
    this.fullPending = false;
    this.dirty = new Set();

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
    const connected = buildConnectedIndex();

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
        // Targeted pass: skip keys whose target connection didn't change.
        // (Unpinned keys have no pin → only refreshed on a full pass.)
        if (!full) {
          const pin =
            binding.preset.steps[0]?.connectionId ?? binding.connectionId;
          if (!pin || !dirty.has(pin)) continue;
        }
        const override = evaluateFeedback(binding, vars, kinds, connected);
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
    this.fullPending = true;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.recompute();
    }, 150);
  }

  dispose(): void {
    this.unsubVariables?.();
    this.unsubVariables = null;
    this.unsubDevices?.();
    this.unsubDevices = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
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

/** `<connectionId>` → is the broker currently connected. Drives the
 *  persistent offline marker. A connection mid-(re)connect or errored reads
 *  `false`, so its keys show "no connection" until the link is up. */
function buildConnectedIndex(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of connectionManager.list()) {
    let status: string;
    try {
      status = c.broker.getStatus();
    } catch {
      status = "error";
    }
    out[c.id] = status === "connected";
  }
  return out;
}

export const feedbackCoordinator = hmrSingleton(
  "streamdeck-feedback-coordinator",
  CoordinatorImpl
);
