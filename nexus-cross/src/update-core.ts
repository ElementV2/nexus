/**
 * Pure, Electron-free release/version helpers shared by the updater. Kept
 * separate so the parsing and semver logic can be unit-tested without
 * pulling in `electron` (see tests/updater-core.test.ts).
 *
 * NOTE: this file is intentionally identical to launcher/src/update-core.ts.
 * The two Electron apps are separate, independently-packaged TS projects
 * (each with its own rootDir/lockfile), so a single shared module would
 * require migrating to npm workspaces — deferred to avoid disturbing the
 * dual-installer build. Only updater.ts differs (asset pattern + UA).
 */

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface ReleasePayload {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export interface UpdateInfo {
  /** Strictly greater than the running version per semver compare. */
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** GitHub release page (for the "Open release notes" link). */
  releaseUrl: string | null;
  /** Direct download URL of the matching installer asset. */
  installerUrl: string | null;
  publishedAt: string | null;
  checkedAt: number;
  /** Populated when the check itself failed (network, 404, etc.). */
  error?: string;
}

/** Strip a leading `v` from a release tag (`v0.1.8` → `0.1.8`). */
export function tagToVersion(tag: string): string {
  const t = String(tag || "");
  return t.startsWith("v") ? t.slice(1) : t;
}

/**
 * Compare two semver-ish strings. Returns positive if `a` is newer than
 * `b`, negative if older, 0 if equal. Pre-release suffixes are stripped
 * before comparison (`1.2.3-rc.1` and `1.2.3` compare equal). Good enough
 * for an in-app update check without pulling in a semver dependency.
 */
export function compareSemver(a: string | null, b: string): number {
  if (!a) return -1;
  const parse = (v: string): number[] =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const aP = parse(a);
  const bP = parse(b);
  for (let i = 0; i < 3; i++) {
    const av = aP[i] ?? 0;
    const bv = bP[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Find the installer asset whose name matches `pattern`. */
export function pickInstaller(
  assets: ReleaseAsset[] | undefined,
  pattern: RegExp
): string | null {
  const found = (assets || []).find((a) => pattern.test(a.name));
  return found?.browser_download_url || null;
}

/**
 * Turn a GitHub release payload into an UpdateInfo. `now` is injected so
 * tests stay deterministic.
 */
export function buildUpdateInfo(
  raw: ReleasePayload,
  currentVersion: string,
  assetPattern: RegExp,
  now: number
): UpdateInfo {
  const latestVersion = tagToVersion(raw.tag_name);
  return {
    available: compareSemver(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    releaseUrl: raw.html_url || null,
    installerUrl: pickInstaller(raw.assets, assetPattern),
    publishedAt: raw.published_at || null,
    checkedAt: now,
  };
}
