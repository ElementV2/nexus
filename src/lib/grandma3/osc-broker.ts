import {
  OscUdpBroker,
  type OscUdpConfig,
  type OscUdpSpec,
} from "@/lib/osc/udp-broker";

/**
 * grandMA3 (and grandMA2 — identical wire protocol) OSC broker over UDP.
 * MA accepts:
 *   • `/cmd <string>` — runs a console command-line string (catch-all
 *     for any command-line operation).
 *   • `/<page>/<exec>` — directly drive an executor (fader / button).
 *
 * MA is send-only over OSC — it doesn't reply — so we report
 * "connected" the moment the socket binds (`connectedOnOpen`) and use a
 * benign `/cmd ""` as a no-op heartbeat. Reused for both MA3 and MA2;
 * only the command-line SYNTAX differs, and that's emitted by the action
 * catalog, not the broker.
 */
export type MAConfig = OscUdpConfig;

const MA_SPEC: OscUdpSpec = {
  tag: "grandma3",
  ping: { messages: [{ address: "/cmd", args: [""] }], intervalMs: 5_000 },
  connectedOnOpen: true,
  // Rebind the UDP socket ~2 s after an error (parity with X32). The 5 s
  // heartbeat would re-create it anyway via `ensureSocket`, but the explicit
  // retry recovers a network blip faster.
  socketRetryMs: 2_000,
  testMode: "ping",
};

export class GrandMA3Broker extends OscUdpBroker {
  constructor(config: MAConfig) {
    super(config, MA_SPEC);
  }
}
