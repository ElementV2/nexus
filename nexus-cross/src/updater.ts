import { app, net } from "electron";
import { EventEmitter } from "node:events";
import { buildUpdateInfo, type ReleasePayload, type UpdateInfo } from "./update-core";

export type { UpdateInfo } from "./update-core";

// Same repo as the main app — releases bundle both installers, so the
// satellite watches for its own `Nexus-Cross-Setup-*.exe` asset.
const REPO = "ElementV2/nexus";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// Capture group 1 = the satellite's own version (independent of the
// shared release tag): `Nexus-Cross-Setup-0.1.8.exe` → `0.1.8`.
const ASSET_RE = /^Nexus-Cross-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;
const USER_AGENT = "Nexus-Cross";

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
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
    this.initialTimer = setTimeout(() => void this.check(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
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
      request.on("response", (res) => {
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });
        res.on("end", () => {
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
