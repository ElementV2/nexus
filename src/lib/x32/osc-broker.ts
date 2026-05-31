import {
  OscUdpBroker,
  type OscMessage,
  type OscUdpConfig,
  type OscUdpSpec,
} from "@/lib/osc/udp-broker";

/**
 * Behringer X32 / M32 OSC broker. Per the X32 OSC docs:
 *   • UDP port 10023 always-open, no handshake.
 *   • `/xremote` (no args) opens a ~10 s subscription window — renewed
 *     every 8 s to stay subscribed.
 *   • `/info` returns version / model / name — doubles as a heartbeat,
 *     and a stale-reply window derives the status indicator.
 *
 * Just a spec over the shared per-instance `OscUdpBroker` — each X32
 * connection still gets its own socket + state.
 */
export type X32Config = OscUdpConfig;

const pad2 = (n: number) => String(n).padStart(2, "0");

// Querying a parameter with no args makes the X32 reply with its current
// value. `/xremote` only streams *changes*, so without these the mute
// feedback + state-toggle start blank until something moves on the
// console. Bundled with the /xremote renewal (every 8 s) they also keep
// state eventually-consistent if a change packet is ever dropped.
const STATE_QUERIES: OscMessage[] = [
  { address: "/xremote", args: [] },
  ...Array.from({ length: 32 }, (_, i) => ({
    address: `/ch/${pad2(i + 1)}/mix/on`,
    args: [] as never[],
  })),
  ...Array.from({ length: 16 }, (_, i) => ({
    address: `/bus/${pad2(i + 1)}/mix/on`,
    args: [] as never[],
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    address: `/dca/${i + 1}/on`,
    args: [] as never[],
  })),
  { address: "/main/st/mix/on", args: [] },
  ...Array.from({ length: 6 }, (_, i) => ({
    address: `/config/mute/${i + 1}`,
    args: [] as never[],
  })),
];

const X32_SPEC: OscUdpSpec = {
  tag: "x32",
  ping: { messages: [{ address: "/info", args: [] }], intervalMs: 5_000 },
  subscribe: {
    messages: STATE_QUERIES,
    intervalMs: 8_000,
  },
  staleMs: 11_000,
  socketRetryMs: 2_000,
  exposeInfoAs: "info",
  testMode: "info",
  parseInfo: (m: OscMessage) => {
    if (m.address !== "/info") return null;
    const [version, model, name] = m.args;
    return {
      version: typeof version === "string" ? version : undefined,
      model: typeof model === "string" ? model : undefined,
      name: typeof name === "string" ? name : undefined,
    };
  },
};

export class X32Broker extends OscUdpBroker {
  constructor(config: X32Config) {
    super(config, X32_SPEC);
  }
}
