/**
 * Agent orchestration: owns the HID manager + the server uplink and
 * exposes a single status snapshot the Electron UI renders. Lets the
 * window start/stop/reconfigure the satellite without touching the
 * transport internals.
 */

import { EventEmitter } from "node:events";
import { HidManager } from "./hid";
import { ServerClient } from "./server-client";
import { toSatelliteConfig, type CrossSettings } from "./prefs";

export interface AgentStatus {
  running: boolean;
  serverUrl: string;
  connected: boolean;
  lastError?: string;
  devices: Array<{ serial: string; model: string; rows: number; cols: number }>;
  /** Decks seen but not openable (claimed by another app on this PC). */
  blocked: number;
  /** This satellite's friendly label (shown next to each deck so the
   *  operator can tell which machine a deck lives on). */
  label: string;
}

export class Agent extends EventEmitter {
  private hid: HidManager | null = null;
  private uplink: ServerClient | null = null;
  private label = "";
  private status: AgentStatus = {
    running: false,
    serverUrl: "",
    connected: false,
    devices: [],
    blocked: 0,
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

  /** (Re)start the agent with the given settings. Tears down any
   *  previous run first so a settings change reconnects cleanly.
   *
   *  HID enumeration is INDEPENDENT of the uplink: we open + watch the
   *  local Stream Decks even when no server URL is set, so the window
   *  shows "1 deck found" before you connect (previously it said "no
   *  deck" until a server was saved, which was confusing). The network
   *  uplink is only created once a server URL exists. */
  async start(settings: CrossSettings): Promise<void> {
    await this.stop();
    const cfg = toSatelliteConfig(settings);

    // Always bring up HID — it has nothing to do with the server.
    const hid = new HidManager();
    this.hid = hid;
    this.label = cfg.label;

    if (!cfg.serverUrl) {
      // HID-only mode: detect local decks but stay disconnected.
      this.publish({
        running: false,
        serverUrl: "",
        connected: false,
        lastError: "No server URL set",
      });
      hid.onDeviceChange(() => this.refreshDevices());
      await hid.refresh();
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
      lastError: undefined,
    });

    hid.onKey((e) => uplink.sendPress(e.serial, e.keyIndex, e.type));
    hid.onDeviceChange(() => {
      this.refreshDevices();
      void uplink.announce(hid.list());
    });
    uplink.onState((s) =>
      this.publish({ connected: s.connected, lastError: s.error })
    );

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
    hid.watchHotplug();
    this.refreshDevices();
    // Best-effort — never block start() (and therefore the IPC caller /
    // boot) on a network round-trip. announce() has its own timeout and
    // the SSE `hello` re-announces anyway.
    void uplink.announce(hid.list());
  }

  async stop(): Promise<void> {
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
      label: this.label,
    });
  }
}
