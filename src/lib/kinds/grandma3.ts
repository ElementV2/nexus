import { Lightbulb } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
import { makeBrokerAdapter } from "@/lib/core/broker-adapter";
import { GrandMA3Broker } from "@/lib/grandma3/osc-broker";
import { grandma3Actions } from "./grandma3-actions";
import { withCategoryColors } from "./category-colors";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
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

const grandma3Kind: DeviceKind = {
  kind: "grandma3",
  displayName: "grandMA3",
  icon: Lightbulb,
  tagline: "OSC over UDP · direct send (no status feedback)",
  // OSC to MA is one-way (UDP, no reply) — we can't verify the console is
  // actually there, so the "connected" state is optimistic. The UI flags it.
  sendOnly: true,
  parseConfig: parseMAConfig,
  defaultConfig: (): MAConfig => ({ host: "192.168.1.50", port: 9000, prefix: "" }),
  // No dedicated page — controlled from the Stream Deck editor.
  actions: withCategoryColors(grandma3Actions),
  variables: grandma3Variables,
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
