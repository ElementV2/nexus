import { Lightbulb } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
import { makeBrokerAdapter } from "@/lib/core/broker-adapter";
// Re-use the MA3 broker — the wire protocol is identical, only the
// command-line *syntax* differs (and that's emitted by the action
// catalog, not the broker).
import { GrandMA3Broker } from "@/lib/grandma3/osc-broker";
import { grandma2Actions } from "./grandma2-actions";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
  PresetDefinition,
  VariableDefinition,
} from "@/lib/core/types";

/**
 * grandMA 2 kind. Mirrors the MA3 kind's structure — same UDP-OSC
 * broker, separate action catalog with MA2-flavoured command strings
 * (e.g. `Go Sequence N` instead of `Go+ Sequence N`).
 *
 * Default OSC port is 8000 (vs 9000 for MA3) per the typical onPC /
 * console configurations.
 */

interface MA2Config {
  host: string;
  port: number;
}

function parseMA2Config(
  raw: unknown
): { ok: true; config: MA2Config } | { ok: false; error: string } {
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


const grandma2Variables: VariableDefinition[] = [
  { id: "connected", label: "Connected", hint: "boolean" },
];

registerBridge("grandma2", (connectionId, broker) =>
  broker.subscribe((event) => {
    if (event.type !== "status") return;
    const ev = event as KindEvent & { connected?: boolean };
    variableBus.set(connectionId, "connected", Boolean(ev.connected));
  })
);

const grandma2Presets: PresetDefinition[] = [
  // Sequences 1-8 — Go (not Go+).
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (n): PresetDefinition => ({
      id: `seq-${n}-go`,
      label: `Sequence ${n} Go`,
      category: "Sequences",
      text: `▶ ${n}`,
      bgcolor: "#34c759",
      fgcolor: "#000000",
      steps: [{ actionId: "seq-go", options: { sequence: n } }],
    })
  ),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (n): PresetDefinition => ({
      id: `seq-${n}-off`,
      label: `Sequence ${n} off`,
      category: "Sequences",
      text: `OFF ${n}`,
      bgcolor: "#1c1c1e",
      fgcolor: "#ff3b30",
      steps: [{ actionId: "seq-off", options: { sequence: n } }],
    })
  ),
  // Cue navigation
  {
    id: "cue-next",
    label: "Cue · Next",
    category: "Cues",
    text: "CUE →",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "cue-next", options: { sequence: 1 } }],
  },
  {
    id: "cue-prev",
    label: "Cue · Previous",
    category: "Cues",
    text: "CUE ←",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "cue-prev", options: { sequence: 1 } }],
  },
  // Pages
  {
    id: "page-next",
    label: "Page +",
    category: "Pages",
    text: "PG +",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "page-next" }],
  },
  {
    id: "page-prev",
    label: "Page −",
    category: "Pages",
    text: "PG −",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "page-prev" }],
  },
  // Selection
  {
    id: "select-fixture",
    label: "Select fixture",
    category: "Selection",
    text: "FIX",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "select-fixture", options: { fixture: 1 } }],
  },
  {
    id: "select-group",
    label: "Select group",
    category: "Selection",
    text: "GRP",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "select-group", options: { group: 1 } }],
  },
  {
    id: "selection-clear",
    label: "Clear selection",
    category: "Selection",
    text: "CLR\nSEL",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "selection-clear" }],
  },
  // Programmer
  {
    id: "programmer-clear",
    label: "Programmer · Clear",
    category: "Programmer",
    text: "CLEAR",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "programmer-clear" }],
  },
  {
    id: "programmer-highlight",
    label: "Programmer · Highlight",
    category: "Programmer",
    text: "HILT",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "programmer-highlight" }],
  },
  // Macros
  {
    id: "macro-go",
    label: "Run macro",
    category: "Macros",
    text: "MACRO",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "macro-go", options: { macro: 1 } }],
  },
  // Globals
  {
    id: "blackout",
    label: "Blackout",
    category: "Global",
    text: "BLACK\nOUT",
    bgcolor: "#000000",
    fgcolor: "#ffffff",
    steps: [{ actionId: "blackout" }],
  },
  {
    id: "full",
    label: "Grandmaster 100%",
    category: "Global",
    text: "FULL",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "full" }],
  },
  {
    id: "off-all",
    label: "Off everything",
    category: "Global",
    text: "OFF\nTHRU",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "off-all" }],
  },
  {
    id: "save-show",
    label: "Save show",
    category: "Global",
    text: "SAVE",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "save-show" }],
  },
];

const grandma2Kind: DeviceKind = {
  kind: "grandma2",
  displayName: "grandMA 2",
  icon: Lightbulb,
  tagline: "OSC over UDP (CommandLine + faders, MA2 syntax)",
  parseConfig: parseMA2Config,
  defaultConfig: (): MA2Config => ({ host: "192.168.1.50", port: 8000 }),
  pages: [{ href: "/grandma2", label: "MA2", icon: Lightbulb }],
  actions: grandma2Actions,
  variables: grandma2Variables,
  presets: grandma2Presets,
  make({ config }): BrokerImpl {
    const parsed = parseMA2Config(config);
    if (!parsed.ok) {
      throw new Error(`grandMA 2 config invalid: ${parsed.error}`);
    }
    return makeBrokerAdapter(
      new GrandMA3Broker(parsed.config),
      parseMA2Config,
      "grandma2"
    );
  },
};

registerDeviceKind(grandma2Kind);
