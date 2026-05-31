/**
 * Agent orchestration: owns the HID manager + the server uplink and
 * exposes a single status snapshot the Electron UI renders. Lets the
 * window start/stop/reconfigure the satellite without touching the
 * transport internals.
 *
 * Hard rule: Nexus Cross must NEVER run alongside a Nexus server on the
 * same machine — the server owns the local Stream Deck, and two openers
 * fight over the device. A background probe watches this box's own
 * addresses for a live Nexus server; the moment one appears the agent
 * blocks itself (drops the uplink, releases the deck) and the window
 * tells the operator to close Cross. When the local server goes away the
 * agent resumes on its own.
 */

import { EventEmitter } from "node:events";
import { fetch } from "undici";
import { HidManager } from "./hid";
import { ServerClient } from "./server-client";
import { localAddresses, toSatelliteConfig, type CrossSettings } from "./prefs";

export interface AgentStatus {
  running: boolean;
  serverUrl: string;
  connected: boolean;
  lastError?: string;
  devices: Array<{ serial: string; model: string; rows: number; cols: number }>;
  /** Decks seen but not openable (claimed by another app on this PC). */
  blocked: number;
  /** A Nexus server is running on THIS machine, so the agent is blocked:
   *  the bridge is torn down and the deck released. The window locks all
   *  controls and tells the operator to close Cross. */
  localServer: boolean;
  /** This satellite's friendly label (shown next to each deck so the
   *  operator can tell which machine a deck lives on). */
  label: string;
}

/** How often the background watcher re-probes for a local Nexus server. */
const PROBE_INTERVAL_MS = 3_000;
/** Per-address probe budget — loopback answers/refuses in <50ms; a short
 *  budget keeps a dead/virtual adapter from adding latency before the
 *  uplink starts (the probe runs before the SSE connect at start()). */
const PROBE_TIMEOUT_MS = 800;
/** The launcher's default port; always probed even if no URL is set. */
const DEFAULT_NEXUS_PORT = 9088;

export class Agent extends EventEmitter {
  private hid: HidManager | null = null;
  private uplink: ServerClient | null = null;
  private label = "";
  private lastSettings: CrossSettings | null = null;
  // True while a local Nexus server is detected. Latches the transport
  // callbacks off so a torn-down uplink/HID is never touched mid-block.
  private blockedByLocal = false;
  /** Bumped by every stop()/block(). A start() captures it after its
   *  initial stop() and re-checks after each await; if it changed, a newer
   *  start/stop/block superseded this run and it bails — preventing two
   *  concurrent starts from both opening the deck or leaking an uplink. */
  private startGen = 0;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private status: AgentStatus = {
    running: false,
    serverUrl: "",
    connected: false,
    devices: [],
    blocked: 0,
    localServer: false,
    label: "",
  };

  getStatus(): AgentStatus {
    return this.status;
  }

  private publish(patch: Partial<AgentStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.status);
  }

  private refreshDevices(): void {
    const devices =
      this.hid?.list().map((d) => ({
        serial: d.serial,
        model: d.model,
        rows: d.rows,
        cols: d.cols,
      })) ?? [];
    this.publish({
      devices,
      blocked: this.hid?.blockedCount() ?? 0,
      label: this.label,
    });
  }

  // ── Local-server detection ───────────────────────────────────────

  /** GET the Nexus-specific satellites endpoint; a 200 with a
   *  `satellites` field means a real Nexus server answered here. */
  private async pingNexus(origin: string): Promise<boolean> {
    try {
      const res = await fetch(`${origin}/api/streamdeck/satellites`, {
        method: "GET",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => null)) as unknown;
      return (
        !!data && typeof data === "object" && "satellites" in (data as object)
      );
    } catch {
      return false;
    }
  }

  /** True if a Nexus server answers on any of this machine's own
   *  addresses — loopback and each interface IP, on the default port and
   *  whatever port the operator configured. */
  private async probeLocalServer(): Promise<boolean> {
    const ports = new Set<number>([DEFAULT_NEXUS_PORT]);
    const cfgPort = portOf(this.lastSettings?.serverUrl);
    if (cfgPort) ports.add(cfgPort);

    const origins: string[] = [];
    for (const addr of localAddresses()) {
      for (const p of ports) origins.push(`http://${addr}:${p}`);
    }
    const hits = await Promise.all(origins.map((o) => this.pingNexus(o)));
    return hits.some(Boolean);
  }

  /** Start the background watcher (idempotent). Reacts to a local Nexus
   *  server appearing (block) or disappearing (resume). */
  watchLocalServer(): void {
    if (this.watchTimer) return;
    const tick = async (): Promise<void> => {
      let detected: boolean;
      try {
        detected = await this.probeLocalServer();
      } catch {
        return; // transient — try again next tick
      }
      if (detected === this.blockedByLocal) return; // no change
      if (detected) {
        await this.block();
      } else {
        // The local server went away — resume normal operation.
        this.blockedByLocal = false;
        if (this.lastSettings) void this.start(this.lastSettings);
        else this.publish({ localServer: false });
      }
    };
    void tick();
    this.watchTimer = setInterval(() => void tick(), PROBE_INTERVAL_MS);
  }

  /** Tear the bridge down and release the deck so the local Nexus app
   *  keeps sole ownership. We do NOT reconnect — the watcher will resume
   *  us automatically once the local server stops. */
  private async block(): Promise<void> {
    this.startGen++; // supersede any in-flight start()
    this.blockedByLocal = true;
    this.uplink?.stop();
    this.uplink = null;
    const hid = this.hid;
    this.hid = null;
    // AWAIT the release — the whole point of block is to free the deck so
    // the local Nexus server can claim it; returning before the handle is
    // actually closed leaves a window where both contend for the device.
    await hid?.dispose();
    this.publish({
      running: false,
      connected: false,
      localServer: true,
      devices: [],
      blocked: 0,
      lastError: "Blocked: a Nexus server is running on this PC",
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /** (Re)start the agent with the given settings. Tears down any
   *  previous run first so a settings change reconnects cleanly.
   *
   *  HID enumeration is INDEPENDENT of the uplink: we open + watch the
   *  local Stream Decks even when no server URL is set, so the window
   *  shows "1 deck found" before you connect. The network uplink is only
   *  created once a server URL exists. */
  async start(settings: CrossSettings): Promise<void> {
    await this.stop();
    // Claim this run AFTER the teardown's bump; if a newer start/stop/block
    // happens during any await below, `gen` diverges and we bail.
    const gen = this.startGen;
    this.lastSettings = settings;
    const cfg = toSatelliteConfig(settings);
    this.label = cfg.label;

    // Hard rule: never touch the deck or connect while a Nexus server
    // runs on THIS machine. Block instead — don't even open HID, so we
    // never fight the local Nexus app for the device.
    if (await this.probeLocalServer()) {
      await this.block();
      return;
    }
    if (gen !== this.startGen) return; // superseded during the probe

    // Past the block decision → this run owns the deck and is NOT blocked.
    // Clear the latch so the transport callbacks below aren't short-circuited
    // (a manual restart after a block would otherwise stay silently dead).
    this.blockedByLocal = false;

    // Always bring up HID — it has nothing to do with the server.
    const hid = new HidManager();
    this.hid = hid;

    if (!cfg.serverUrl) {
      // HID-only mode: detect local decks but stay disconnected.
      this.publish({
        running: false,
        serverUrl: "",
        connected: false,
        localServer: false,
        lastError: "No server URL set",
      });
      hid.onDeviceChange(() => this.refreshDevices());
      await hid.refresh();
      if (gen !== this.startGen) {
        void hid.dispose();
        return;
      }
      hid.watchHotplug();
      this.refreshDevices();
      return;
    }

    const uplink = new ServerClient(cfg);
    this.uplink = uplink;
    this.publish({
      running: true,
      serverUrl: cfg.serverUrl,
      connected: false,
      localServer: false,
      lastError: undefined,
    });

    hid.onKey((e) => {
      if (this.blockedByLocal) return;
      uplink.sendPress(e.serial, e.keyIndex, e.type);
    });
    hid.onDeviceChange(() => {
      if (this.blockedByLocal) return;
      this.refreshDevices();
      void uplink.announce(hid.list());
    });
    uplink.onState((s) => {
      if (this.blockedByLocal) return;
      this.publish({ connected: s.connected, lastError: s.error });
      // Re-announce on EVERY (re)connection. A satellite launched before
      // the server (auto-connect) fails its boot-time announce while the
      // server is down; without this it would only re-register if/when the
      // server's `hello` arrives. Announcing the moment the link comes up
      // makes the decks appear without a manual Save & connect.
      if (s.connected) void uplink.announce(hid.list());
    });

    uplink.subscribe((msg) => {
      switch (msg.type) {
        case "render":
          hid.renderKey(msg.serial, msg.keyIndex, msg.binding, msg.override);
          break;
        case "clear":
          void hid.clearKey(msg.serial, msg.keyIndex);
          break;
        case "clear-panel":
          void hid.clearPanel(msg.serial);
          break;
        case "brightness":
          void hid.setBrightness(msg.serial, msg.percent);
          break;
        case "hello":
          void uplink.announce(hid.list());
          break;
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    });

    await hid.refresh();
    if (gen !== this.startGen) {
      // A newer start/stop/block superseded us during enumeration — tear
      // down THIS run's hid (the newer run owns this.hid/uplink) and bail
      // so we don't announce on a stale uplink or double-open the deck.
      void hid.dispose();
      return;
    }
    hid.watchHotplug();
    this.refreshDevices();
    // Best-effort — never block start() (and therefore the IPC caller /
    // boot) on a network round-trip. announce() has its own timeout and
    // the SSE `hello` re-announces anyway.
    void uplink.announce(hid.list());
  }

  async stop(): Promise<void> {
    this.startGen++; // supersede any in-flight start()
    this.uplink?.stop();
    this.uplink = null;
    if (this.hid) {
      await this.hid.dispose();
      this.hid = null;
    }
    this.publish({
      running: false,
      connected: false,
      devices: [],
      blocked: 0,
      localServer: this.blockedByLocal,
      label: this.label,
    });
  }
}

/** Port from a base URL, or null when absent/unparseable. */
function portOf(url: string | undefined): number | null {
  if (!url) return null;
  try {
    const p = new URL(url).port;
    return p ? parseInt(p, 10) : null;
  } catch {
    return null;
  }
}
