import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAction } from "@/lib/core/catalog";
import { connectionManager } from "@/lib/core/connection-manager";
import { registerDeviceKind } from "@/lib/core/registry";
import type { BrokerImpl, DeviceKind } from "@/lib/core/types";

/**
 * Guards the per-step timeout (audit N1): a step pointed at a slow/dead
 * device must NOT freeze the run for the broker's full transport timeout
 * (vMix/OBS = 5 s). `runAction` caps each send at STEP_TIMEOUT_MS and
 * returns a failure instead of hanging, so a multi-step button stays
 * responsive.
 */

function hangBroker(): BrokerImpl {
  return {
    subscribe: () => () => {},
    getSnapshot: () => null,
    // Never resolves — mimics a vMix/OBS command to an unreachable host
    // sitting on its own (longer) transport timeout.
    send: () => new Promise<unknown>(() => {}),
    updateConfig: () => {},
    getStatus: () => "connected",
    dispose: () => {},
  };
}

const hangKind: DeviceKind = {
  kind: "audithang",
  displayName: "audithang",
  icon: (() => null) as unknown as DeviceKind["icon"],
  parseConfig: (raw) => ({ ok: true, config: raw }),
  defaultConfig: () => ({}),
  actions: [{ id: "noop", label: "noop", toCommand: () => ({}) }],
  make: () => hangBroker(),
};
registerDeviceKind(hangKind);

describe("runAction per-step timeout (audit N1)", () => {
  beforeEach(() => {
    connectionManager.reconcile([
      { id: "h1", kind: "audithang", label: "h1", enabled: true, config: {} },
    ]);
  });
  afterEach(() => {
    connectionManager.reconcile([]);
    vi.useRealTimers();
  });

  it("fails fast instead of hanging when the broker never responds", async () => {
    vi.useFakeTimers();
    const p = runAction("audithang:noop", {}, "h1", false);
    // Advance past the step cap; the never-resolving send must lose to the
    // timeout instead of blocking forever.
    await vi.advanceTimersByTimeAsync(1600);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  });
});
