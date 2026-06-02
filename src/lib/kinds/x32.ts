import { Sliders } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
import { makeBrokerAdapter } from "@/lib/core/broker-adapter";
import { X32Broker } from "@/lib/x32/osc-broker";
import { x32Actions } from "./x32-actions";
import { withCategoryColors } from "./category-colors";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
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

// ─────────────────────────── Kind definition ──────────────────────────

const x32Kind: DeviceKind = {
  kind: "x32",
  displayName: "Behringer X32 / M32",
  icon: Sliders,
  tagline: "OSC over UDP (port 10023)",
  parseConfig: parseX32Config,
  defaultConfig: (): X32Config => ({ host: "192.168.1.100", port: 10023 }),
  // No dedicated page — X32 is controlled from the Stream Deck editor
  // (actions / presets / feedback). Connections are managed in the
  // connections panel.
  actions: withCategoryColors(x32Actions),
  variables: x32Variables,
  make({ config }): BrokerImpl {
    const parsed = parseX32Config(config);
    if (!parsed.ok) {
      throw new Error(`X32 config invalid: ${parsed.error}`);
    }
    return makeBrokerAdapter(new X32Broker(parsed.config), parseX32Config, "x32");
  },
};

registerDeviceKind(x32Kind);
