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
    this.satellites.clear();
    this.serialOwner.clear();
    this.pressListeners.clear();
  }
}

export const satelliteRegistry = hmrSingleton(
  "streamdeck-satellite-registry",
  SatelliteRegistryImpl
);
