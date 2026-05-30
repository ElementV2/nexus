import { describe, expect, it } from "vitest";
import {
  buildUpdateInfo,
  compareSemver,
  pickInstaller,
  pickInstallerVersion,
  tagToVersion,
  type ReleasePayload,
} from "../nexus-cross/src/update-core";

// Same capturing patterns the apps use: group 1 is the app's own version,
// so the launcher and satellite version independently of the release tag.
const LAUNCHER_RE = /^Nexus-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;
const CROSS_RE = /^Nexus-Cross-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;

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

  it("extracts each app's own version from its asset filename", () => {
    const mixed = [
      { name: "Nexus-Setup-0.3.1.exe", browser_download_url: "u/l" },
      { name: "Nexus-Cross-Setup-0.1.8.exe", browser_download_url: "u/c" },
    ];
    expect(pickInstallerVersion(mixed, LAUNCHER_RE)).toBe("0.3.1");
    expect(pickInstallerVersion(mixed, CROSS_RE)).toBe("0.1.8");
    expect(pickInstallerVersion([], CROSS_RE)).toBeNull();
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

  it("does not flag an update when the newer release lacks a matching installer", () => {
    // A release that predates this app (only ships the OTHER installer):
    // newer version, but no asset for us → not available, no dead button.
    const launcherOnly: ReleasePayload = {
      ...payload,
      assets: [
        { name: "Nexus-Setup-0.2.0.exe", browser_download_url: "u/launcher" },
      ],
    };
    const info = buildUpdateInfo(launcherOnly, "0.1.8", CROSS_RE, 1000);
    expect(info.available).toBe(false);
    expect(info.installerUrl).toBeNull();
    expect(info.latestVersion).toBe("0.2.0");
  });

  it("versions independently of the release tag (main-only release ≠ satellite update)", () => {
    // Release tagged with the MAIN app version (0.3.1) but the satellite
    // installer is unchanged at 0.1.8. A satellite on 0.1.8 must NOT see
    // an update — its version comes from its own asset, not the tag.
    const mainBump: ReleasePayload = {
      tag_name: "v0.3.1",
      html_url: "https://github.com/ElementV2/nexus/releases/tag/v0.3.1",
      published_at: "2026-05-30T00:00:00Z",
      assets: [
        { name: "Nexus-Setup-0.3.1.exe", browser_download_url: "u/l" },
        { name: "Nexus-Cross-Setup-0.1.8.exe", browser_download_url: "u/c" },
      ],
    };
    const cross = buildUpdateInfo(mainBump, "0.1.8", CROSS_RE, 1000);
    expect(cross.available).toBe(false);
    expect(cross.latestVersion).toBe("0.1.8");
    // The launcher on 0.3.0 DOES see the main-app update in the same release.
    const launcher = buildUpdateInfo(mainBump, "0.3.0", LAUNCHER_RE, 1000);
    expect(launcher.available).toBe(true);
    expect(launcher.latestVersion).toBe("0.3.1");
    expect(launcher.installerUrl).toBe("u/l");
  });
});
