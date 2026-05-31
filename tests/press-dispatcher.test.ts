import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the press dispatcher's core guarantees: a physical key-down runs
 * the bound preset EXACTLY once (the bug it was built to fix: folding
 * dispatch into the per-client SSE route fired the preset N× for N tabs),
 * with allowDefault=false (decks fire only against their pinned
 * connection, never the per-kind default), and ignores key-up / unbound
 * keys / unknown serials.
 */

const m = vi.hoisted(() => ({
  subscribeCb: null as ((e: Record<string, unknown>) => void) | null,
  runStepsCalls: [] as unknown[][],
  layouts: [] as unknown[],
}));

vi.mock("@/lib/streamdeck/driver", () => ({
  streamdeckDriver: {
    subscribe: (cb: (e: Record<string, unknown>) => void) => {
      m.subscribeCb = cb;
      return () => {
        m.subscribeCb = null;
      };
    },
  },
}));
vi.mock("@/lib/db/streamdeck", () => ({
  getStreamdeckStore: () => ({ layouts: m.layouts }),
}));
vi.mock("@/lib/core/catalog", () => ({
  runSteps: (...args: unknown[]) => {
    m.runStepsCalls.push(args);
    return Promise.resolve({ results: [] });
  },
}));

const { pressDispatcher } = await import("@/lib/streamdeck/press-dispatcher");

beforeEach(() => {
  m.subscribeCb = null;
  m.runStepsCalls.length = 0;
  m.layouts.length = 0;
});
afterEach(() => {
  // Reset the singleton's `booted` flag so the next start() re-subscribes.
  pressDispatcher.dispose();
});

describe("pressDispatcher", () => {
  it("runs the bound preset once per key-down, pinned, allowDefault=false", () => {
    m.layouts.push({
      id: "l1",
      deviceSerials: ["SER1"],
      bindings: {
        3: {
          connectionId: "c2",
          preset: { kind: "vmix", steps: [{ actionId: "cut" }] },
        },
      },
    });
    pressDispatcher.start();
    expect(typeof m.subscribeCb).toBe("function");

    m.subscribeCb!({ type: "key-down", serialNumber: "SER1", keyIndex: 3 });

    expect(m.runStepsCalls.length).toBe(1);
    const [steps, kind, connectionId, allowDefault] = m.runStepsCalls[0];
    expect(steps).toEqual([{ actionId: "cut" }]);
    expect(kind).toBe("vmix");
    expect(connectionId).toBe("c2");
    expect(allowDefault).toBe(false);
  });

  it("ignores key-up, unbound keys and unknown serials", () => {
    m.layouts.push({
      id: "l1",
      deviceSerials: ["SER1"],
      bindings: { 3: { preset: { kind: "vmix", steps: [{ actionId: "cut" }] } } },
    });
    pressDispatcher.start();

    m.subscribeCb!({ type: "key-up", serialNumber: "SER1", keyIndex: 3 });
    m.subscribeCb!({ type: "key-down", serialNumber: "SER1", keyIndex: 7 });
    m.subscribeCb!({ type: "key-down", serialNumber: "NOPE", keyIndex: 3 });

    expect(m.runStepsCalls.length).toBe(0);
  });
});
