import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Characterization probe for the legacy `*_host` ↔ registry-connection
 * sync (the P4-1 dette). Pins CURRENT behaviour before refactoring.
 */

process.env.NEXUS_DATA_DIR = mkdtempSync(join(tmpdir(), "nexus-prefs-"));

const {
  getPreferences,
  setPreferences,
  legacyConfigPatches,
  applyLegacyPatchesToConnections,
} = await import("@/lib/db/preferences");

beforeEach(() => {
  // Establish a known state: ONE default vMix connection at 10.0.0.1.
  setPreferences({
    connections: [
      {
        id: "v1",
        kind: "vmix",
        label: "vMix",
        enabled: true,
        config: { host: "10.0.0.1", port: 8088, pollingInterval: 150, srtPort: 5000 },
      },
    ],
    defaultConnections: { vmix: "v1" },
  });
});

describe("legacy field ↔ connection sync (characterization)", () => {
  it("mirrors the default connection's host into the legacy vmix_host", () => {
    expect(getPreferences().vmix_host).toBe("10.0.0.1");
  });

  it("PUT vmix_host alone via setPreferences is OVERWRITTEN by the connection", () => {
    setPreferences({ vmix_host: "192.168.50.7" });
    const after = getPreferences();
    const connHost = (
      after.connections.find((c) => c.kind === "vmix")?.config as {
        host?: string;
      }
    )?.host;
    expect(connHost).toBe("10.0.0.1");
    // CURRENT behaviour: applyDefaultsToLegacy re-mirrors the connection's
    // host, so the bare legacy edit does NOT stick — the connection wins.
    expect(after.vmix_host).toBe("10.0.0.1");
    expect(connHost).toBe("10.0.0.1");
  });

  it("updating the connection's config DOES change the effective host", () => {
    setPreferences({
      connections: [
        {
          id: "v1",
          kind: "vmix",
          label: "vMix",
          enabled: true,
          config: { host: "192.168.50.7", port: 8088, pollingInterval: 150, srtPort: 5000 },
        },
      ],
      defaultConnections: { vmix: "v1" },
    });
    expect(getPreferences().vmix_host).toBe("192.168.50.7");
  });
});

describe("legacyConfigPatches (P4-1 fix)", () => {
  it("maps only the legacy keys present in the body", () => {
    expect(
      legacyConfigPatches({ vmix_host: "1.2.3.4", vmix_srt_port: 6000 })
    ).toEqual({ vmix: { host: "1.2.3.4", srtPort: 6000 } });
  });

  it("groups by kind and ignores unrelated keys", () => {
    expect(
      legacyConfigPatches({ obs_host: "h", obs_port: 4455, polling_interval: 200, foo: 1 })
    ).toEqual({ obs: { host: "h", port: 4455 }, vmix: { pollingInterval: 200 } });
  });

  it("returns empty when no legacy device fields are present", () => {
    expect(legacyConfigPatches({ pin: "x", connections: [] })).toEqual({});
  });
});

describe("applyLegacyPatchesToConnections (P4-1 fix)", () => {
  const conns = [
    { id: "v1", kind: "vmix", label: "vMix", enabled: true, config: { host: "old", port: 8088 } },
  ];
  it("merges the patch into the kind's default connection config", () => {
    const out = applyLegacyPatchesToConnections(conns, { vmix: "v1" }, {
      vmix: { host: "new" },
    });
    expect((out[0].config as { host: string; port: number })).toEqual({
      host: "new",
      port: 8088,
    });
  });
  it("skips a kind with no default connection (falls back to legacy field)", () => {
    const out = applyLegacyPatchesToConnections(conns, {}, { vmix: { host: "new" } });
    expect(out).toEqual(conns); // untouched
  });
});

describe("route-level translation (the actual P4-1 fix path)", () => {
  it("a legacy vmix_host edit now STICKS by routing through the connection", () => {
    // Reproduces exactly what /api/preferences PUT does:
    const body = { vmix_host: "192.168.50.7" };
    const patches = legacyConfigPatches(body);
    const updated = setPreferences(body); // legacy field alone would revert…
    const connections = applyLegacyPatchesToConnections(
      updated.connections,
      updated.defaultConnections,
      patches
    );
    setPreferences({ connections }); // …but the connection edit makes it real
    const after = getPreferences();
    const connHost = (
      after.connections.find((c) => c.kind === "vmix")?.config as { host?: string }
    )?.host;
    expect(after.vmix_host).toBe("192.168.50.7");
    expect(connHost).toBe("192.168.50.7");
  });
});
