import { parseVmixXml } from "./xml-parser";
import { STATE_FETCH_TIMEOUT_MS } from "./constants";
import type { VmixState } from "./types";

/**
 * Per-instance vMix poller. ONE per configured vMix connection — each
 * owns its own host/port/cadence + cached state, so multiple vMix
 * machines poll independently (their tally/feedback no longer share one
 * default). Within a connection, N browsers still fan out from this
 * single poller (one request per tick, not N).
 */
export interface VmixBrokerConfig {
  host: string;
  port: number;
  pollingInterval: number;
}

export type StateMessage =
  | { ok: true; state: VmixState; raw: string; ts: number }
  | { ok: false; error: string; ts: number };

type Subscriber = (m: StateMessage) => void;

const FLOOR_MS = 50;
const STARTUP_DELAY_MS = 0;
const ERROR_BACKOFF_MS_INITIAL = 1000;
const ERROR_BACKOFF_MS_MAX = 30_000;

export class VmixStateBroker {
  private subscribers = new Set<Subscriber>();
  private lastMessage: StateMessage | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private stopped = true;
  private currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;

  constructor(private config: VmixBrokerConfig) {}

  /** Apply a new config — the next poll tick reads it (host/port/cadence
   *  are read fresh each tick, so no restart needed). */
  updateConfig(config: VmixBrokerConfig): void {
    this.config = config;
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    // Hand out the current snapshot immediately so the new client doesn't
    // have to wait a full tick before showing data.
    if (this.lastMessage) cb(this.lastMessage);
    if (this.subscribers.size === 1) this.startPolling();
    return () => this.unsubscribe(cb);
  }

  private unsubscribe(cb: Subscriber) {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) this.stopPolling();
  }

  /** Snapshot for one-shot fetches (overlay page, debug XML). */
  getSnapshot(): StateMessage | null {
    return this.lastMessage;
  }

  private startPolling() {
    if (!this.stopped) return;
    this.stopped = false;
    // Track the startup timer in pollHandle so a stop() during the startup
    // window cancels it — otherwise a quick start→stop→start could leave an
    // orphaned timer firing a second, parallel tick() chain.
    this.pollHandle = setTimeout(() => this.tick(), STARTUP_DELAY_MS);
  }

  private stopPolling() {
    this.stopped = true;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    // Drop the cached snapshot — a fresh subscriber should not see stale
    // data from a previous session.
    this.lastMessage = null;
  }

  private async tick() {
    if (this.stopped) return;
    if (this.inFlight) {
      this.pollHandle = setTimeout(() => this.tick(), FLOOR_MS);
      return;
    }
    this.inFlight = true;

    const { host, port, pollingInterval } = this.config;
    const url = `http://${host}:${port}/api`;
    const interval = Math.max(FLOOR_MS, pollingInterval);

    let backoff = interval;
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), STATE_FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(to);
      const raw = await res.text();
      if (!res.ok) {
        this.publish({
          ok: false,
          error: `Upstream ${res.status}`,
          ts: Date.now(),
        });
        backoff = Math.max(interval, this.currentErrorBackoff);
        this.bumpErrorBackoff();
      } else {
        const state = parseVmixXml(raw);
        this.publish({ ok: true, state, raw, ts: Date.now() });
        // Healthy response — reset backoff so the next failure starts
        // from the short delay again.
        this.currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
      }
    } catch (err) {
      this.publish({
        ok: false,
        error: err instanceof Error ? err.message : "fetch failed",
        ts: Date.now(),
      });
      backoff = Math.max(interval, this.currentErrorBackoff);
      this.bumpErrorBackoff();
    } finally {
      this.inFlight = false;
    }

    if (this.stopped) return;
    this.pollHandle = setTimeout(() => this.tick(), backoff);
  }

  private bumpErrorBackoff() {
    // Exponential — 1s, 2s, 4s, 8s, 16s, 30s (capped). Resets on success.
    this.currentErrorBackoff = Math.min(
      ERROR_BACKOFF_MS_MAX,
      this.currentErrorBackoff * 2
    );
  }

  private publish(m: StateMessage) {
    this.lastMessage = m;
    for (const sub of this.subscribers) {
      try {
        sub(m);
      } catch {
        // a misbehaving subscriber should not break the broker
      }
    }
  }

  /**
   * Public dispose hook for hot-reload cleanup. Stops the poll loop
   * and clears the cached snapshot. Same effect as the internal
   * `stopPolling()` that fires when the last SSE subscriber leaves.
   */
  dispose() {
    this.stopPolling();
  }
}
