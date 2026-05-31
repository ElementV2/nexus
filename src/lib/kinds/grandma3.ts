import { Lightbulb } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
import { makeBrokerAdapter } from "@/lib/core/broker-adapter";
import { GrandMA3Broker } from "@/lib/grandma3/osc-broker";
import { grandma3Actions } from "./grandma3-actions";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
  PresetDefinition,
  VariableDefinition,
} from "@/lib/core/types";

/**
 * grandMA3 lighting console kind. Per-instance broker (no singleton)
 * — sane for big shows that bridge two consoles for redundancy.
 */

interface MAConfig {
  host: string;
  port: number;
  /** Optional OSC prefix configured on the console (e.g. "gma3"). Empty
   *  = no prefix. Prepended to every outgoing OSC address by the broker. */
  prefix: string;
}

function parseMAConfig(
  raw: unknown
): { ok: true; config: MAConfig } | { ok: false; error: string } {
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
  const prefix = typeof r.prefix === "string" ? r.prefix.trim() : "";
  return { ok: true, config: { host, port, prefix } };
}

const grandma3Variables: VariableDefinition[] = [
  { id: "connected", label: "Connected", hint: "boolean" },
];

registerBridge("grandma3", (connectionId, broker) =>
  broker.subscribe((event) => {
    if (event.type !== "status") return;
    const ev = event as KindEvent & { connected?: boolean };
    variableBus.set(connectionId, "connected", Boolean(ev.connected));
  })
);

const grandma3Presets: PresetDefinition[] = [
  // Executor go-buttons for page 1, exec 1..8 — covers a typical
  // first-page show layout.
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (n): PresetDefinition => ({
      id: `seq-${n}-go`,
      label: `Sequence ${n} Go+`,
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

  // ── Cue navigation ─────────────────────────────────────────────────
  {
    id: "cue-first",
    label: "Cue · First",
    category: "Cues",
    text: "CUE ⏮",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "cue-first", options: { sequence: 1 } }],
  },
  {
    id: "cue-last",
    label: "Cue · Last",
    category: "Cues",
    text: "CUE ⏭",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "cue-last", options: { sequence: 1 } }],
  },
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

  // ── Programmer ─────────────────────────────────────────────────────
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
    id: "programmer-off",
    label: "Programmer · Off",
    category: "Programmer",
    text: "OFF\nPRG",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "programmer-off" }],
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
  {
    id: "programmer-store",
    label: "Programmer · Store cue",
    category: "Programmer",
    text: "STORE",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "programmer-store", options: { sequence: 1, cue: 1 } }],
  },
  {
    id: "programmer-update",
    label: "Programmer · Update",
    category: "Programmer",
    text: "UPDATE",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "programmer-update" }],
  },

  // ── Selection ──────────────────────────────────────────────────────
  {
    id: "select-fixture",
    label: "Select fixture",
    category: "Selection",
    text: "FIX\nSEL",
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
  {
    id: "selection-next",
    label: "Selection next",
    category: "Selection",
    text: "SEL →",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "selection-next" }],
  },
  {
    id: "selection-prev",
    label: "Selection prev",
    category: "Selection",
    text: "SEL ←",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "selection-prev" }],
  },

  // ── Effects ────────────────────────────────────────────────────────
  {
    id: "effect-call",
    label: "Effect · Call",
    category: "Effects",
    text: "FX",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "effect-call", options: { effect: 1 } }],
  },
  {
    id: "effect-off",
    label: "Effect · Off",
    category: "Effects",
    text: "FX OFF",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "effect-off", options: { effect: 1 } }],
  },
  {
    id: "effect-stomp",
    label: "Effect · Stomp all",
    category: "Effects",
    text: "STOMP",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "effect-stomp" }],
  },

  // ── Views & save ───────────────────────────────────────────────────
  {
    id: "view-load",
    label: "View · Load",
    category: "Views",
    text: "VIEW",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-load", options: { view: 1 } }],
  },
  {
    id: "view-next",
    label: "View · Next",
    category: "Views",
    text: "VIEW →",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-next" }],
  },
  {
    id: "view-prev",
    label: "View · Previous",
    category: "Views",
    text: "VIEW ←",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-prev" }],
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

const grandma3Kind: DeviceKind = {
  kind: "grandma3",
  displayName: "grandMA3",
  icon: Lightbulb,
  tagline: "OSC over UDP (CommandLine + faders)",
  parseConfig: parseMAConfig,
  defaultConfig: (): MAConfig => ({ host: "192.168.1.50", port: 9000, prefix: "" }),
  pages: [{ href: "/grandma3", label: "MA3", icon: Lightbulb }],
  actions: grandma3Actions,
  variables: grandma3Variables,
  presets: grandma3Presets,
  make({ config }): BrokerImpl {
    const parsed = parseMAConfig(config);
    if (!parsed.ok) {
      throw new Error(`grandMA3 config invalid: ${parsed.error}`);
    }
    return makeBrokerAdapter(
      new GrandMA3Broker(parsed.config),
      parseMAConfig,
      "grandma3"
    );
  },
};

registerDeviceKind(grandma3Kind);
