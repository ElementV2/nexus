import type { BrokerImpl, ConnectionStatus, KindEvent } from "./types";

/**
 * A per-instance broker: owns one connection's socket + state. The OSC
 * brokers (X32, grandMA) and any future per-instance transport expose
 * this shape. `makeBrokerAdapter` wraps it as the registry's
 * `BrokerImpl`, removing the identical passthrough-adapter boilerplate
 * each kind used to hand-write.
 */
export interface PerInstanceBroker<C> {
  subscribe(cb: (event: KindEvent) => void): () => void;
  getSnapshot(): unknown | null;
  send(command: unknown): Promise<unknown>;
  updateConfig(config: C): void;
  getStatus(): "connected" | "connecting" | "offline";
  dispose(): void;
}

/**
 * Wrap a per-instance broker as a `BrokerImpl`: passthrough for the
 * data methods, validate raw config via the kind's `parseConfig` on
 * update, and normalise the status enum.
 */
export function makeBrokerAdapter<C>(
  broker: PerInstanceBroker<C>,
  parseConfig: (
    raw: unknown
  ) => { ok: true; config: C } | { ok: false; error: string },
  tag: string
): BrokerImpl {
  return {
    subscribe: (cb) => broker.subscribe(cb),
    getSnapshot: () => broker.getSnapshot(),
    send: (command) => broker.send(command),
    updateConfig: (raw) => {
      const parsed = parseConfig(raw);
      if (!parsed.ok) {
        console.warn(`[${tag}] updateConfig rejected: ${parsed.error}`);
        return;
      }
      broker.updateConfig(parsed.config);
    },
    getStatus: (): ConnectionStatus => {
      const s = broker.getStatus();
      return s === "connected"
        ? "connected"
        : s === "connecting"
          ? "connecting"
          : "offline";
    },
    dispose: () => broker.dispose(),
  };
}
