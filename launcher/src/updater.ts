import { app, net } from "electron";
import { EventEmitter } from "node:events";

// GitHub repo to poll for releases. If the repo is ever renamed,
// only this constant needs to change.
const REPO = "ElementV2/nexus";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

// Re-check every 6 hours after the initial check. Long enough to avoid
// burning the unauthenticated GitHub API quota (60 req/hr/IP), short
// enough that a left-running launcher catches new releases the same day.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Don't race with server bring-up — let the Next.js process settle
// before we hit the network on the launcher's behalf.
const INITIAL_DELAY_MS = 5_000;

export interface UpdateInfo {
  /** Strictly greater than the running version per semver compare. */
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** GitHub release page (for the "Open release notes" link). */
  releaseUrl: string | null;
  /** Direct download URL of the matching `Nexus-Setup-*.exe` asset. */
  installerUrl: string | null;
  publishedAt: string | null;
  checkedAt: number;
  /** Populated when the check itself failed (network, 404, etc.). */
  error?: string;
}

interface UpdaterEvents {
  info: (info: UpdateInfo) => void;
}

interface ReleasePayload {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export declare interface Updater {
  on<E extends keyof UpdaterEvents>(event: E, listener: UpdaterEvents[E]): this;
  emit<E extends keyof UpdaterEvents>(
    event: E,
    ...args: Parameters<UpdaterEvents[E]>
  ): boolean;
}

export class Updater extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private last: UpdateInfo | null = null;

  start(): void {
    this.initialTimer = setTimeout(() => {
      void this.check();
    }, INITIAL_DELAY_MS);
    this.timer = setInterval(() => {
      void this.check();
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  getInfo(): UpdateInfo | null {
    return this.last;
  }

  async check(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion();
    try {
      const raw = await this.fetchLatest();
      const tag = String(raw.tag_name || "");
      const latestVersion = tag.startsWith("v") ? tag.slice(1) : tag;
      const installerAsset = (raw.assets || []).find((a) =>
        /^Nexus-Setup-.+\.exe$/i.test(a.name)
      );
      const info: UpdateInfo = {
        available: compareSemver(latestVersion, currentVersion) > 0,
        currentVersion,
        latestVersion,
        releaseUrl: raw.html_url || null,
        installerUrl: installerAsset?.browser_download_url || null,
        publishedAt: raw.published_at || null,
        checkedAt: Date.now(),
      };
      this.publish(info);
      return info;
    } catch (err) {
      const info: UpdateInfo = {
        available: false,
        currentVersion,
        latestVersion: null,
        releaseUrl: null,
        installerUrl: null,
        publishedAt: null,
        checkedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      this.publish(info);
      return info;
    }
  }

  private publish(info: UpdateInfo): void {
    this.last = info;
    this.emit("info", info);
  }

  private fetchLatest(): Promise<ReleasePayload> {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "GET",
        url: API_URL,
        redirect: "follow",
      });
      request.setHeader("Accept", "application/vnd.github+json");
      request.setHeader("User-Agent", `Nexus-Launcher/${app.getVersion()}`);

      let body = "";
      request.on("response", (res) => {
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });
        res.on("end", () => {
          // No releases published yet — treat as "no update", not an error
          // worth surfacing to the user every 6h.
          if (res.statusCode === 404) {
            reject(new Error("No releases published yet"));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API responded ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as ReleasePayload);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      });
      request.on("error", reject);
      request.end();
    });
  }
}

/**
 * Compare two semver-ish strings. Returns positive if `a` is newer than
 * `b`, negative if older, 0 if equal. Pre-release suffixes are stripped
 * before comparison (`1.2.3-rc.1` and `1.2.3` compare equal). Good
 * enough for the launcher's needs without pulling in a semver dep.
 */
function compareSemver(a: string | null, b: string): number {
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
