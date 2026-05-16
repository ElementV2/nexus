import { parseVmixXml } from "./xml-parser";
import { getPreferences } from "@/lib/db/preferences";
import { STATE_FETCH_TIMEOUT_MS } from "./constants";
import type { VmixState } from "./types";

/**
 * Single shared poller against vMix. Every connected browser subscribes
 * to this broker via SSE instead of polling individually — so N clients
 * generate exactly one vMix request per tick, not N.
 *
 * Lives in the Next.js Node process; the standalone build runs a single
 * process so a module-level singleton is safe.
 */
export type StateMessage =
  | { ok: true; state: VmixState; raw: string; ts: number }
  | { ok: false; error: string; ts: number };

type Subscriber = (m: StateMessage) => void;

const FLOOR_MS = 50;
const STARTUP_DELAY_MS = 0;
const ERROR_BACKOFF_MS_INITIAL = 1000;
const ERROR_BACKOFF_MS_MAX = 30_000;

class StateBroker {
  private subscribers = new Set<Subscriber>();
  private lastMessage: StateMessage | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private stopped = true;
  private currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;

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
    setTimeout(() => this.tick(), STARTUP_DELAY_MS);
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

    const { vmix_host, vmix_port, polling_interval } = getPreferences();
    const url = `http://${vmix_host}:${vmix_port}/api`;
    const interval = Math.max(FLOOR_MS, polling_interval);

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

// Survive Next dev hot-reload: HMR re-imports this module but the
// constructed singleton's timers and HTTP poller keep firing from the
// dead bundle until process restart. `hmrSingleton` detects the class
// identity mismatch and disposes the stale instance for us.
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
export const stateBroker = hmrSingleton("vmix-state-broker", StateBroker);
