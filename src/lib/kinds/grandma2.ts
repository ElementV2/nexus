import { Lightbulb } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { registerBridge } from "@/lib/core/variable-bridges";
import { variableBus } from "@/lib/core/variable-bus";
// MA2's native command line is a Telnet service on port 30000 (its OSC
// surface can't run commands without a third-party plugin). Use the
// dedicated telnet broker — NOT the MA3 OSC broker.
import { GrandMA2TelnetBroker } from "@/lib/grandma2/telnet-broker";
import { grandma2Actions } from "./grandma2-actions";
import { withCategoryColors } from "./category-colors";
import type {
  BrokerImpl,
  DeviceKind,
  KindEvent,
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
  /** Telnet login user — MA2 requires a login before it accepts
   *  commands. Set the console user you created for remote control. */
  user: string;
  /** Telnet login password paired with `user`. */
  password: string;
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
  const user = typeof r.user === "string" ? r.user.trim() : "";
  const password = typeof r.password === "string" ? r.password : "";
  return { ok: true, config: { host, port, user, password } };
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

const grandma2Kind: DeviceKind = {
  kind: "grandma2",
  displayName: "grandMA 2",
  icon: Lightbulb,
  tagline: "Telnet command line (port 30000)",
  parseConfig: parseMA2Config,
  defaultConfig: (): MA2Config => ({
    host: "192.168.1.50",
    port: 30000,
    user: "",
    password: "",
  }),
  // No dedicated page — controlled from the Stream Deck editor.
  actions: withCategoryColors(grandma2Actions),
  variables: grandma2Variables,
  make({ config }): BrokerImpl {
    const parsed = parseMA2Config(config);
    if (!parsed.ok) {
      throw new Error(`grandMA 2 config invalid: ${parsed.error}`);
    }
    return new GrandMA2TelnetBroker(parsed.config);
  },
};

registerDeviceKind(grandma2Kind);
