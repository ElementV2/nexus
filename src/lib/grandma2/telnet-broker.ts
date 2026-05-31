import { Socket } from "node:net";
import type { BrokerImpl, ConnectionStatus, KindEvent } from "@/lib/core/types";

/**
 * grandMA2 command-line broker over Telnet.
 *
 * MA2's native remote command line is a line-oriented TCP service on
 * port 30000 (NOT OSC — MA2's OSC surface only maps faders/executors and
 * needs a third-party plugin for `/cmd`). Anything typeable at the
 * console command line can be sent here, one command per line. The MA3
 * `/cmd` OSC trick does not exist natively on MA2, so we use Telnet —
 * the same transport mature control surfaces use for MA2.
 *
 * The action catalog emits `{ address: "/cmd", args: [commandString] }`
 * (shared shape with the MA3 OSC broker); this broker unwraps the string
 * and writes it as a line. Send-only from our side — replies (the console
 * banner / prompts) are ignored.
 */

export interface MA2TelnetConfig {
  host: string;
  port: number;
  /** Telnet login user. MA2 requires a login before commands are
   *  accepted; leave blank only if the console allows anonymous. */
  user?: string;
  /** Telnet login password (paired with `user`). */
  password?: string;
}

const CONNECT_TIMEOUT_MS = 6_000;
const RECONNECT_MS = 4_000;

export class GrandMA2TelnetBroker implements BrokerImpl {
  private subscribers = new Set<(event: KindEvent) => void>();
  private socket: Socket | null = null;
  private started = false;
  private connected = false;
  private loggedIn = false;
  private lastStatus: KindEvent | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: MA2TelnetConfig) {}

  // ─────────────────────────── pub/sub ──────────────────────────────────

  subscribe(cb: (event: KindEvent) => void): () => void {
    this.subscribers.add(cb);
    if (this.lastStatus) cb(this.lastStatus);
    if (this.subscribers.size === 1) this.start();
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  private publish(event: KindEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch {
        /* a misbehaving subscriber must not break the broker */
      }
    }
  }

  private setConnected(value: boolean, error?: string): void {
    this.connected = value;
    const event: KindEvent = {
      type: "status",
      connected: value,
      host: this.config.host,
      port: this.config.port,
      ...(error ? { error } : {}),
    };
    this.lastStatus = event;
    this.publish(event);
  }

  // ─────────────────────────── surface ──────────────────────────────────

  getSnapshot(): unknown | null {
    return this.connected ? { connected: true, host: this.config.host } : null;
  }

  getStatus(): ConnectionStatus {
    if (!this.started) return "offline";
    return this.connected ? "connected" : "connecting";
  }

  updateConfig(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const next: MA2TelnetConfig = {
      host: typeof r.host === "string" ? r.host : this.config.host,
      port: typeof r.port === "number" ? r.port : this.config.port,
      user: typeof r.user === "string" ? r.user : this.config.user,
      password:
        typeof r.password === "string" ? r.password : this.config.password,
    };
    const changed =
      next.host !== this.config.host ||
      next.port !== this.config.port ||
      next.user !== this.config.user ||
      next.password !== this.config.password;
    this.config = next;
    if (changed && this.started) {
      this.teardownSocket();
      this.openSocket();
    }
  }

  send(command: unknown): Promise<unknown> {
    if (!command || typeof command !== "object") {
      return Promise.reject(new Error("grandma2 command must be an object"));
    }
    const body = command as {
      address?: string;
      args?: unknown[];
      action?: string;
    };
    if (body.action === "test") {
      return Promise.resolve(
        this.connected
          ? { ok: true, connected: true }
          : { ok: false, error: "Not connected to MA2 telnet" }
      );
    }
    // The MA2 action catalog only emits command-line strings.
    if (body.address !== "/cmd") {
      return Promise.reject(
        new Error("grandMA2 supports command-line only (telnet)")
      );
    }
    const line = String(body.args?.[0] ?? "");
    return this.writeLine(line);
  }

  dispose(): void {
    this.stop();
  }

  // ─────────────────────────── transport ────────────────────────────────

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.openSocket();
  }

  private stop(): void {
    this.started = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.setConnected(false);
  }

  private teardownSocket(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {
        /* already gone */
      }
      this.socket = null;
    }
    this.loggedIn = false;
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.started) this.openSocket();
    }, RECONNECT_MS);
  }

  private openSocket(): void {
    this.teardownSocket();
    const sock = new Socket();
    this.socket = sock;
    this.connectTimer = setTimeout(() => {
      // Connect stalled — drop and let the reconnect loop retry.
      this.teardownSocket();
      this.setConnected(false, "connect timeout");
      this.scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    sock.on("connect", () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.setConnected(true);
      // MA2 needs a login before it accepts commands. Send it once the
      // socket is up; harmless if the console is configured open.
      if (this.config.user) {
        void this.writeLine(
          `login ${this.config.user} ${this.config.password ?? ""}`.trim()
        );
        this.loggedIn = true;
      }
    });
    // Drain inbound (banner / prompts / command echoes) — we don't parse
    // it, but reading prevents the socket buffer from stalling.
    sock.on("data", () => {});
    sock.on("error", (err) => {
      this.setConnected(false, err.message);
      this.teardownSocket();
      this.scheduleReconnect();
    });
    sock.on("close", () => {
      if (this.connected) this.setConnected(false);
      this.teardownSocket();
      this.scheduleReconnect();
    });

    try {
      sock.connect(this.config.port, this.config.host);
    } catch (err) {
      this.setConnected(false, err instanceof Error ? err.message : String(err));
      this.scheduleReconnect();
    }
  }

  private writeLine(line: string): Promise<{ ok: true }> {
    return new Promise((resolve, reject) => {
      const sock = this.socket;
      if (!sock || !this.connected) {
        reject(new Error("MA2 telnet not connected"));
        return;
      }
      sock.write(`${line}\r\n`, (err) => {
        if (err) reject(err);
        else resolve({ ok: true });
      });
    });
  }
}
