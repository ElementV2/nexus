import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A2 migration: the registry `connections` are the single source of truth —
 * there are no flat `*_host` mirror fields. Guards that:
 *   • a fresh install still gets a default vMix connection, and
 *   • a pre-registry file (flat `*_host` keys only) migrates in place by
 *     reading those keys defensively in the seed.
 */

const dir = mkdtempSync(join(tmpdir(), "nexus-seed-"));
process.env.NEXUS_DATA_DIR = dir;

// Pre-registry file: flat keys only, no `connections`. Written before the
// module is imported so the first read seeds from it.
writeFileSync(
  join(dir, "preferences.json"),
  JSON.stringify({
    vmix_host: "192.168.1.5",
    vmix_port: 8099,
    vmix_srt_port: 5001,
    obs_host: "10.0.0.9",
    obs_port: 4455,
  })
);

const { getPreferences } = await import("@/lib/db/preferences");

describe("preferences seed (A2 — connections as source of truth)", () => {
  it("migrates a pre-registry flat file into connections", () => {
    const p = getPreferences();
    const vmix = p.connections.find((c) => c.kind === "vmix");
    expect(vmix).toBeDefined();
    const cfg = vmix!.config as Record<string, unknown>;
    expect(cfg.host).toBe("192.168.1.5");
    expect(cfg.port).toBe(8099);
    expect(cfg.srtPort).toBe(5001);
    // OBS pointed at a non-default host → also migrated.
    const obs = p.connections.find((c) => c.kind === "obs");
    expect(obs).toBeDefined();
    expect((obs!.config as Record<string, unknown>).host).toBe("10.0.0.9");
    // The default vMix is the seeded connection.
    expect(p.defaultConnections.vmix).toBe(vmix!.id);
    // No flat fields leak onto the typed shape.
    expect("vmix_host" in p).toBe(false);
  });
});
