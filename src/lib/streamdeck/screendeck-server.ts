/**
 * Companion Satellite API server — lets on-screen virtual decks
 * (ScreenDeck, and any other Bitfocus "Companion Satellite" client)
 * drive Nexus the same way a physical Stream Deck does.
 *
 * ScreenDeck does NOT emulate a HID device: it's a Satellite *client*
 * that opens an OUTBOUND TCP connection to a server (normally Bitfocus
 * Companion) on port 16622 and registers one or more virtual surfaces.
 * To support it, Nexus plays the *server* side of that protocol here.
 * A registered surface is surfaced to the rest of the app as a remote
 * device (`screendeck:<deviceId>` path) so the existing driver / pairing
 * / feedback / press pipeline treats it exactly like a satellite deck.
 *
 * Protocol (line-based, `\n`-terminated; `CMD ARG=VAL ARG="v w"`):
 *   ← BEGIN / CAPS                       we greet on connect
 *   → ADD-DEVICE DEVICEID PRODUCT_NAME KEYS_TOTAL KEYS_PER_ROW BITMAPS …
 *   → KEY-PRESS DEVICEID KEY PRESSED     a button down/up
 *   → PING / PONG / REMOVE-DEVICE / QUIT
 *   ← KEY-STATE DEVICEID KEY BITMAP …    we stream the composed key face
 *   ← KEYS-CLEAR / BRIGHTNESS / PONG / PING
 *
 * This is a TRANSPORT only: it ships raw RGB buffers the driver composed
 * (same `drawKeyFace` engine as HID + the browser) and emits presses.
 * We implement "Simple mode" (uniform grid + bitmaps); encoders / the
 * Advanced control model are deferred.
 */

import net from "node:net";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { createLogger } from "@/lib/core/logger";

/** A virtual surface registered by a connected client. */
export interface ScreendeckDevice {
  /** Client-assigned session id — the stable identity layouts pair to
   *  (exposed as the deck "serial"). */
  deviceId: string;
  productName: string;
  rows: number;
  cols: number;
  /** Bitmap edge length the client asked for (px). 0 = colour-only. */
  bitmapSize: number;
  remoteAddr?: string;
}

type PressListener = (event: {
  serial: string;
  keyIndex: number;
  type: "down" | "up";
}) => void;

interface Conn {
  socket: net.Socket;
  buffer: string;
  remoteAddr?: string;
  lastSeenTs: number;
  /** device ids registered over THIS socket — cleaned up on close. */
  deviceIds: Set<string>;
  /** Diagnostic: how many raw inbound chunks we've logged for this conn.
   *  Bounded so a normal session (100 ms pings) doesn't flood the log. */
  rawLogged: number;
  /** Per-connection handshake watchdog — fires HANDSHAKE_GRACE_MS after
   *  connect; if this conn registered nothing, triggers auto-recovery.
   *  Cleared on first ADD-DEVICE or when the conn drops. */
  handshakeTimer: ReturnType<typeof setTimeout> | null;
}

// Keepalive: ping idle clients; reap a socket that's gone silent for
// several missed beats (client crashed / network dropped without FIN).
const PING_MS = 4_000;
const STALE_MS = 16_000;
// Retry cadence when the listener can't bind (port transiently held by a
// just-killed previous instance, or a real Companion). Keeps the satellite
// server self-healing instead of dying silently on the first conflict.
const REBIND_MS = 2_000;
// Auto-recovery for the satellite client's reconnect quirk: a client that
// connects to an ALREADY-running server (no connection-refused retry phase)
// can stay dormant — it answers our PINGs but never (re)sends ADD-DEVICE.
// The only thing that unsticks it is the server going down→up (what a
// manual restart does). So a per-connection watchdog fires this long after
// a connect that registered no surface; if NO device is registered server-
// wide we bounce the listener to force that transition. A healthy client
// registers in well under a second, so this grace is comfortably safe.
const HANDSHAKE_GRACE_MS = 2_000;
// Listener-down gap during a bounce. Must exceed the client's own reconnect
// delay (~1 s) so its first retry hits a real connection-refused. We can't
// go much lower without the client reconnecting before we've gone down.
const BOUNCE_GAP_MS = 1_500;
const MAX_BOUNCES = 5;

const log = createLogger("screendeck");

class ScreendeckServerImpl {
  private server: net.Server | null = null;
  private port = 0;
  private conns = new Set<Conn>();
  /** deviceId → its registered surface + owning connection. */
  private devices = new Map<string, { dev: ScreendeckDevice; conn: Conn }>();
  private pressListeners = new Set<PressListener>();
  private changeListeners = new Set<() => void>();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;
  /** Port we WANT bound (null = disabled). Drives the rebind-retry loop so a
   *  transient bind failure self-heals instead of leaving the server dead. */
  private desiredPort: number | null = null;
  private rebindTimer: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive recovery bounces with no successful registration; capped. */
  private bounceCount = 0;

  // ─────────────────────────── lifecycle ──────────────────────────────

  /** Bind the listener on `port`. Idempotent for the same port; a
   *  different port restarts. Never throws — a bind failure (e.g. port
   *  taken by a real Companion) is captured in `lastError` and surfaced
   *  via `status()` so the UI can prompt the operator to change it. */
  start(port: number): void {
    if (this.server && this.port === port) return;
    this.stop();
    this.port = port;
    const server = net.createServer((socket) => this.onConnect(socket));
    server.on("error", (err) => {
      this.lastError = err instanceof Error ? err.message : String(err);
      // EADDRINUSE etc. — drop the half-built server and RETRY so a later
      // free-up (a just-killed previous instance releasing the port) rebinds
      // on its own. Previously this gave up silently → listener dead, no log,
      // ScreenDeck "can't find decks" with no clue why.
      this.server = null;
      log.warn(`listener bind failed on :${port} — ${this.lastError}`);
      this.scheduleRebind(port);
    });
    server.on("listening", () => {
      this.lastError = null;
      log.info(`Companion-Satellite listener up on 0.0.0.0:${port}`);
    });
    try {
      // 0.0.0.0 so a ScreenDeck on another LAN machine can reach us —
      // consistent with Nexus's LAN-trust model.
      server.listen(port, "0.0.0.0");
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.warn(`listen() threw on :${port} — ${this.lastError}`);
      this.scheduleRebind(port);
      return;
    }
    this.server = server;
    if (!this.keepaliveTimer) {
      this.keepaliveTimer = setInterval(() => this.keepalive(), PING_MS);
      this.keepaliveTimer.unref?.();
    }
  }

  /** Retry binding `port` while it's still the desired one and we're not
   *  already listening. One pending retry at a time. */
  private scheduleRebind(port: number): void {
    if (this.rebindTimer) return;
    this.rebindTimer = setTimeout(() => {
      this.rebindTimer = null;
      if (this.desiredPort === port && !this.server) this.start(port);
    }, REBIND_MS);
    this.rebindTimer.unref?.();
  }

  stop(): void {
    if (this.rebindTimer) {
      clearTimeout(this.rebindTimer);
      this.rebindTimer = null;
    }
    for (const c of this.conns) {
      if (c.handshakeTimer) clearTimeout(c.handshakeTimer);
      try {
        c.socket.destroy();
      } catch {
        /* already gone */
      }
    }
    this.conns.clear();
    this.devices.clear();
    if (this.server) {
      try {
        this.server.close();
      } catch {
        /* ignore */
      }
      this.server = null;
    }
  }

  /** Apply a possibly-changed config: (re)bind when enabled, tear down
   *  when disabled. Called at boot and after any preferences write. */
  apply(config: { enabled: boolean; port: number }): void {
    if (!config.enabled) {
      this.desiredPort = null;
      this.stop();
      this.port = 0;
      log.info("Companion-Satellite server disabled");
      return;
    }
    this.desiredPort = config.port;
    this.start(config.port);
  }

  status(): { listening: boolean; port: number; error: string | null } {
    return {
      listening: !!this.server,
      port: this.port,
      error: this.lastError,
    };
  }

  dispose(): void {
    this.desiredPort = null;
    this.stop();
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.pressListeners.clear();
    this.changeListeners.clear();
    this.port = 0;
  }

  // ─────────────────────────── subscriptions ──────────────────────────

  subscribePresses(cb: PressListener): () => void {
    this.pressListeners.add(cb);
    return () => this.pressListeners.delete(cb);
  }

  /** Fired when a surface is added/removed so the driver can re-emit a
   *  `devices-changed` and the coordinator can paint the new deck. */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeListeners) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
  }

  // ─────────────────────────── device queries ─────────────────────────

  forEachDevice(cb: (device: ScreendeckDevice) => void): void {
    for (const { dev } of this.devices.values()) cb(dev);
  }

  dims(deviceId: string): { rows: number; cols: number; iconSize: number } | null {
    const entry = this.devices.get(deviceId);
    if (!entry) return null;
    return {
      rows: entry.dev.rows,
      cols: entry.dev.cols,
      // Compose at the client's requested bitmap size; fall back to a
      // sane default for colour-only clients so the face cache key + any
      // future bitmap still has a size to work with.
      iconSize: entry.dev.bitmapSize > 0 ? entry.dev.bitmapSize : 72,
    };
  }

  // ─────────────────────────── outbound render ────────────────────────

  /** Stream a composed key face (raw RGB, `bitmapSize²·3` bytes) to the
   *  client. The driver owns the compositing; we only base64 + frame it. */
  renderKey(deviceId: string, keyIndex: number, rgb: Buffer): void {
    const entry = this.devices.get(deviceId);
    if (!entry) return;
    const b64 = rgb.toString("base64");
    const key = keyToCoord(keyIndex, entry.dev.cols);
    this.write(
      entry.conn,
      `KEY-STATE DEVICEID=${deviceId} KEY=${key} BITMAP=${b64}\n`
    );
  }

  /** Blank one key — send an all-black bitmap of the right size (the
   *  protocol has no per-key clear). No canvas needed for black. */
  clearKey(deviceId: string, keyIndex: number): void {
    const entry = this.devices.get(deviceId);
    if (!entry) return;
    const key = keyToCoord(keyIndex, entry.dev.cols);
    const size = entry.dev.bitmapSize;
    if (size > 0) {
      const black = Buffer.alloc(size * size * 3).toString("base64");
      this.write(
        entry.conn,
        `KEY-STATE DEVICEID=${deviceId} KEY=${key} BITMAP=${black}\n`
      );
    } else {
      this.write(
        entry.conn,
        `KEY-STATE DEVICEID=${deviceId} KEY=${key} COLOR=#000000\n`
      );
    }
  }

  clearPanel(deviceId: string): void {
    const entry = this.devices.get(deviceId);
    if (!entry) return;
    this.write(entry.conn, `KEYS-CLEAR DEVICEID=${deviceId}\n`);
  }

  setBrightness(deviceId: string, percent: number): void {
    const entry = this.devices.get(deviceId);
    if (!entry) return;
    const v = Math.max(0, Math.min(100, percent | 0));
    this.write(entry.conn, `BRIGHTNESS DEVICEID=${deviceId} VALUE=${v}\n`);
  }

  // ─────────────────────────── connection I/O ─────────────────────────

  private onConnect(socket: net.Socket): void {
    socket.setNoDelay(true);
    const conn: Conn = {
      socket,
      buffer: "",
      remoteAddr: socket.remoteAddress ?? undefined,
      lastSeenTs: Date.now(),
      deviceIds: new Set(),
      rawLogged: 0,
      handshakeTimer: null,
    };
    this.conns.add(conn);
    log.info(`client connected from ${conn.remoteAddr ?? "?"}`);
    socket.on("data", (chunk) => this.onData(conn, chunk));
    socket.on("error", () => this.dropConn(conn));
    socket.on("close", () => this.dropConn(conn));
    // Protocol handshake. The satellite client gates registration on our
    // advertised ApiVersion (see bitfocus/companion-satellite client.ts):
    //   • < 1.7.0 (MINIMUM_PROTOCOL_VERSION) → "unsupported": it closes the
    //     socket silently and never registers.
    //   • >= 1.10.0 → it DEFERS its internal "connected" event until it
    //     receives a CAPS line, and only THEN does it (re)send ADD-DEVICE
    //     for each surface.
    // We advertise 1.10.0 and IMMEDIATELY follow with CAPS — the modern
    // handshake. The earlier "1.9.0, no CAPS" relied on the client's legacy
    // "complete immediately" branch (taken only for ApiVersion < 1.10.0);
    // recent clients (incl. ScreenDeck) no longer take it, so a reconnect
    // connected, got BEGIN, then sat silent and never re-registered — the
    // deck stayed lost until a full server restart. Sending CAPS fixes the
    // re-registration on every (re)connect. We expose no optional features,
    // and an all-false CAPS still completes the client's handshake.
    this.write(conn, "BEGIN CompanionVersion=nexus ApiVersion=1.10.0\n");
    this.write(conn, "CAPS SUBSCRIPTIONS=0 NONSQUARE=0\n");
    log.info(`→ sent BEGIN 1.10.0 + CAPS to ${conn.remoteAddr ?? "?"}`);
    // Arm the handshake watchdog: if this client doesn't register a surface
    // shortly, it's the dormant-reconnect quirk → auto-recover.
    conn.handshakeTimer = setTimeout(
      () => this.onHandshakeTimeout(conn),
      HANDSHAKE_GRACE_MS
    );
    conn.handshakeTimer.unref?.();
  }

  /** Watchdog: a connection that registered nothing in the grace window is
   *  the dormant client. If NO surface is registered anywhere, bounce the
   *  listener to force a clean reconnect (capped). Never fires when a deck
   *  is already up, so a working surface is never disrupted. */
  private onHandshakeTimeout(conn: Conn): void {
    conn.handshakeTimer = null;
    if (!this.conns.has(conn)) return; // already gone
    if (conn.deviceIds.size > 0) return; // this client registered fine
    if (this.devices.size > 0) return; // another deck is live — leave it be
    if (this.bounceCount >= MAX_BOUNCES) return; // gave up; manual restart
    this.bounceCount++;
    this.bounce();
  }

  private dropConn(conn: Conn): void {
    if (!this.conns.has(conn)) return;
    this.conns.delete(conn);
    if (conn.handshakeTimer) {
      clearTimeout(conn.handshakeTimer);
      conn.handshakeTimer = null;
    }
    try {
      conn.socket.destroy();
    } catch {
      /* ignore */
    }
    let removed = false;
    for (const id of conn.deviceIds) {
      // Only drop the device if it's STILL owned by THIS connection. On a
      // fast client reconnect the new socket can re-register the same
      // deviceId before the old socket's close fires; without this guard the
      // late close would delete the freshly re-registered surface — the deck
      // would vanish until a full server restart. (Matches the reported bug.)
      const entry = this.devices.get(id);
      if (entry && entry.conn === conn) {
        this.devices.delete(id);
        removed = true;
      }
    }
    conn.deviceIds.clear();
    if (removed) {
      log.info(
        `client ${conn.remoteAddr ?? "?"} disconnected — surface(s) removed (${this.devices.size} active)`
      );
      this.emitChange();
    } else {
      log.debug(`client ${conn.remoteAddr ?? "?"} disconnected`);
    }
  }

  private write(conn: Conn, line: string): void {
    try {
      conn.socket.write(line);
    } catch {
      this.dropConn(conn);
    }
  }

  private onData(conn: Conn, chunk: Buffer): void {
    conn.lastSeenTs = Date.now();
    // Diagnostic: dump the first few raw inbound chunks verbatim (incl.
    // PINGs and any non-newline-terminated data) so we can see EXACTLY what
    // the client sends right after connecting — the decisive question is
    // whether a reconnecting client sends ADD-DEVICE at all.
    if (conn.rawLogged < 6) {
      conn.rawLogged++;
      // Debug-only (opt-in via NEXUS_LOG_DEBUG): raw inbound chunks for
      // diagnosing handshake issues without flooding the normal log.
      log.debug(
        `raw ← ${JSON.stringify(chunk.toString("utf8")).slice(0, 400)} from ${conn.remoteAddr ?? "?"}`
      );
    }
    conn.buffer += chunk.toString("utf8");
    let nl: number;
    // Guard against an abusive client flooding without newlines.
    if (conn.buffer.length > 1_000_000) conn.buffer = "";
    while ((nl = conn.buffer.indexOf("\n")) >= 0) {
      const line = conn.buffer.slice(0, nl).replace(/\r$/, "");
      conn.buffer = conn.buffer.slice(nl + 1);
      if (line.trim()) this.handleLine(conn, line);
    }
  }

  private handleLine(conn: Conn, line: string): void {
    const { cmd, args } = parseLine(line);
    // Trace inbound commands at a visible level (skip only the high-rate
    // PING/PONG keepalive chatter). KEY-PRESS is logged so a "presses don't
    // trigger anything" report shows the exact line the client sends.
    if (cmd !== "PING" && cmd !== "PONG") {
      log.info(`← ${line} from ${conn.remoteAddr ?? "?"}`);
    }
    switch (cmd) {
      case "ADD-DEVICE":
        this.handleAddDevice(conn, args);
        break;
      case "REMOVE-DEVICE": {
        const id = args.DEVICEID;
        if (id && this.devices.delete(id)) {
          conn.deviceIds.delete(id);
          this.write(conn, `REMOVE-DEVICE OK DEVICEID=${id}\n`);
          this.emitChange();
        }
        break;
      }
      case "KEY-PRESS":
        this.handleKeyPress(args);
        break;
      case "PING": {
        // Echo the payload back as PONG (everything after the command).
        // The client pings frequently and destroys the link if its pings
        // go unacked, so this MUST round-trip.
        const payload = line.slice("PING".length).trim();
        this.write(conn, payload ? `PONG ${payload}\n` : "PONG\n");
        break;
      }
      case "PONG":
        break; // reply to our keepalive — lastSeenTs already bumped
      case "QUIT":
        this.dropConn(conn);
        break;
      default:
        break; // unknown / CAPS / future commands — ignore gracefully
    }
  }

  private handleAddDevice(conn: Conn, args: Record<string, string>): void {
    const deviceId = args.DEVICEID;
    if (!deviceId) return;
    const total = Math.max(1, Number(args.KEYS_TOTAL) || 0);
    const perRow = Math.max(1, Number(args.KEYS_PER_ROW) || 0);
    const cols = perRow;
    const rows = Math.max(1, Math.ceil(total / perRow));
    const bmp = Number(args.BITMAPS);
    const bitmapSize = Number.isFinite(bmp) && bmp > 0 ? bmp : 0;
    const dev: ScreendeckDevice = {
      deviceId,
      productName: args.PRODUCT_NAME || "ScreenDeck",
      rows,
      cols,
      bitmapSize,
      remoteAddr: conn.remoteAddr,
    };
    this.devices.set(deviceId, { dev, conn });
    conn.deviceIds.add(deviceId);
    // Registered → healthy: cancel this conn's watchdog and reset the bounce
    // budget for any future stuck episode.
    if (conn.handshakeTimer) {
      clearTimeout(conn.handshakeTimer);
      conn.handshakeTimer = null;
    }
    this.bounceCount = 0;
    this.write(conn, `ADD-DEVICE OK DEVICEID=${deviceId}\n`);
    log.info(
      `surface registered: "${dev.productName}" ${cols}x${rows} ` +
        `id=${deviceId} from ${conn.remoteAddr ?? "?"} (${this.devices.size} active)`
    );
    this.emitChange();
  }

  private handleKeyPress(args: Record<string, string>): void {
    const deviceId = args.DEVICEID;
    const entry = deviceId ? this.devices.get(deviceId) : undefined;
    // KEY arrives as "row/col" (satellite manifest protocol) — convert to a
    // flat index using THIS device's column count.
    const key = entry ? coordToKey(args.KEY, entry.dev.cols) : NaN;
    if (!deviceId || !entry || !Number.isFinite(key)) {
      log.warn(
        `KEY-PRESS dropped: id=${deviceId ?? "?"} ` +
          `known=${!!entry} key=${args.KEY ?? "?"}`
      );
      return;
    }
    const type = args.PRESSED === "true" || args.PRESSED === "1" ? "down" : "up";
    if (type === "down") {
      // Visible so a "presses do nothing" report shows the press reached us
      // and how many bridges (driver) it was dispatched to. 0 listeners =
      // the driver press bridge isn't wired; >0 = look downstream
      // (press-dispatcher: layout pairing / binding / key remap).
      log.info(
        `key-down ${deviceId}#${key} → ${this.pressListeners.size} listener(s)`
      );
    }
    for (const cb of this.pressListeners) {
      try {
        cb({ serial: deviceId, keyIndex: key, type });
      } catch {
        /* ignore */
      }
    }
  }

  private keepalive(): void {
    const now = Date.now();
    for (const conn of [...this.conns]) {
      if (now - conn.lastSeenTs > STALE_MS) {
        this.dropConn(conn);
        continue;
      }
      this.write(conn, "PING nexus\n");
    }
  }

  /** Close the listener + all connections, then rebind after a short gap so
   *  reconnecting clients hit a real connection-refused, forcing them to
   *  redo a full handshake (and re-register their surfaces). */
  private bounce(): void {
    const port = this.desiredPort;
    log.warn(
      `recovery: ${this.conns.size} client(s) connected but 0 surface registered — ` +
        `bouncing listener (attempt ${this.bounceCount}/${MAX_BOUNCES}) to force a clean reconnect`
    );
    this.stop();
    if (port === null) return;
    this.rebindTimer = setTimeout(() => {
      this.rebindTimer = null;
      if (this.desiredPort === port && !this.server) this.start(port);
    }, BOUNCE_GAP_MS);
    this.rebindTimer.unref?.();
  }
}

/**
 * Parse a protocol line into a command + arg map. Values may be bare
 * (`KEY=0`) or double-quoted with spaces (`PRODUCT_NAME="Stream Deck"`).
 */
/**
 * The satellite protocol references a key as `row/col` (e.g. "0/0", "1/3")
 * since the surface-manifest era — which is what ScreenDeck sends/expects.
 * Our driver works in FLAT key indices, so convert at the protocol edge.
 */
function keyToCoord(keyIndex: number, cols: number): string {
  const c = cols > 0 ? cols : 1;
  return `${Math.floor(keyIndex / c)}/${keyIndex % c}`;
}

/** Parse a protocol KEY value ("row/col" or a legacy flat index) to a flat
 *  index using the device's column count. Returns NaN if unparseable. */
function coordToKey(raw: string | undefined, cols: number): number {
  if (!raw) return NaN;
  if (raw.includes("/")) {
    const [r, c] = raw.split("/");
    const rn = Number(r);
    const cn = Number(c);
    if (!Number.isFinite(rn) || !Number.isFinite(cn)) return NaN;
    return rn * (cols > 0 ? cols : 1) + cn;
  }
  return Number(raw);
}

function parseLine(line: string): { cmd: string; args: Record<string, string> } {
  const args: Record<string, string> = {};
  // First token = command; remainder = KEY=VALUE pairs.
  const sp = line.indexOf(" ");
  if (sp < 0) return { cmd: line.trim(), args };
  const cmd = line.slice(0, sp);
  const rest = line.slice(sp + 1);
  const re = /([A-Za-z0-9_]+)=("(?:[^"\\]|\\.)*"|[^\s]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    args[m[1]] = val;
  }
  return { cmd, args };
}

export const screendeckServer = hmrSingleton(
  "streamdeck-screendeck-server",
  ScreendeckServerImpl
);
