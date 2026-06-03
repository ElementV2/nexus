import net from "node:net";
import { parseVmixXml } from "./xml-parser";
import { STATE_FETCH_TIMEOUT_MS } from "./constants";
import { createLogger } from "@/lib/core/logger";
import type { VmixState } from "./types";

/**
 * Per-instance vMix broker. Prefers vMix's real-time TCP API and falls back to
 * HTTP, so it's both fast and robust:
 *
 *   • TCP API (8099) — ONE persistent socket: `SUBSCRIBE TALLY` + `ACTS` (vMix
 *     PUSHES program/preview + activator changes → instant feedback), carries
 *     `FUNCTION` commands, AND fetches `XML` for full state. **When this socket
 *     is up, EVERYTHING goes over it** — state, events, commands. HTTP is not
 *     touched (no double-polling).
 *   • HTTP API (8088) — fallback only: used for state + commands when the TCP
 *     socket is down (8099 off / firewalled) or has stalled, so the connection
 *     never drops just because one API is unavailable.
 *
 * The connection is "connected" while EITHER transport answers; an error is
 * reported only when BOTH are down. The emitted `StateMessage` shape is
 * unchanged, so everything downstream (variable-bridges → variable-bus → deck
 * feedback, the operator pages, `getSnapshot`) is untouched.
 */

const log = createLogger("vmix-tcp");

export interface VmixBrokerConfig {
  host: string;
  /** vMix HTTP API port (8088) — fallback transport. */
  httpPort: number;
  /** vMix TCP API port (8099) — primary, real-time transport. */
  tcpPort: number;
  /** XML refresh cadence (ms) — keeps VU/levels fresh (they aren't pushed). */
  pollingInterval: number;
}

export type StateMessage =
  | { ok: true; state: VmixState; raw: string; ts: number }
  | { ok: false; error: string; ts: number };

type Subscriber = (m: StateMessage) => void;

const FLOOR_MS = 50;
const ERROR_BACKOFF_MS_INITIAL = 1_000;
const ERROR_BACKOFF_MS_MAX = 5_000;
/** Coalesce a burst of pushed TALLY/ACTS events into one refresh. */
const EVENT_REFRESH_THROTTLE_MS = 40;
const COMMAND_TIMEOUT_MS = 5_000;
const TCP_RECONNECT_MS_INITIAL = 2_000;
const TCP_RECONNECT_MS_MAX = 15_000;
const TCP_XML_TIMEOUT_MS = 3_000;

/**
 * One auto-reconnecting TCP socket. Connect failures log once per down period
 * (so a blocked 8099 is diagnosable) but don't spam during backoff retries.
 */
class VmixConn {
  private sock: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = TCP_RECONNECT_MS_INITIAL;
  private disposed = false;
  private loggedConnectError = false;
  connected = false;

  constructor(
    private target: () => { host: string; port: number },
    private handlers: {
      onConnect: () => void;
      onData: (chunk: Buffer) => void;
      onClose: () => void;
    }
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.clearReconnect();
    const { host, port } = this.target();
    const sock = net.connect({ host, port });
    this.sock = sock;
    sock.setNoDelay(true); // latency-sensitive frames — never coalesce
    sock.on("connect", () => {
      this.connected = true;
      this.backoff = TCP_RECONNECT_MS_INITIAL;
      this.loggedConnectError = false;
      log.info(`real-time TCP connected ${host}:${port}`);
      this.handlers.onConnect();
    });
    sock.on("data", (chunk) => this.handlers.onData(chunk));
    sock.on("error", (err: NodeJS.ErrnoException) => {
      // 'close' follows and drives the reconnect. Log the FIRST failure of a
      // down period so a blocked/closed 8099 is diagnosable, then stay quiet.
      if (!this.connected && !this.loggedConnectError) {
        this.loggedConnectError = true;
        log.warn(
          `real-time TCP cannot reach ${host}:${port} — ${err.code || err.message}. ` +
            `Falling back to HTTP. (Is vMix's TCP API enabled + port ${port} open?)`
        );
      }
    });
    sock.on("close", () => {
      const was = this.connected;
      this.connected = false;
      this.sock = null;
      if (was) {
        log.warn("real-time TCP dropped — reconnecting (HTTP fallback meanwhile)");
        this.handlers.onClose();
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(TCP_RECONNECT_MS_MAX, this.backoff * 2);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(s: string): boolean {
    if (this.sock && this.connected) {
      this.sock.write(s);
      return true;
    }
    return false;
  }

  retarget(): void {
    this.backoff = TCP_RECONNECT_MS_INITIAL;
    this.loggedConnectError = false;
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
      this.connected = false;
    }
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnect();
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    this.connected = false;
  }
}

export class VmixTcpBroker {
  private subscribers = new Set<Subscriber>();
  private lastMessage: StateMessage | null = null;
  private lastRaw: string | null = null;
  private disposed = false;

  /** Per-source health — connection is up while EITHER is true. */
  private httpHealthy = false;
  private tcpHealthy = false;
  private loggedTcpState = false;

  // ── State engine (single self-rescheduling loop; TCP-primary) ──
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on a target change so a stale async continuation no-ops instead of
   *  spawning a second loop. */
  private cycleGen = 0;
  private currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
  private httpInFlight = false;

  // ── TCP real-time channel ──
  private tcp: VmixConn;
  private tcpBuf = Buffer.alloc(0);
  /** Bytes of an XML body still to read; -1 = parsing line responses. */
  private xmlExpect = -1;
  private tcpXmlInFlight = false;
  private tcpXmlTimer: ReturnType<typeof setTimeout> | null = null;
  /** Socket is up but stopped answering `XML` → use HTTP until it recovers
   *  (a TALLY/ACTS push or a fresh XML response clears it). */
  private tcpStalled = false;
  private pendingFns: Array<{
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: VmixBrokerConfig) {
    this.tcp = new VmixConn(
      () => ({ host: this.config.host, port: this.config.tcpPort }),
      {
        onConnect: () => {
          this.tcpBuf = Buffer.alloc(0);
          this.xmlExpect = -1;
          this.tcpXmlInFlight = false;
          this.tcpStalled = false;
          this.tcp.send("SUBSCRIBE TALLY\r\n");
          this.tcp.send("SUBSCRIBE ACTS\r\n");
          this.requestState(); // first snapshot over TCP immediately
        },
        onData: (chunk) => this.onTcpData(chunk),
        onClose: () => {
          this.clearTcpXmlTimer();
          this.tcpXmlInFlight = false;
          this.failPending("vMix real-time socket closed");
          this.markFail("tcp"); // HTTP keeps the connection alive if it's up
        },
      }
    );
    this.tcp.connect();
    this.runStateCycle();
  }

  // ─────────────────────────── Public surface ──────────────────────────

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.lastMessage) cb(this.lastMessage);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  getSnapshot(): StateMessage | null {
    return this.lastMessage;
  }

  getStatus(): "offline" | "connecting" | "connected" | "error" {
    if (this.disposed) return "offline";
    if (!this.lastMessage) return "connecting";
    return this.lastMessage.ok ? "connected" : "error";
  }

  /** Which transport is currently carrying state — for the UI's live label.
   *  TCP wins when its socket is delivering (the normal real-time case); HTTP
   *  means we've fallen back; null = nothing connected yet. */
  activeTransport(): "tcp" | "http" | null {
    if (this.tcpHealthy) return "tcp";
    if (this.httpHealthy) return "http";
    return null;
  }

  updateConfig(config: VmixBrokerConfig): void {
    const targetChanged =
      config.host !== this.config.host ||
      config.httpPort !== this.config.httpPort ||
      config.tcpPort !== this.config.tcpPort;
    this.config = config;
    if (!targetChanged) return;
    this.currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
    this.lastMessage = null;
    this.lastRaw = null;
    this.httpHealthy = false;
    this.tcpHealthy = false;
    this.tcpStalled = false;
    this.tcp.retarget(); // reconnect TCP to the new host now
    this.restartStateCycle(); // re-poll the new target immediately
  }

  /**
   * Send a vMix shortcut. Goes over the persistent TCP socket (`FUNCTION`)
   * whenever it's up; rejects if it's down / on `FUNCTION ER` / timeout so the
   * adapter falls back to HTTP — a live command is never lost.
   */
  sendFunction(fn: string, params: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) return reject(new Error("vMix broker disposed"));
      const qs = new URLSearchParams(params).toString();
      const line = qs ? `FUNCTION ${fn} ${qs}\r\n` : `FUNCTION ${fn}\r\n`;
      if (!this.tcp.send(line)) {
        return reject(new Error("vMix TCP not connected"));
      }
      const timer = setTimeout(() => {
        const idx = this.pendingFns.findIndex((p) => p.timer === timer);
        if (idx >= 0) this.pendingFns.splice(idx, 1);
        reject(new Error("vMix command timed out"));
      }, COMMAND_TIMEOUT_MS);
      this.pendingFns.push({ resolve, reject, timer });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cycleGen++;
    this.tcp.dispose();
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.clearTcpXmlTimer();
    this.failPending("vMix broker disposed");
    this.subscribers.clear();
    this.lastMessage = null;
    this.lastRaw = null;
  }

  // ─────────────────────────── State engine ────────────────────────────

  /** One loop, TCP-primary: request a fresh XML over whichever transport is
   *  live (TCP if its socket is up and not stalled, else HTTP), then schedule
   *  the next cycle. The generation guard keeps a target change from spawning
   *  a parallel loop. */
  private runStateCycle(gen = this.cycleGen): void {
    if (this.disposed || gen !== this.cycleGen) return;
    const interval = Math.max(FLOOR_MS, this.config.pollingInterval);
    if (this.tcp.connected && !this.tcpStalled) {
      this.requestTcpXml();
      this.stateTimer = setTimeout(() => this.runStateCycle(gen), interval);
    } else {
      void this.httpFetch().then(() => {
        if (this.disposed || gen !== this.cycleGen) return;
        const delay =
          this.httpHealthy || this.tcpHealthy
            ? interval
            : Math.max(interval, this.currentErrorBackoff);
        this.stateTimer = setTimeout(() => this.runStateCycle(gen), delay);
      });
    }
  }

  private restartStateCycle(): void {
    this.cycleGen++;
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    this.runStateCycle();
  }

  /** Fetch state once over whichever transport is live (used by the event
   *  refresh + the TCP onConnect snapshot). */
  private requestState(): void {
    if (this.disposed) return;
    if (this.tcp.connected && !this.tcpStalled) this.requestTcpXml();
    else void this.httpFetch();
  }

  /** A pushed TALLY/ACTS event → pull a fresh snapshot now (coalesced). */
  private scheduleRefresh(): void {
    if (this.refreshTimer || this.disposed) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.requestState();
    }, EVENT_REFRESH_THROTTLE_MS);
  }

  private async httpFetch(): Promise<void> {
    if (this.disposed || this.httpInFlight) return;
    this.httpInFlight = true;
    const { host, httpPort } = this.config;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), STATE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`http://${host}:${httpPort}/api`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const raw = await res.text();
      if (!res.ok) {
        this.httpHealthy = false;
        this.evaluateError(`Upstream ${res.status}`);
        this.bumpErrorBackoff();
      } else {
        this.ingest(raw, "http");
      }
    } catch (err) {
      this.httpHealthy = false;
      this.evaluateError(err instanceof Error ? err.message : "fetch failed");
      this.bumpErrorBackoff();
    } finally {
      clearTimeout(to);
      this.httpInFlight = false;
    }
  }

  private bumpErrorBackoff(): void {
    this.currentErrorBackoff = Math.min(
      ERROR_BACKOFF_MS_MAX,
      this.currentErrorBackoff * 2
    );
  }

  // ─────────────────────────── State ingest ────────────────────────────

  private ingest(raw: string, source: "http" | "tcp"): void {
    if (this.disposed) return;
    if (source === "http") {
      this.httpHealthy = true;
    } else {
      this.tcpHealthy = true;
      if (!this.loggedTcpState) {
        this.loggedTcpState = true;
        log.info("state + commands now flowing over the TCP API");
      }
    }
    this.currentErrorBackoff = ERROR_BACKOFF_MS_INITIAL;
    if (raw === this.lastRaw && this.lastMessage?.ok) {
      this.lastMessage = { ...this.lastMessage, ts: Date.now() };
      return;
    }
    try {
      const state = parseVmixXml(raw);
      this.lastRaw = raw;
      this.publish({ ok: true, state, raw, ts: Date.now() });
    } catch (err) {
      if (source === "http") this.httpHealthy = false;
      else this.tcpHealthy = false;
      log.warn(`${source} XML parse failed: ${err instanceof Error ? err.message : err}`);
      this.evaluateError("XML parse failed");
    }
  }

  private markFail(source: "http" | "tcp"): void {
    if (source === "http") this.httpHealthy = false;
    else this.tcpHealthy = false;
    this.evaluateError("vMix unreachable");
  }

  /** Publish an error ONLY when neither transport is healthy. */
  private evaluateError(reason: string): void {
    if (this.httpHealthy || this.tcpHealthy) return;
    this.publish({ ok: false, error: reason, ts: Date.now() });
  }

  // ─────────────────────────── TCP socket ──────────────────────────────

  private requestTcpXml(): void {
    if (this.disposed || this.tcpXmlInFlight) return;
    if (!this.tcp.send("XML\r\n")) return;
    this.tcpXmlInFlight = true;
    this.clearTcpXmlTimer();
    this.tcpXmlTimer = setTimeout(() => {
      // Socket up but vMix didn't answer XML — flip to HTTP until it recovers.
      this.tcpXmlInFlight = false;
      this.tcpStalled = true;
      log.warn("TCP XML timed out — using HTTP for state until it recovers");
      void this.httpFetch();
    }, TCP_XML_TIMEOUT_MS);
  }

  private clearTcpXmlTimer(): void {
    if (this.tcpXmlTimer) {
      clearTimeout(this.tcpXmlTimer);
      this.tcpXmlTimer = null;
    }
  }

  /**
   * Unified parser for the single TCP socket: line responses (VERSION /
   * SUBSCRIBE / TALLY / ACTS / FUNCTION) interleaved with the length-prefixed
   * `XML <len>` body.
   */
  private onTcpData(chunk: Buffer): void {
    this.tcpBuf = Buffer.concat([this.tcpBuf, chunk]);
    for (;;) {
      if (this.xmlExpect >= 0) {
        if (this.tcpBuf.length < this.xmlExpect) return;
        const body = this.tcpBuf.slice(0, this.xmlExpect).toString("utf8");
        this.tcpBuf = this.tcpBuf.slice(this.xmlExpect);
        this.xmlExpect = -1;
        this.tcpXmlInFlight = false;
        this.tcpStalled = false;
        this.clearTcpXmlTimer();
        if (this.tcpBuf.length >= 2 && this.tcpBuf[0] === 13 && this.tcpBuf[1] === 10) {
          this.tcpBuf = this.tcpBuf.slice(2); // optional trailing CRLF
        }
        this.ingest(body, "tcp");
        continue;
      }
      const nl = this.tcpBuf.indexOf("\r\n");
      if (nl < 0) return;
      const line = this.tcpBuf.slice(0, nl).toString("utf8");
      this.tcpBuf = this.tcpBuf.slice(nl + 2);
      if (line.startsWith("XML ")) {
        const len = Number(line.slice(4).trim());
        if (Number.isFinite(len) && len > 0) this.xmlExpect = len;
        else this.tcpXmlInFlight = false; // "XML ER" / empty
        continue;
      }
      this.handleEventLine(line);
    }
  }

  private handleEventLine(line: string): void {
    if (!line) return;
    const sp = line.indexOf(" ");
    const cmd = sp < 0 ? line : line.slice(0, sp);
    switch (cmd) {
      case "TALLY":
      case "ACTS":
        // Events flowing → the socket is alive → un-stall + pull fresh state.
        this.tcpStalled = false;
        this.scheduleRefresh();
        break;
      case "FUNCTION": {
        const rest = sp < 0 ? "" : line.slice(sp + 1);
        const p = this.pendingFns.shift();
        if (p) {
          clearTimeout(p.timer);
          if (rest.startsWith("OK")) p.resolve();
          else p.reject(new Error(`vMix: ${rest || "FUNCTION ER"}`));
        }
        break;
      }
      default:
        break; // VERSION / SUBSCRIBE OK / anything else: ignore
    }
  }

  private failPending(reason: string): void {
    const ps = this.pendingFns;
    this.pendingFns = [];
    for (const p of ps) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
  }

  private publish(m: StateMessage): void {
    if (this.disposed) return;
    this.lastMessage = m;
    for (const sub of this.subscribers) {
      try {
        sub(m);
      } catch {
        // a misbehaving subscriber must not break the broker
      }
    }
  }
}
