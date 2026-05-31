import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceKind } from "@/lib/core/types";

/**
 * Guards the deck ↔ default decoupling: a deck press (allowDefault=false)
 * must fire against the PINNED connection (or first-of-kind), NEVER the
 * per-kind "default" — which is display-only. Changing the default must
 * not silently re-target a deck. Ad-hoc browser runs (allowDefault=true)
 * still use the default.
 */

process.env.NEXUS_DATA_DIR = mkdtempSync(join(tmpdir(), "nexus-deck-"));

const { connectionManager } = await import("@/lib/core/connection-manager");
const { registerDeviceKind } = await import("@/lib/core/registry");
const { runSteps } = await import("@/lib/core/catalog");
const { setPreferences, getPreferences } = await import("@/lib/db/preferences");

// Records which connection id each broker.send() landed on.
const sends: string[] = [];

const KIND: DeviceKind = {
  kind: "dk",
  displayName: "dk",
  icon: (() => null) as unknown as DeviceKind["icon"],
  parseConfig: (raw) => ({ ok: true, config: raw }),
  defaultConfig: () => ({}),
  actions: [{ id: "noop", label: "noop", toCommand: () => ({}) }],
  make: ({ id }) => ({
    subscribe: () => () => {},
    getSnapshot: () => null,
    send: async () => {
      sends.push(id);
      return null;
    },
    updateConfig: () => {},
    getStatus: () => "offline",
    dispose: () => {},
  }),
};

registerDeviceKind(KIND);

beforeEach(() => {
  // Two connections of the kind; the DEFAULT is the SECOND one (c2), while
  // the first-of-kind is c1 — so "default" vs "first" are distinguishable.
  setPreferences({
    connections: [
      { id: "c1", kind: "dk", label: "c1", enabled: true, config: {} },
      { id: "c2", kind: "dk", label: "c2", enabled: true, config: {} },
    ],
    defaultConnections: { dk: "c2" },
  });
  connectionManager.reconcile(getPreferences().connections);
  sends.length = 0;
});

describe("deck connection resolution (default decoupling)", () => {
  it("deck press (allowDefault=false) ignores the default → first-of-kind", async () => {
    await runSteps([{ actionId: "noop" }], "dk", undefined, false);
    expect(sends).toEqual(["c1"]); // NOT c2 (the default)
  });

  it("ad-hoc run (allowDefault=true) uses the default", async () => {
    await runSteps([{ actionId: "noop" }], "dk", undefined, true);
    expect(sends).toEqual(["c2"]);
  });

  it("an explicit pin always wins, even with allowDefault=false", async () => {
    await runSteps([{ actionId: "noop", connectionId: "c2" }], "dk", undefined, false);
    expect(sends).toEqual(["c2"]);
  });

  it("a step pin overrides the binding-level pin", async () => {
    await runSteps(
      [{ actionId: "noop", connectionId: "c1" }],
      "dk",
      "c2",
      false
    );
    expect(sends).toEqual(["c1"]);
  });
});
