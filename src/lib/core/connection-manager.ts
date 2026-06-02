import { getKind } from "./registry";
import { attachBridge } from "./variable-bridges";
import { variableBus } from "./variable-bus";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { createLogger } from "./logger";
import type { BrokerImpl, Connection, ConnectionConfig } from "./types";

const log = createLogger("connection-manager");

/**
 * Owns the live broker instances. One per `ConnectionConfig` entry in
 * preferences. Reconciles when prefs change: starts new entries,
 * disposes removed ones, hot-updates config for entries whose host or
 * password changed.
 *
 * Brokers are lazy by default — the manager constructs them but each
 * one is responsible for kicking its transport on first subscribe
 * (matches the legacy vMix/Ableton brokers' behaviour, so a closed UI
 * means zero outbound traffic).
 *
 * HMR safety: the whole manager is stashed on `globalThis` so a Next
 * dev cycle doesn't leak Map entries. When this module re-imports
 * with a different class identity, the stale manager is disposed
 * (cascading dispose to every broker) before the new instance takes
 * over.
 */

class ConnectionManagerImpl {
  private connections = new Map<string, Connection>();
  /** Per-connection bridge teardown callbacks. Kept here (rather than
   *  on the Connection itself) so a manager-level dispose can fan
   *  out without having to crawl every broker. */
  private bridgeTeardowns = new Map<string, () => void>();
  /** Last applied config blob per connection id (serialized). Lets
   *  reconcile SKIP `updateConfig` when nothing actually changed —
   *  otherwise every unrelated preferences write (e.g. a Stream Deck
   *  binding save triggers a reconcile) called `updateConfig` on every
   *  live broker, and an OBS/Ableton broker that can't prove the config
   *  is unchanged tears down + reconnects its socket. */
  private lastConfig = new Map<string, string>();
  /** Last status we logged per connection id, so the status watcher only
   *  emits a line on an actual transition (connect → drop, etc.) rather
   *  than every poll tick. */
  private lastStatus = new Map<string, string>();
  /** Periodic sweep that turns each broker's `getStatus()` into a logged
   *  connect/disconnect timeline. One watcher covers EVERY kind (current
   *  and future) because `getStatus()` is part of the broker contract —
   *  no per-transport instrumentation needed. */
  private statusWatch: ReturnType<typeof setInterval> | null = null;

  /** Poll cadence for the status watcher. 2 s is fine for a human-read
   *  diagnostic log — a flap that resolves faster than this isn't worth a
   *  line, and a real outage stays logged the moment it's first seen. */
  private static readonly STATUS_POLL_MS = 2_000;

  /** Sweep every live broker's status and log transitions. Skips the
   *  benign initial "connecting"/"offline" baseline so a freshly-created
   *  connection doesn't log a spurious line before it's even tried. */
  private sweepStatuses(): void {
    for (const [id, conn] of this.connections) {
      let status: string;
      try {
        status = conn.broker.getStatus();
      } catch {
        continue; // a broker that can't report status shouldn't break the sweep
      }
      const prev = this.lastStatus.get(id);
      if (status === prev) continue;
      this.lastStatus.set(id, status);
      // First observation: only worth a line if it's already a notable
      // state (up, or hard error). connecting/offline baselines are noise.
      if (prev === undefined && status !== "connected" && status !== "error") {
        continue;
      }
      const label = `${conn.kind} "${conn.label}"`;
      if (status === "connected") log.info(`${label} → connected`);
      else if (status === "error") log.warn(`${label} → error`);
      else if (status === "offline") log.warn(`${label} → offline`);
      else log.info(`${label} → ${status}`);
    }
  }

  /** Start/stop the status watcher to match whether any brokers exist. */
  private syncStatusWatch(): void {
    const want = this.connections.size > 0;
    if (want && !this.statusWatch) {
      this.statusWatch = setInterval(
        () => this.sweepStatuses(),
        ConnectionManagerImpl.STATUS_POLL_MS
      );
      // Don't keep the event loop alive just for the log sweep.
      this.statusWatch.unref?.();
    } else if (!want && this.statusWatch) {
      clearInterval(this.statusWatch);
      this.statusWatch = null;
    }
  }

  /**
   * Ensure a broker exists for every enabled config and that disabled /
   * removed configs are torn down. Called by the preferences write
   * path so the broker map always tracks the persisted state.
   */
  reconcile(configs: ConnectionConfig[]): void {
    const desiredIds = new Set<string>();
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      desiredIds.add(cfg.id);
      const cfgJson = JSON.stringify(cfg.config ?? null);
      const existing = this.connections.get(cfg.id);
      if (existing) {
        // Same kind, same id → hot-update the config, but only when the
        // config blob actually changed (avoids needless reconnects on
        // unrelated writes).
        if (existing.kind === cfg.kind) {
          if (this.lastConfig.get(cfg.id) !== cfgJson) {
            existing.broker.updateConfig(cfg.config);
            this.lastConfig.set(cfg.id, cfgJson);
          }
          continue;
        }
        // Kind changed for the same id → full teardown (same as removal),
        // not just broker.dispose(): the OLD bridge subscription must be
        // unattached and the connection's variables cleared, otherwise the
        // bridge leaks and stale variables linger on the bus driving
        // feedback for a connection that no longer exists.
        const teardown = this.bridgeTeardowns.get(cfg.id);
        try {
          teardown?.();
        } catch {
          /* bridge teardown should not block reconcile */
        }
        this.bridgeTeardowns.delete(cfg.id);
        variableBus.clearConnection(cfg.id);
        existing.broker.dispose();
        this.connections.delete(cfg.id);
        this.lastConfig.delete(cfg.id);
      }
      const kind = getKind(cfg.kind);
      if (!kind) {
        log.warn(
          `skipping connection ${cfg.id}: unknown kind "${cfg.kind}"`
        );
        continue;
      }
      // Guard `make()` + bridge attach: a kind's `make` calls its
      // `parseConfig` and THROWS on an invalid config blob (corrupt prefs
      // file, schema drift across versions, an un-validated bulk write).
      // Without this try/catch a SINGLE bad entry aborts the whole
      // reconcile mid-loop — every later connection is never created, and
      // because `ensureBooted` already latched `booted=true`, the press
      // dispatcher / feedback coordinator never start either. One malformed
      // row would silently disable every device and every physical key for
      // the session. Skip the bad entry and keep going, like the
      // unknown-kind branch above.
      let broker: BrokerImpl;
      try {
        broker = kind.make({
          id: cfg.id,
          label: cfg.label,
          config: cfg.config,
        });
      } catch (err) {
        log.warn(
          `skipping connection ${cfg.id} (${cfg.kind}): ` +
            `make() failed — ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }
      log.info(`created ${cfg.kind} connection "${cfg.label}" (${cfg.id})`);
      this.connections.set(cfg.id, {
        id: cfg.id,
        kind: cfg.kind,
        label: cfg.label,
        broker,
      });
      this.lastConfig.set(cfg.id, cfgJson);
      // Attach the variable bridge so the surface buttons, feedbacks,
      // and `$(...)` text substitution see live values without anyone
      // opening the per-kind page first. A misbehaving bridge must not
      // take down the reconcile either.
      let unattach: () => void;
      try {
        unattach = attachBridge(cfg.kind, cfg.id, broker);
      } catch (err) {
        log.warn(
          `bridge attach failed for ${cfg.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
        unattach = () => {};
      }
      this.bridgeTeardowns.set(cfg.id, unattach);
    }
    // Dispose anything no longer in the desired set.
    for (const [id, conn] of this.connections) {
      if (!desiredIds.has(id)) {
        log.info(`disposing ${conn.kind} connection "${conn.label}" (${id})`);
        const teardown = this.bridgeTeardowns.get(id);
        try {
          teardown?.();
        } catch {
          /* bridge teardown should not block manager reconcile */
        }
        this.bridgeTeardowns.delete(id);
        variableBus.clearConnection(id);
        conn.broker.dispose();
        this.connections.delete(id);
        this.lastConfig.delete(id);
        this.lastStatus.delete(id);
      }
    }
    this.syncStatusWatch();
  }

  get(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  list(): Connection[] {
    return Array.from(this.connections.values());
  }

  listByKind(kind: string): Connection[] {
    return this.list().filter((c) => c.kind === kind);
  }

  /**
   * Tear down every broker. Called from the HMR disposer below or by
   * a future "factory-reset" UI action.
   */
  dispose(): void {
    for (const teardown of this.bridgeTeardowns.values()) {
      try {
        teardown();
      } catch {
        /* swallow — see reconcile() */
      }
    }
    this.bridgeTeardowns.clear();
    for (const conn of this.connections.values()) {
      try {
        conn.broker.dispose();
      } catch {
        /* a misbehaving broker should not block manager teardown */
      }
    }
    this.connections.clear();
    this.lastConfig.clear();
    this.lastStatus.clear();
    if (this.statusWatch) {
      clearInterval(this.statusWatch);
      this.statusWatch = null;
    }
  }
}

export const connectionManager = hmrSingleton(
  "connection-manager",
  ConnectionManagerImpl
);

// Re-export shapes that callers commonly want from the same path so
// import sites don't need to know about the types submodule.
export type { Connection, BrokerImpl, ConnectionConfig };
