import { describe, it, expect, beforeEach } from "vitest";
import { connectionManager } from "@/lib/core/connection-manager";
import { registerDeviceKind } from "@/lib/core/registry";
import type { BrokerImpl, ConnectionConfig, DeviceKind } from "@/lib/core/types";

/**
 * Exercises the manager's `reconcile` state machine with stub kinds — no
 * sockets, no hardware. This is the code that starts/stops/hot-updates
 * every device broker on a preferences write, and it was previously
 * untested despite being where a "tears down + reconnects on every
 * unrelated save" class of bug lives.
 */

interface Stub {
  disposed: number;
  updates: unknown[];
}
const stubs = new Map<string, Stub>();
let makeCount = 0;

function stubBroker(id: string): BrokerImpl {
  const s: Stub = { disposed: 0, updates: [] };
  stubs.set(id, s);
  return {
    subscribe: () => () => {},
    getSnapshot: () => null,
    send: async () => null,
    updateConfig: (c) => s.updates.push(c),
    getStatus: () => "offline",
    dispose: () => {
      s.disposed += 1;
    },
  };
}

function makeKind(kind: string): DeviceKind {
  return {
    kind,
    displayName: kind,
    icon: (() => null) as unknown as DeviceKind["icon"],
    parseConfig: (raw) => ({ ok: true, config: raw }),
    defaultConfig: () => ({}),
    make: ({ id }) => {
      makeCount += 1;
      return stubBroker(id);
    },
  };
}

registerDeviceKind(makeKind("auditstub"));
registerDeviceKind(makeKind("auditstub2"));

const cfg = (
  id: string,
  config: unknown,
  enabled = true,
  kind = "auditstub"
): ConnectionConfig => ({ id, kind, label: id, enabled, config });

beforeEach(() => {
  connectionManager.reconcile([]); // dispose anything from a prior test
  makeCount = 0;
  stubs.clear();
});

describe("connectionManager.reconcile", () => {
  it("constructs a broker for each enabled config", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    expect(connectionManager.get("c1")).toBeDefined();
    expect(makeCount).toBe(1);
  });

  it("does NOT recreate or updateConfig when the config blob is unchanged", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    expect(makeCount).toBe(1); // same broker reused
    expect(stubs.get("c1")?.updates.length).toBe(0); // no needless reconnect
  });

  it("hot-updates config (no rebuild) when the blob changes", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    connectionManager.reconcile([cfg("c1", { h: 2 })]);
    expect(makeCount).toBe(1);
    expect(stubs.get("c1")?.updates).toEqual([{ h: 2 }]);
  });

  it("disposes a connection removed from the desired set", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    connectionManager.reconcile([]);
    expect(stubs.get("c1")?.disposed).toBe(1);
    expect(connectionManager.get("c1")).toBeUndefined();
  });

  it("disposes a disabled connection", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 })]);
    connectionManager.reconcile([cfg("c1", { h: 1 }, false)]);
    expect(stubs.get("c1")?.disposed).toBe(1);
    expect(connectionManager.get("c1")).toBeUndefined();
  });

  it("skips an unknown kind without throwing or constructing", () => {
    expect(() =>
      connectionManager.reconcile([cfg("x", {}, true, "does-not-exist")])
    ).not.toThrow();
    expect(connectionManager.get("x")).toBeUndefined();
  });

  it("rebuilds (dispose old + make new) when the kind changes for the same id", () => {
    connectionManager.reconcile([cfg("c1", { h: 1 }, true, "auditstub")]);
    const firstBroker = stubs.get("c1");
    connectionManager.reconcile([cfg("c1", { h: 1 }, true, "auditstub2")]);
    expect(firstBroker?.disposed).toBe(1); // old kind's broker torn down
    expect(connectionManager.get("c1")?.kind).toBe("auditstub2");
    expect(makeCount).toBe(2);
  });

  it("listByKind returns only matching live connections", () => {
    connectionManager.reconcile([
      cfg("c1", {}, true, "auditstub"),
      cfg("c2", {}, true, "auditstub2"),
    ]);
    expect(connectionManager.listByKind("auditstub").map((c) => c.id)).toEqual([
      "c1",
    ]);
  });
});
