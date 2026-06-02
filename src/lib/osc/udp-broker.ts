import { createSocket, type Socket } from "node:dgram";
import { encodeMessage, decodePacket, type OscArg } from "@/lib/ableton/osc-codec";
import { createLogger } from "@/lib/core/logger";

/**
 * Per-instance UDP-OSC broker shared by every OSC-over-UDP device
 * (Behringer X32 / M32, grandMA3, grandMA2). Each connection constructs
 * its OWN instance — no module singletons — mirroring the per-connection
 * model used by mature control surfaces (one socket + state object per
 * configured device).
 *
 * The console-specific bits are passed in as a small declarative
 * `OscUdpSpec` so the two flavours that used to be ~90% copy-pasted
 * brokers now share all the socket / subscribe / heartbeat / publish
 * machinery:
 *   • X32 — `/xremote` subscription renewal, `/info` heartbeat that
 *     parses version/model, stale-reply detection, socket auto-retry.
 *   • grandMA — send-only `/cmd` console; "connected" the moment the
 *     socket binds because MA never replies over OSC.
 */

export interface OscUdpConfig {
  host: string;
  port: number;
  /** Optional OSC address prefix. grandMA consoles can be configured
   *  with an OSC prefix (e.g. "gma3") — when set, the console only
   *  matches addresses sent as `/<prefix><address>` (so `/cmd` becomes
   *  `/gma3/cmd`). Leave empty/unset for no prefix. X32 ignores it. */
  prefix?: string;
}

export interface OscMessage {
  address: string;
  args: OscArg[];
}

export interface OscBrokerEvent {
  type: string;
  [k: string]: unknown;
}

export interface OscUdpSpec {
  /** Short tag for log lines (e.g. "x32", "grandma3"). */
  tag: string;
  /** Heartbeat/keepalive messages + cadence. */
  ping: { messages: OscMessage[]; intervalMs: number };
  /** Optional subscription-renewal messages (X32 `/xremote`). */
  subscribe?: { messages: OscMessage[]; intervalMs: number };
  /** Mark "connected" as soon as the socket binds — for send-only
   *  consoles (grandMA) that never reply over OSC. Default false →
   *  connected on the first inbound packet. */
  connectedOnOpen?: boolean;
  /** Flip to disconnected when no packet arrives within this window.
   *  Omit for send-only consoles (no replies to time out). */
  staleMs?: number;
  /** Re-create the socket this long after a socket error. Omit to not
   *  auto-retry. */
  socketRetryMs?: number;
  /** Parse an inbound message into an info patch (e.g. X32 `/info` →
   *  { version, model, name }). Returns null to ignore the message. */
  parseInfo?: (m: OscMessage) => Record<string, unknown> | null;
  /** If set, the accumulated info object is surfaced under this key in
   *  the snapshot + status events (X32 uses "info"). */
  exposeInfoAs?: string;
  /** Test ("{ action: 'test' }") behaviour: "info" returns the cached
   *  info (X32, which replies); "ping" fires the heartbeat and reports
   *  it sent (grandMA, send-only). */
  testMode: "info" | "ping";
}

type Subscriber = (event: OscBrokerEvent) => void;

export class OscUdpBroker {
  private subscribers = new Set<Subscriber>();
  private socket: Socket | null = null;
  private started = false;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private socketRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplyTs = 0;
  private connected = false;
  private info: Record<string, unknown> = {};
  private lastStatusEvent: OscBrokerEvent | null = null;
  /** Last value seen per inbound OSC address (first arg). Powers
   *  state-based toggles and lets feedback read current console state
   *  without each consumer tracking it. */
  private lastValues = new Map<string, OscArg>();
  private readonly log: ReturnType<typeof createLogger>;

  constructor(
    public config: OscUdpConfig,
    private spec: OscUdpSpec
  ) {
    this.log = createLogger(spec.tag);
  }

  // ─────────────────────────── pub/sub ──────────────────────────────────

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.lastStatusEvent) cb(this.lastStatusEvent);
    if (this.subscribers.size === 1) this.start();
    return () => this.unsubscribe(cb);
  }

  private unsubscribe(cb: Subscriber): void {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) this.stop();
  }

  private publish(event: OscBrokerEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        /* a misbehaving subscriber should not break the broker */
      }
    }
  }

  // ─────────────────────────── surface ──────────────────────────────────

  getSnapshot(): unknown | null {
    if (!this.connected) return null;
    return {
      connected: true,
      host: this.config.host,
      ...(this.spec.exposeInfoAs ? { [this.spec.exposeInfoAs]: this.info } : {}),
    };
  }

  getStatus(): "connected" | "connecting" | "offline" {
    if (!this.started) return "offline";
    return this.connected ? "connected" : "connecting";
  }

  updateConfig(next: OscUdpConfig): void {
    const changed =
      next.host !== this.config.host || next.port !== this.config.port;
    this.config = next;
    if (changed && this.started) {
      this.stop();
      this.start();
    }
  }

  send(command: unknown): Promise<unknown> {
    if (!command || typeof command !== "object") {
      return Promise.reject(
        new Error(`${this.spec.tag} command must be an object`)
      );
    }
    const body = command as {
      address?: string;
      args?: OscArg[];
      action?: string;
    };
    if (body.action === "test") return this.runTest();
    if (typeof body.address !== "string" || !body.address.startsWith("/")) {
      return Promise.reject(
        new Error(`${this.spec.tag} command needs \`address\` (OSC path)`)
      );
    }
    // State-based toggle: flip the last-seen 0/1 value for this address.
    // X32 has no native toggle, and /xremote echoes our own writes so the
    // cache self-heals; default to "turn off" (0) when state is unknown.
    if ((body as { toggle?: boolean }).toggle) {
      const cur = this.lastValues.get(body.address);
      const next = typeof cur === "number" && cur >= 0.5 ? 0 : 1;
      const wasUnknown = typeof cur !== "number";
      return this.sendOsc(body.address, [wasUnknown ? 0 : next]);
    }
    return this.sendOsc(body.address, body.args ?? []);
  }

  private async runTest(): Promise<unknown> {
    if (this.spec.testMode === "info") {
      if (!this.connected) {
        return {
          ok: false,
          error: "Not connected (subscribe to wake the broker)",
        };
      }
      return { ok: true, ...this.info };
    }
    // "ping": send the heartbeat and report it left the wire.
    try {
      const first = this.spec.ping.messages[0];
      if (first) await this.sendOsc(first.address, first.args);
      return { ok: true, sent: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  dispose(): void {
    this.stop();
  }

  // ─────────────────────────── transport ────────────────────────────────

  /** Prepend the configured OSC prefix (if any) to an address. The
   *  prefix is stored bare or slash-wrapped; normalise both to
   *  `/<prefix><address>`. */
  private withPrefix(address: string): string {
    const p = (this.config.prefix ?? "").replace(/^\/+|\/+$/g, "");
    return p ? `/${p}${address}` : address;
  }

  private async sendOsc(address: string, args: OscArg[]): Promise<{ ok: true }> {
    if (!this.socket) this.ensureSocket();
    if (!this.socket) throw new Error(`${this.spec.tag} socket not available`);
    const buf = encodeMessage({ address: this.withPrefix(address), args });
    return new Promise((resolve, reject) => {
      this.socket!.send(buf, this.config.port, this.config.host, (err) => {
        if (err) reject(err);
        else resolve({ ok: true });
      });
    });
  }

  private sendAll(messages: OscMessage[]): void {
    for (const m of messages) {
      void this.sendOsc(m.address, m.args).catch(() => {
        /* socket may be momentarily unavailable; next tick recovers */
      });
    }
  }

  // ─────────────────────────── lifecycle ────────────────────────────────

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.ensureSocket();
    if (this.spec.connectedOnOpen && this.socket) this.setConnected(true);

    // Fire an immediate heartbeat (+ subscription) so the console wakes
    // without waiting a full interval.
    this.sendAll(this.spec.ping.messages);
    if (this.spec.subscribe) this.sendAll(this.spec.subscribe.messages);

    this.timers.push(
      setInterval(() => {
        this.sendAll(this.spec.ping.messages);
        if (
          this.spec.staleMs &&
          this.connected &&
          Date.now() - this.lastReplyTs > this.spec.staleMs
        ) {
          this.setConnected(false, "No reply");
        }
      }, this.spec.ping.intervalMs)
    );
    if (this.spec.subscribe) {
      const sub = this.spec.subscribe;
      this.timers.push(
        setInterval(() => this.sendAll(sub.messages), sub.intervalMs)
      );
    }
  }

  private stop(): void {
    this.started = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.socketRetryTimer) {
      clearTimeout(this.socketRetryTimer);
      this.socketRetryTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
    this.setConnected(false);
    this.info = {};
    this.lastReplyTs = 0;
    this.lastValues.clear();
  }

  private ensureSocket(): void {
    if (this.socket) return;
    try {
      const sock = createSocket({ type: "udp4", reuseAddr: true });
      sock.on("message", (msg) => this.onMessage(msg));
      sock.on("error", (err) => {
        this.log.warn(`socket error: ${err.message}`);
        // Drop the dead socket so it actually gets rebuilt. `ensureSocket`
        // (and the next heartbeat's `sendOsc`) both early-out while
        // `this.socket` is still set — so a socket left in place after an
        // error never recovered. Nulling it lets the retry/heartbeat rebind.
        try {
          sock.close();
        } catch {
          /* already closing */
        }
        if (this.socket === sock) {
          this.socket = null;
          this.setConnected(false, err.message);
        }
        this.scheduleSocketRetry();
      });
      sock.bind(0);
      this.socket = sock;
    } catch (err) {
      this.log.warn(
        `failed to create socket: ${err instanceof Error ? err.message : String(err)}`
      );
      this.scheduleSocketRetry();
    }
  }

  private scheduleSocketRetry(): void {
    if (!this.spec.socketRetryMs || this.socketRetryTimer || !this.started) {
      return;
    }
    this.socketRetryTimer = setTimeout(() => {
      this.socketRetryTimer = null;
      this.ensureSocket();
    }, this.spec.socketRetryMs);
  }

  private onMessage(buf: Buffer): void {
    this.lastReplyTs = Date.now();
    if (!this.connected) this.setConnected(true);
    const msgs = decodePacket(new Uint8Array(buf));
    for (const m of msgs) {
      const decoded: OscMessage = { address: m.address, args: m.args };
      if (m.args.length > 0) this.lastValues.set(m.address, m.args[0]);
      if (this.spec.parseInfo) {
        const patch = this.spec.parseInfo(decoded);
        if (patch) this.info = { ...this.info, ...patch };
      }
      this.publish({
        type: "osc",
        address: m.address,
        args: m.args.map((a) => (a instanceof Uint8Array ? Array.from(a) : a)),
      });
    }
  }

  private setConnected(value: boolean, error?: string): void {
    // Log only real transitions (setConnected is called every stale-check
    // tick with the same value otherwise).
    if (value !== this.connected) {
      const where = `${this.config.host}:${this.config.port}`;
      if (value) this.log.info(`connected to ${where}`);
      else this.log.warn(`disconnected from ${where}${error ? ` — ${error}` : ""}`);
    }
    this.connected = value;
    const event: OscBrokerEvent = {
      type: "status",
      connected: value,
      host: this.config.host,
      port: this.config.port,
      ...(this.spec.exposeInfoAs ? { [this.spec.exposeInfoAs]: this.info } : {}),
      ...(error ? { error } : {}),
    };
    this.lastStatusEvent = event;
    this.publish(event);
  }
}
