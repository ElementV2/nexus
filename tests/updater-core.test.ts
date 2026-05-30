import { describe, expect, it } from "vitest";
import {
  buildUpdateInfo,
  compareSemver,
  pickInstaller,
  tagToVersion,
  type ReleasePayload,
} from "../nexus-cross/src/update-core";

// The launcher matches Nexus-Setup-*, the satellite Nexus-Cross-Setup-*.
const LAUNCHER_RE = /^Nexus-Setup-.+\.exe$/i;
const CROSS_RE = /^Nexus-Cross-Setup-.+\.exe$/i;

describe("tagToVersion", () => {
  it("strips a leading v", () => {
    expect(tagToVersion("v0.1.8")).toBe("0.1.8");
    expect(tagToVersion("0.1.8")).toBe("0.1.8");
    expect(tagToVersion("")).toBe("");
  });
});

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareSemver("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareSemver("0.1.8", "0.1.8")).toBe(0);
  });

  it("treats a null/empty latest as older (no false update)", () => {
    expect(compareSemver(null, "0.1.8")).toBeLessThan(0);
  });

  it("ignores pre-release suffixes", () => {
    expect(compareSemver("1.2.3-rc.1", "1.2.3")).toBe(0);
  });

  it("tolerates missing/garbage segments", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.x", "1.0.0")).toBe(0);
  });
});

describe("pickInstaller", () => {
  const assets = [
    { name: "Nexus-Setup-0.2.0.exe", browser_download_url: "u/launcher" },
    { name: "Nexus-Cross-Setup-0.2.0.exe", browser_download_url: "u/cross" },
    { name: "Nexus-Setup-0.2.0.exe.blockmap", browser_download_url: "u/bm" },
  ];

  it("matches the launcher installer (not the .blockmap, not the cross)", () => {
    expect(pickInstaller(assets, LAUNCHER_RE)).toBe("u/launcher");
  });

  it("matches the cross installer", () => {
    expect(pickInstaller(assets, CROSS_RE)).toBe("u/cross");
  });

  it("returns null when nothing matches or assets are missing", () => {
    expect(pickInstaller([], LAUNCHER_RE)).toBeNull();
    expect(pickInstaller(undefined, LAUNCHER_RE)).toBeNull();
  });
});

describe("buildUpdateInfo", () => {
  const payload: ReleasePayload = {
    tag_name: "v0.2.0",
    html_url: "https://github.com/ElementV2/nexus/releases/tag/v0.2.0",
    published_at: "2026-05-30T00:00:00Z",
    assets: [
      { name: "Nexus-Cross-Setup-0.2.0.exe", browser_download_url: "u/cross" },
    ],
  };

  it("flags an update when the release is newer", () => {
    const info = buildUpdateInfo(payload, "0.1.8", CROSS_RE, 1000);
    expect(info.available).toBe(true);
    expect(info.latestVersion).toBe("0.2.0");
    expect(info.installerUrl).toBe("u/cross");
    expect(info.releaseUrl).toContain("v0.2.0");
    expect(info.checkedAt).toBe(1000);
  });

  it("does not flag an update when running the same version", () => {
    const info = buildUpdateInfo(payload, "0.2.0", CROSS_RE, 1000);
    expect(info.available).toBe(false);
  });

  it("does not flag an update when running a newer dev build", () => {
    const info = buildUpdateInfo(payload, "0.3.0", CROSS_RE, 1000);
    expect(info.available).toBe(false);
  });
});
