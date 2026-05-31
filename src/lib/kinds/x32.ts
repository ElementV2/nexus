import { Sliders } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
import { makeBrokerAdapter } from "@/lib/core/broker-adapter";
import { X32Broker } from "@/lib/x32/osc-broker";
import { x32Actions } from "./x32-actions";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
  PresetDefinition,
  VariableDefinition,
} from "@/lib/core/types";

/**
 * Behringer X32 / M32 kind. Ships true per-instance brokers — each X32
 * connection constructs its own `X32Broker` (one socket + state),
 * wrapped through the shared `makeBrokerAdapter`.
 */

interface X32Config {
  host: string;
  port: number;
}

function parseX32Config(
  raw: unknown
): { ok: true; config: X32Config } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const host = typeof r.host === "string" ? r.host.trim() : "";
  if (!host) return { ok: false, error: "host is required" };
  const port = typeof r.port === "number" ? r.port : Number(r.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { ok: false, error: "port must be 1-65535" };
  }
  return { ok: true, config: { host, port } };
}

// ─────────────────────────── Variables ────────────────────────────────

const x32Variables: VariableDefinition[] = [
  { id: "connected", label: "Connected", hint: "boolean" },
  { id: "version", label: "X32 firmware version", hint: "string" },
  { id: "model", label: "Console model", hint: "string" },
  { id: "name", label: "Console name", hint: "string" },
];

// Bridge published values from the broker's events: "status" for the
// connection info, and "osc" for live mute states (so the deck can show
// mute feedback). The broker seeds + refreshes mute states via /xremote
// + state queries (see x32/osc-broker).
registerBridge("x32", (connectionId, broker) => {
  return broker.subscribe((event) => {
    if (event.type === "status") {
      const ev = event as KindEvent & {
        connected?: boolean;
        info?: { version?: string; model?: string; name?: string };
      };
      variableBus.setBatch(connectionId, {
        connected: Boolean(ev.connected),
        version: ev.info?.version ?? null,
        model: ev.info?.model ?? null,
        name: ev.info?.name ?? null,
      });
      return;
    }
    if (event.type !== "osc") return;
    const ev = event as KindEvent & { address?: unknown; args?: unknown[] };
    const addr = ev.address;
    const raw = ev.args?.[0];
    if (typeof addr !== "string" || typeof raw !== "number") return;
    // X32 "on" semantics: 1 = audible, 0 = muted. Publish as `<thing>_on`
    // so a feedback can colour the key red when it's 0 (muted).
    const on = raw >= 0.5;
    let m: RegExpExecArray | null;
    if ((m = /^\/ch\/(\d+)\/mix\/on$/.exec(addr))) {
      variableBus.set(connectionId, `ch_${Number(m[1])}_on`, on);
    } else if ((m = /^\/bus\/(\d+)\/mix\/on$/.exec(addr))) {
      variableBus.set(connectionId, `bus_${Number(m[1])}_on`, on);
    } else if ((m = /^\/dca\/(\d+)\/on$/.exec(addr))) {
      variableBus.set(connectionId, `dca_${Number(m[1])}_on`, on);
    } else if (addr === "/main/st/mix/on") {
      variableBus.set(connectionId, "main_on", on);
    } else if ((m = /^\/config\/mute\/(\d+)$/.exec(addr))) {
      // Mute group: 1 = group active (muting). Keep raw semantics.
      variableBus.set(connectionId, `mutegroup_${Number(m[1])}`, on);
    }
  });
});

// ─────────────────────────── Presets ──────────────────────────────────

// Curated X32 presets. The Actions tab covers every channel/bus/DCA
// individually — presets are reserved for the operator-facing tiles
// that don't need configuration on drop: mute groups, main mute,
// USB recorder, cue nav, talkback. Per-channel mutes are skipped
// here on purpose; drag the `ch-mute-toggle` action from the Actions
// tab and set the channel number on the key inspector.
const x32Presets: PresetDefinition[] = [
  // Mute groups 1-6 — one-touch operator buttons, no args.
  ...[1, 2, 3, 4, 5, 6].map(
    (n): PresetDefinition => ({
      id: `mute-group-${n}`,
      label: `Mute group ${n}`,
      category: "Mute groups",
      text: `MG${n}`,
      bgcolor: "#5856d6",
      fgcolor: "#ffffff",
      steps: [
        { actionId: "mute-group-set", options: { group: n, active: true } },
      ],
    })
  ),

  // Main + USB
  {
    // Distinct id from the `main-mute` action so the action stays
    // reachable as its own auto-tile (this preset wraps the toggle).
    id: "main-mute-toggle",
    label: "Main LR mute (toggle)",
    category: "Main",
    text: "MAIN\nMUTE",
    // Neutral base so the live mute feedback (red when muted) reads
    // clearly — base red/green are reserved for feedback.
    bgcolor: "#2c2c2e",
    fgcolor: "#ffffff",
    steps: [{ actionId: "main-mute-toggle" }],
  },
  {
    id: "usb-rec",
    label: "USB record",
    category: "USB recorder",
    text: "USB REC",
    bgcolor: "#8e44ad",
    fgcolor: "#ffffff",
    steps: [{ actionId: "usb-rec" }],
  },
  {
    id: "usb-stop",
    label: "USB stop",
    category: "USB recorder",
    text: "USB STOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "usb-stop" }],
  },
  {
    id: "next-cue",
    label: "Next cue",
    category: "Scenes",
    text: "CUE →",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "next-cue" }],
  },
  {
    id: "prev-cue",
    label: "Previous cue",
    category: "Scenes",
    text: "← CUE",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "prev-cue" }],
  },
  {
    id: "talkback-a",
    label: "Talkback A",
    category: "Talkback",
    text: "TLK A",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "talkback-a" }],
  },

  // ── Channel processing toggles (configure channel in inspector) ──
  {
    id: "ch-eq-toggle",
    label: "Channel · Low-cut toggle",
    category: "Channel processing",
    text: "LC\nTOG",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "ch-eq-toggle", options: { channel: 1 } }],
  },
  {
    id: "ch-gate-toggle",
    label: "Channel · Gate toggle",
    category: "Channel processing",
    text: "GATE",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "ch-gate-toggle", options: { channel: 1 } }],
  },
  {
    id: "ch-comp-toggle",
    label: "Channel · Compressor toggle",
    category: "Channel processing",
    text: "COMP",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "ch-dyn-toggle", options: { channel: 1 } }],
  },
  {
    id: "ch-insert-toggle",
    label: "Channel · Insert toggle",
    category: "Channel processing",
    text: "INS",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "ch-insert-toggle", options: { channel: 1 } }],
  },
  {
    id: "ch-phantom",
    label: "Channel · Phantom 48V",
    category: "Channels",
    text: "+48V",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "ch-phantom", options: { channel: 1, enabled: true } }],
  },
  {
    id: "ch-preamp-gain",
    label: "Channel · Set head amp gain",
    category: "Channels",
    text: "GAIN",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "ch-preamp-gain", options: { channel: 1, gain: 0 } }],
  },
  {
    id: "ch-select",
    label: "Channel · Select (Sel button)",
    category: "Channels",
    text: "SEL",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "select-channel", options: { channel: 1 } }],
  },
  {
    id: "clear-solo",
    label: "Solo · Clear all",
    category: "Solo",
    text: "CLEAR\nSOLO",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff9500",
    steps: [{ actionId: "clear-solo" }],
  },
  {
    id: "fx-tap",
    label: "FX · Tap tempo",
    category: "FX",
    text: "TAP",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "fx-tap", options: { slot: "1" } }],
  },
  {
    id: "scene-save",
    label: "Save current as scene",
    category: "Scenes",
    text: "SAVE\nSCENE",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      { actionId: "scene-save", options: { scene: 0, name: "" } },
    ],
  },
];

// ─────────────────────────── Kind definition ──────────────────────────

const x32Kind: DeviceKind = {
  kind: "x32",
  displayName: "Behringer X32 / M32",
  icon: Sliders,
  tagline: "OSC over UDP (port 10023)",
  parseConfig: parseX32Config,
  defaultConfig: (): X32Config => ({ host: "192.168.1.100", port: 10023 }),
  pages: [{ href: "/x32", label: "X32", icon: Sliders }],
  actions: x32Actions,
  variables: x32Variables,
  presets: x32Presets,
  make({ config }): BrokerImpl {
    const parsed = parseX32Config(config);
    if (!parsed.ok) {
      throw new Error(`X32 config invalid: ${parsed.error}`);
    }
    return makeBrokerAdapter(new X32Broker(parsed.config), parseX32Config, "x32");
  },
};

registerDeviceKind(x32Kind);
