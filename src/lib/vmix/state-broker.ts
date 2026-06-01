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
// Cap the error backoff low: vMix is a LAN/localhost target that should
// recover within a few seconds of coming back (the operator notices when
// it stays "error" much longer than Ableton, which re-pings every 2 s). A
// poll to an offline LAN host every 5 s is negligible. Was 30 s, which made
// recovery feel like "it never reconnects" after a network blip.
const ERROR_BACKOFF_MS_MAX = 5_000;

export class VmixStateBroker {
  private subscribers = new Set<Subscriber>();
  private lastMessage: StateMessage | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private stopped = true;
  private currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
  /** Raw XML of the last SUCCESSFUL poll. When the next poll returns the
   *  exact same bytes we skip both the (full-document) XML parse AND the
   *  publish fan-out — at idle that's the dominant per-tick cost, and the
   *  saving scales with the number of connected SSE clients. Cleared on
   *  stop so a fresh session always re-parses. */
  private lastRaw: string | null = null;
  /** Set when a host/port change lands while a poll is in flight — the
   *  running tick re-polls the NEW host immediately on completion instead
   *  of waiting out `backoff`. */
  private repollPending = false;

  constructor(private config: VmixBrokerConfig) {}

  /** Apply a new config. Cadence changes are picked up by the next tick.
   *  A host/port change drops the stale state so the status reflects
   *  "connecting" (not the old host's "error"/"connected"), resets the
   *  error backoff, and re-polls the new target IMMEDIATELY — otherwise a
   *  switch (e.g. Network "Connect") waited out the previous host's
   *  error-backoff timer (up to 30 s) before even trying the new one. */
  updateConfig(config: VmixBrokerConfig): void {
    const changed =
      config.host !== this.config.host || config.port !== this.config.port;
    this.config = config;
    if (!changed) return;
    this.currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
    this.lastMessage = null;
    this.lastRaw = null;
    if (!this.stopped && !this.inFlight) {
      if (this.pollHandle) clearTimeout(this.pollHandle);
      this.pollHandle = setTimeout(() => this.tick(), 0);
    } else if (!this.stopped && this.inFlight) {
      // A poll to the OLD host is mid-flight; flag the running tick to
      // re-poll the NEW host the instant it finishes (its comment promised
      // an immediate switch — without this it waited out `backoff`).
      this.repollPending = true;
    }
  }

  /** Coarse health for the connections list. "connecting" = started but no
   *  poll has landed yet (fresh start, or just after a host change) — so
   *  the UI shows progress instead of a stale "error"/"offline" during the
   *  first round-trip to the new host. */
  getStatus(): "offline" | "connecting" | "connected" | "error" {
    if (this.stopped) return "offline";
    if (!this.lastMessage) return "connecting";
    return this.lastMessage.ok ? "connected" : "error";
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
    // Force a full re-parse on the next session's first poll.
    this.lastRaw = null;
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
    // One abort timer covering the whole request (connect + body read),
    // cleared in `finally` so it never leaks — including on a network
    // error, where the inline clear after `res.text()` was skipped.
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), STATE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      const raw = await res.text();
      if (!res.ok) {
        this.publish({
          ok: false,
          error: `Upstream ${res.status}`,
          ts: Date.now(),
        });
        backoff = Math.max(interval, this.currentErrorBackoff);
        this.bumpErrorBackoff();
      } else if (raw === this.lastRaw && this.lastMessage?.ok) {
        // Byte-identical to the previous successful poll → nothing changed.
        // Skip the parse + publish; new subscribers still hydrate from the
        // cached `lastMessage`. Refresh its `ts` so a liveness watchdog
        // keyed on it doesn't flag an idle-but-connected vMix as stale.
        // Replace the object rather than mutating in place — the same
        // reference was already handed to subscribers and is returned by
        // getSnapshot(); mutating `.ts` underneath them is shared-mutable
        // state. Cheap shallow copy, no re-parse, no fan-out.
        this.lastMessage = { ...this.lastMessage, ts: Date.now() };
        this.currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
      } else {
        this.lastRaw = raw;
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
      clearTimeout(to);
      this.inFlight = false;
    }

    if (this.stopped) return;
    if (this.repollPending) {
      // A host/port change landed during this poll — re-poll the new
      // target now rather than after `backoff`.
      this.repollPending = false;
      this.pollHandle = setTimeout(() => this.tick(), 0);
      return;
    }
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
    // A fetch that was already in flight when stopPolling() ran would
    // otherwise resurrect `lastMessage` (just cleared on stop), handing a
    // stale frame to the next fresh subscriber. Drop late publishes.
    if (this.stopped) return;
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
