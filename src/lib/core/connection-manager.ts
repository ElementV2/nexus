import { getKind } from "./registry";
import { attachBridge } from "./variable-bridges";
import { variableBus } from "./variable-bus";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import type { BrokerImpl, Connection, ConnectionConfig } from "./types";

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
        existing.broker.dispose();
        this.connections.delete(cfg.id);
        this.lastConfig.delete(cfg.id);
      }
      const kind = getKind(cfg.kind);
      if (!kind) {
        console.warn(
          `[connection-manager] skipping connection ${cfg.id}: unknown kind "${cfg.kind}"`
        );
        continue;
      }
      const broker = kind.make({
        id: cfg.id,
        label: cfg.label,
        config: cfg.config,
      });
      this.connections.set(cfg.id, {
        id: cfg.id,
        kind: cfg.kind,
        label: cfg.label,
        broker,
      });
      this.lastConfig.set(cfg.id, cfgJson);
      // Attach the variable bridge so the surface buttons, feedbacks,
      // and `$(...)` text substitution see live values without anyone
      // opening the per-kind page first.
      const unattach = attachBridge(cfg.kind, cfg.id, broker);
      this.bridgeTeardowns.set(cfg.id, unattach);
    }
    // Dispose anything no longer in the desired set.
    for (const [id, conn] of this.connections) {
      if (!desiredIds.has(id)) {
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
      }
    }
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
  }
}

export const connectionManager = hmrSingleton(
  "connection-manager",
  ConnectionManagerImpl
);

// Re-export shapes that callers commonly want from the same path so
// import sites don't need to know about the types submodule.
export type { Connection, BrokerImpl, ConnectionConfig };
