/**
 * Registry of connected nexus-cross satellites.
 *
 * A satellite is a lightweight Node agent running on a different
 * machine on the LAN; it owns the local Stream Deck HID handles and
 * forwards presses to the main Nexus server. The main server pushes
 * render commands back via the satellite's SSE channel — keeping
 * the editor / coordinator / press-dispatcher logic unchanged.
 *
 * The registry tracks:
 *   • Per-satellite outbound queue + a writer callback wired by the
 *     SSE route handler. When the writer is null (SSE not connected
 *     yet), queued messages buffer; first writer attachment flushes.
 *   • serial → satelliteId mapping so the driver can decide whether
 *     a `renderKey` for serial X goes to local HID or remote satellite.
 *
 * HMR-safe singleton via the shared `hmrSingleton` helper.
 */

import { hmrSingleton } from "@/lib/utils/hmr-singleton";

// A connected satellite is touch()ed by its 25 s SSE keepalive, so reaping
// after ~3 missed heartbeats cleanly distinguishes "gone" from "idle".
const HEARTBEAT_MS = 25_000;
const STALE_MS = HEARTBEAT_MS * 3;
const SWEEP_MS = 30_000;

/**
 * Slim render payload sent to a satellite. The satellite only needs
 * the visual fields to compose the key image — NOT the full binding
 * (action ids, options, connection pins). Keeping the wire payload
 * minimal cuts SSE bandwidth on busy tally updates and avoids leaking
 * action/connection details to remote machines.
 */
export interface RenderBindingLite {
  preset: {
    label?: string;
    text?: string;
    bgcolor?: string;
    fgcolor?: string;
  };
}

export interface SatelliteDevice {
  /** HID serial — the stable identity that layouts pair against. */
  serial: string;
  /** Device model id (e.g. "xl", "mk2"). */
  model: string;
  /** Logical key count + grid — same shape as the local
   *  `DeviceSummary` so UI code can treat both uniformly. */
  rows: number;
  cols: number;
  iconSize: number;
  /** Optional friendly product name from the SDK. */
  productName?: string;
}

/**
 * Render override mirrors the driver's local override shape. Kept
 * here as a separate type to avoid pulling the driver into the
 * registry's dependency graph (the driver imports the registry, not
 * the other way around).
 */
export interface RenderOverride {
  bgcolor?: string;
  fgcolor?: string;
  text?: string;
  badge?: { color: string; symbol?: string };
}

export type SatelliteOutMessage =
  | {
      type: "render";
      serial: string;
      keyIndex: number;
      binding: RenderBindingLite | null;
      override?: RenderOverride;
    }
  | { type: "clear"; serial: string; keyIndex: number }
  | { type: "clear-panel"; serial: string }
  | { type: "reset"; serial: string }
  | { type: "brightness"; serial: string; percent: number }
  | { type: "hello" };

/** Public-facing satellite snapshot for the devices API. */
export interface SatelliteSnapshot {
  id: string;
  label?: string;
  remoteAddr?: string;
  lastSeenTs: number;
  devices: SatelliteDevice[];
}

interface SatelliteEntry {
  id: string;
  label?: string;
  remoteAddr?: string;
  devices: SatelliteDevice[];
  /** Pending outbound messages. Flushed when an SSE writer attaches. */
  outbox: SatelliteOutMessage[];
  writer: ((m: SatelliteOutMessage) => void) | null;
  lastSeenTs: number;
}

class SatelliteRegistryImpl {
  private satellites = new Map<string, SatelliteEntry>();
  /** serial → satellite id. Lets the driver decide local vs remote
   *  in O(1) per render call. */
  private serialOwner = new Map<string, string>();
  /** Press-event listeners. The driver subscribes one listener and
   *  re-emits through its own channel so the existing press
   *  dispatcher catches both local and remote presses uniformly. */
  private pressListeners = new Set<
    (event: {
      serial: string;
      keyIndex: number;
      type: "down" | "up";
    }) => void
  >();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Reap satellites that have gone silent (laptop closed, agent killed,
    // LAN drop). Without this they linger forever: their decks keep being
    // advertised by the driver's listDevices() and the coordinator keeps
    // buffering renders into a writer nobody drains, while serialOwner +
    // the satellites map grow across a long broadcast. The driver's 1 s
    // device-list TTL naturally drops a reaped satellite's decks.
    this.sweepTimer = setInterval(() => this.sweepStale(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  private sweepStale(): void {
    const now = Date.now();
    const dead: string[] = [];
    for (const [id, entry] of this.satellites) {
      if (now - entry.lastSeenTs > STALE_MS) dead.push(id);
    }
    for (const id of dead) this.remove(id);
  }

  /**
   * Called by the announce route. (Re-)registers a satellite with
   * its current device list. Idempotent — re-announce overwrites.
   */
  announce(
    id: string,
    label: string | undefined,
    devices: SatelliteDevice[],
    remoteAddr?: string
  ): void {
    const existing = this.satellites.get(id);
    const entry: SatelliteEntry = existing ?? {
      id,
      label,
      remoteAddr,
      devices: [],
      outbox: [],
      writer: null,
      lastSeenTs: Date.now(),
    };
    // Recompute serial ownership: drop old entries, claim new ones.
    for (const d of entry.devices) {
      if (this.serialOwner.get(d.serial) === id) {
        this.serialOwner.delete(d.serial);
      }
    }
    entry.devices = devices;
    entry.label = label ?? entry.label;
    entry.remoteAddr = remoteAddr ?? entry.remoteAddr;
    entry.lastSeenTs = Date.now();
    for (const d of devices) {
      this.serialOwner.set(d.serial, id);
    }
    this.satellites.set(id, entry);
  }

  /**
   * Drop a satellite — typically called when its SSE channel closes
   * AND it didn't reconnect within the heartbeat window. Releases
   * the serials it owned so layouts paired to those decks revert to
   * "device not connected" until the satellite returns.
   */
  remove(id: string): void {
    const entry = this.satellites.get(id);
    if (!entry) return;
    for (const d of entry.devices) {
      if (this.serialOwner.get(d.serial) === id) {
        this.serialOwner.delete(d.serial);
      }
    }
    this.satellites.delete(id);
  }

  /**
   * Drop a satellite ONLY if it currently has no live SSE writer — i.e. it
   * disconnected and no newer connection re-attached in the meantime.
   * Returns true if it was removed. Lets the SSE route evict a gone
   * satellite IMMEDIATELY (its decks vanish from open editors) instead of
   * waiting out the stale-reaper, without nuking one that just reconnected.
   */
  removeIfDisconnected(id: string): boolean {
    const entry = this.satellites.get(id);
    if (!entry || entry.writer !== null) return false;
    this.remove(id);
    return true;
  }

  list(): SatelliteSnapshot[] {
    return Array.from(this.satellites.values()).map((s) => ({
      id: s.id,
      label: s.label,
      remoteAddr: s.remoteAddr,
      lastSeenTs: s.lastSeenTs,
      devices: s.devices,
    }));
  }

  /**
   * Iterate every satellite device. Used by the driver's
   * `listDevices()` to merge satellite decks into the unified list
   * the editor consumes.
   */
  forEachDevice(
    cb: (
      satelliteId: string,
      device: SatelliteDevice,
      satelliteLabel: string | undefined
    ) => void
  ): void {
    for (const sat of this.satellites.values()) {
      for (const d of sat.devices) cb(sat.id, d, sat.label);
    }
  }

  /** Returns the satellite owning a given deck serial, if any. */
  ownerOf(serial: string): string | undefined {
    return this.serialOwner.get(serial);
  }

  /** Tell every connected satellite to reset ALL its decks to the firmware
   *  logo. Called on server shutdown so remote decks don't keep showing
   *  stale buttons after the server driving them is gone. */
  resetAllDecks(): void {
    for (const sat of this.satellites.values()) {
      for (const d of sat.devices) {
        this.send({ type: "reset", serial: d.serial });
      }
    }
  }

  /** Deck serials currently owned by a satellite (empty if unknown). Lets
   *  the SSE close handler invalidate the driver's per-key face cache for
   *  each of a departing satellite's decks before it's removed. */
  serialsOf(id: string): string[] {
    const entry = this.satellites.get(id);
    return entry ? entry.devices.map((d) => d.serial) : [];
  }

  /**
   * Push an outbound message to the satellite owning the target
   * serial. Buffered until the SSE writer is attached — protects
   * renders fired between announce and SSE open from being lost.
   */
  send(message: SatelliteOutMessage): boolean {
    const serial =
      "serial" in message ? message.serial : undefined;
    if (!serial) return false;
    const satId = this.serialOwner.get(serial);
    if (!satId) return false;
    const entry = this.satellites.get(satId);
    if (!entry) return false;
    if (entry.writer) {
      try {
        entry.writer(message);
      } catch {
        // Writer threw (controller closed mid-write). Treat as
        // detached so the next render queues instead of crashing.
        entry.writer = null;
        entry.outbox.push(message);
      }
    } else {
      entry.outbox.push(message);
      // Cap the buffer — a satellite that never reconnects shouldn't
      // grow unbounded memory. 500 messages = ~5 s of dense tally
      // updates, plenty for transient reconnects.
      if (entry.outbox.length > 500) {
        entry.outbox.splice(0, entry.outbox.length - 500);
      }
    }
    return true;
  }

  /**
   * Attach an SSE writer for a satellite. Flushes any buffered
   * outbox messages immediately. Returns a detach callback the
   * SSE route uses on stream close.
   */
  attachWriter(
    id: string,
    writer: (m: SatelliteOutMessage) => void
  ): () => void {
    const entry = this.satellites.get(id);
    if (!entry) {
      // Allow attaching before announce (race) — create a stub entry
      // that will get its device list on the next announce.
      const stub: SatelliteEntry = {
        id,
        devices: [],
        outbox: [],
        writer,
        lastSeenTs: Date.now(),
      };
      this.satellites.set(id, stub);
      // Greet immediately so a satellite whose SSE opened before its first
      // announce still gets the ack (which prompts it to (re)announce),
      // matching the post-announce attach path below.
      try {
        writer({ type: "hello" });
      } catch {
        /* ignore — writer will be retried on next attach */
      }
      return () => {
        const cur = this.satellites.get(id);
        if (cur && cur.writer === writer) cur.writer = null;
      };
    }
    entry.writer = writer;
    entry.lastSeenTs = Date.now();
    // Flush buffered messages — the satellite has reconnected and
    // we owe it everything that happened while it was gone. Drain
    // before returning so the SSE handler can write them all in
    // order.
    const drain = entry.outbox;
    entry.outbox = [];
    for (const m of drain) {
      try {
        writer(m);
      } catch {
        // Putting them back is pointless — the writer just failed.
        // Drop and continue.
        break;
      }
    }
    // Greet the satellite so it knows we acknowledged it.
    try {
      writer({ type: "hello" });
    } catch {
      /* ignore */
    }
    return () => {
      const cur = this.satellites.get(id);
      if (cur && cur.writer === writer) cur.writer = null;
    };
  }

  /**
   * Record a press from a satellite. Fans out to listeners (driver
   * re-emits through its own subscribe channel so press-dispatcher
   * sees a uniform stream of local + remote presses).
   */
  receivePress(event: {
    serial: string;
    keyIndex: number;
    type: "down" | "up";
  }): void {
    const satId = this.serialOwner.get(event.serial);
    if (satId) {
      const entry = this.satellites.get(satId);
      if (entry) entry.lastSeenTs = Date.now();
    }
    for (const l of this.pressListeners) {
      try {
        l(event);
      } catch {
        /* listener should not break the registry */
      }
    }
  }

  /** Driver subscribes here once at boot. */
  subscribePresses(
    cb: (event: {
      serial: string;
      keyIndex: number;
      type: "down" | "up";
    }) => void
  ): () => void {
    this.pressListeners.add(cb);
    return () => {
      this.pressListeners.delete(cb);
    };
  }

  /** Heartbeat — keep the satellite alive in the registry even if
   *  it sends no presses for a while. SSE keepalive pings call this. */
  touch(id: string): void {
    const entry = this.satellites.get(id);
    if (entry) entry.lastSeenTs = Date.now();
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.satellites.clear();
    this.serialOwner.clear();
    this.pressListeners.clear();
  }
}

export const satelliteRegistry = hmrSingleton(
  "streamdeck-satellite-registry",
  SatelliteRegistryImpl
);
