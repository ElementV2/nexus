/**
 * Uplink to the Nexus server.
 *
 *   • `announce()` POSTs the current device list to /api/streamdeck/
 *     satellite/announce. Called at boot and after every hotplug.
 *   • `subscribe()` opens the SSE stream and dispatches each message
 *     to the provided handler. Reconnects with exponential backoff
 *     on disconnect.
 *   • `sendPress()` POSTs key events to /api/streamdeck/satellite/
 *     press. Fire-and-forget — a missed press is less bad than
 *     blocking the HID event loop.
 *
 * Uses `undici` for fetch + native SSE parsing — gives us pooled
 * keep-alive connections and an abortable stream reader.
 */

import { fetch, request } from "undici";
import type { SatelliteConfig } from "./prefs";
import type { SatelliteDevice, SatelliteInMessage } from "./types";

export type UplinkState = { connected: boolean; error?: string };

// Short requests (announce / press) must fail fast when the server is
// down or the URL is wrong — otherwise undici's `fetch` waits on the TCP
// connect indefinitely and blocks whatever awaits it. The SSE connect
// gets its own (longer) guard; its body stream is never timed out.
const REQUEST_TIMEOUT_MS = 5_000;
const SSE_CONNECT_TIMEOUT_MS = 8_000;

export class ServerClient {
  private cfg: SatelliteConfig;
  private sseAbort: AbortController | null = null;
  private sseRetryMs: number;
  private stopped = false;
  private stateCb: ((s: UplinkState) => void) | null = null;

  constructor(cfg: SatelliteConfig) {
    this.cfg = cfg;
    this.sseRetryMs = cfg.reconnectMinMs;
  }

  /** Subscribe to SSE connection state (for the status window). */
  onState(cb: (s: UplinkState) => void): void {
    this.stateCb = cb;
  }
  private emitState(s: UplinkState): void {
    this.stateCb?.(s);
  }

  async announce(devices: SatelliteDevice[]): Promise<void> {
    const url = `${this.cfg.serverUrl}/api/streamdeck/satellite/announce`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: this.cfg.id,
          label: this.cfg.label,
          devices,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error(
          `[uplink] announce failed: ${res.status} ${res.statusText} ${txt}`
        );
      } else {
        console.log(
          `[uplink] announced ${devices.length} device(s) to ${this.cfg.serverUrl}`
        );
      }
    } catch (err) {
      console.error(
        "[uplink] announce error:",
        err instanceof Error ? err.message : err
      );
    }
  }

  /** Best-effort press push. Doesn't block — we don't want HID input
   *  latency to depend on server round-trips. */
  sendPress(serial: string, keyIndex: number, type: "down" | "up"): void {
    const url = `${this.cfg.serverUrl}/api/streamdeck/satellite/press`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `id` lets the server verify this satellite owns the serial.
      body: JSON.stringify({ id: this.cfg.id, serial, keyIndex, type }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err) => {
      console.error(
        "[uplink] press send failed:",
        err instanceof Error ? err.message : err
      );
    });
  }

  /** Open the SSE event stream. Reconnects forever until `stop()`. */
  subscribe(onMessage: (m: SatelliteInMessage) => void): void {
    void this.runSseLoop(onMessage);
  }

  private async runSseLoop(
    onMessage: (m: SatelliteInMessage) => void
  ): Promise<void> {
    while (!this.stopped) {
      const url = `${this.cfg.serverUrl}/api/streamdeck/satellite/events?id=${encodeURIComponent(this.cfg.id)}`;
      const abort = new AbortController();
      this.sseAbort = abort;
      // Guard only the CONNECT phase: if the server doesn't answer with
      // headers within the window, abort and let the backoff retry. Once
      // connected we clear the timer so the long-lived body stream (with
      // its keepalive comments) is never killed by it.
      const connectTimer = setTimeout(
        () => abort.abort(),
        SSE_CONNECT_TIMEOUT_MS
      );
      try {
        const res = await request(url, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: abort.signal,
        });
        clearTimeout(connectTimer);
        if (res.statusCode !== 200) {
          throw new Error(`SSE status ${res.statusCode}`);
        }
        console.log(`[uplink] SSE connected → ${url}`);
        this.sseRetryMs = this.cfg.reconnectMinMs;
        this.emitState({ connected: true });
        await this.parseSse(res.body, onMessage);
        // Stream ended cleanly (server closed) — treat as disconnected.
        this.emitState({ connected: false });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.stopped) {
          console.error("[uplink] SSE error:", msg);
          this.emitState({ connected: false, error: msg });
        }
      } finally {
        clearTimeout(connectTimer);
        this.sseAbort = null;
      }
      if (this.stopped) return;
      const wait = this.sseRetryMs;
      this.sseRetryMs = Math.min(
        Math.round(wait * 1.8),
        this.cfg.reconnectMaxMs
      );
      console.log(`[uplink] reconnecting in ${wait}ms`);
      await sleep(wait);
    }
  }

  private async parseSse(
    body: NodeJS.ReadableStream,
    onMessage: (m: SatelliteInMessage) => void
  ): Promise<void> {
    let buf = "";
    for await (const chunk of body as AsyncIterable<Buffer>) {
      // Normalise CRLF → LF so framing works behind proxies that
      // rewrite line endings; our server emits LF but be tolerant.
      buf += chunk.toString("utf8").replace(/\r\n/g, "\n");
      // SSE event = block terminated by \n\n. Lines inside start with
      // `data:` — accumulate, then JSON.parse the payload.
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = block.split("\n");
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith(":")) continue; // comment/keepalive
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""));
          }
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");
        try {
          const parsed = JSON.parse(payload) as SatelliteInMessage;
          onMessage(parsed);
        } catch (err) {
          console.warn(
            "[uplink] dropped malformed SSE payload:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.sseAbort?.abort();
    this.sseAbort = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
