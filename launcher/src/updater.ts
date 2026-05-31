import { app, net } from "electron";
import { EventEmitter } from "node:events";
import { buildUpdateInfo, type ReleasePayload, type UpdateInfo } from "./update-core";

export type { UpdateInfo } from "./update-core";

// GitHub repo to poll for releases. If the repo is ever renamed,
// only this constant needs to change.
const REPO = "ElementV2/nexus";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// The launcher watches for the main app installer asset. Capture group 1
// = the main app's version: `Nexus-Setup-0.1.8.exe` → `0.1.8`.
const ASSET_RE = /^Nexus-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;
const USER_AGENT = "Nexus-Launcher";

// Re-check every 6 hours after the initial check. Long enough to avoid
// burning the unauthenticated GitHub API quota (60 req/hr/IP), short
// enough that a left-running launcher catches new releases the same day.
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Don't race with server bring-up — let the Next.js process settle
// before we hit the network on the launcher's behalf.
const INITIAL_DELAY_MS = 5_000;

export class Updater extends EventEmitter {
  // Narrow the EventEmitter surface to our single typed event without the
  // unsafe class/interface declaration merge eslint flags.
  override on(event: "info", listener: (info: UpdateInfo) => void): this {
    return super.on(event, listener);
  }
  override emit(event: "info", info: UpdateInfo): boolean {
    return super.emit(event, info);
  }

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
      const info = buildUpdateInfo(raw, currentVersion, ASSET_RE, Date.now());
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
      request.setHeader("User-Agent", `${USER_AGENT}/${app.getVersion()}`);

      let body = "";
      let settled = false;
      const MAX_BODY = 2 * 1024 * 1024; // 2 MB — a release JSON is a few KB
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          request.abort();
        } catch {}
        reject(new Error("GitHub API request timed out"));
      }, 15_000);
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      request.on("response", (res) => {
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          body += chunk.toString("utf-8");
          if (body.length > MAX_BODY) {
            try {
              request.abort();
            } catch {}
            fail(new Error("GitHub API response too large"));
          }
        });
        res.on("end", () => {
          if (settled) return;
          // No releases published yet — treat as "no update", not an error
          // worth surfacing to the user every 6h.
          if (res.statusCode === 404) {
            fail(new Error("No releases published yet"));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            fail(new Error(`GitHub API responded ${res.statusCode}`));
            return;
          }
          try {
            const payload = JSON.parse(body) as ReleasePayload;
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(payload);
            }
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        });
      });
      request.on("error", (e) =>
        fail(e instanceof Error ? e : new Error(String(e)))
      );
      request.end();
    });
  }
}
