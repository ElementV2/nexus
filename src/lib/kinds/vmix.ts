import {
  Monitor,
  Volume2,
  Clapperboard,
  ListMusic,
  Type,
  Palette,
} from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { createLogger } from "@/lib/core/logger";
import { VmixTcpBroker } from "@/lib/vmix/tcp-broker";
import {
  COMMAND_FETCH_TIMEOUT_MS,
  POLLING_INTERVAL_MS,
  VMIX_DEFAULT_PORT,
  VMIX_TCP_DEFAULT_PORT,
} from "@/lib/vmix/constants";
import type {
  BrokerImpl,
  ConnectionStatus,
  DeviceKind,
  KindEvent,
  VariableDefinition,
} from "@/lib/core/types";
import { vmixShortcutActions } from "./vmix-shortcut-actions";

/**
 * vMix kind — fully per-instance.
 *
 * Each connection owns its own `VmixTcpBroker` (a persistent TCP connection
 * to vMix's real-time API: SUBSCRIBE TALLY/ACTS for pushed feedback + FUNCTION
 * for commands + XML for full state) AND dispatches commands to its own
 * `config.host`. So multiple vMix machines are read and controlled
 * independently — a deck button targeting "vMix #2" both reads vMix #2's tally
 * (per-connection variables → deck feedback) and sends to vMix #2. The legacy
 * live/playlist/title/audio/replay/colour pages subscribe to the DEFAULT
 * connection's SSE (resolved via `useConnectionId` → default), so they
 * follow whichever vMix is marked default.
 */

// ─────────────────────────── Config schema ────────────────────────────

interface VmixConfig {
  host: string;
  /** vMix HTTP API port — default 8088. Used for the connection test probe
   *  and as a command fallback when the TCP socket is momentarily down. */
  port: number;
  /** vMix TCP API port — default 8099. The real-time broker (commands +
   *  SUBSCRIBE TALLY/ACTS + XML) runs here. */
  tcpPort: number;
  /** Background XML poll cadence (ms) for the broker — keeps VU/levels fresh
   *  between pushed events. */
  pollingInterval: number;
  /** vMix SRT publisher port — purely informational here, used by the
   *  preview tile to construct an SRT URL. */
  srtPort: number;
}

function parseVmixConfig(
  raw: unknown
): { ok: true; config: VmixConfig } | { ok: false; error: string } {
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
  const tcpPortRaw =
    typeof r.tcpPort === "number" ? r.tcpPort : Number(r.tcpPort ?? VMIX_TCP_DEFAULT_PORT);
  const tcpPort =
    Number.isFinite(tcpPortRaw) && tcpPortRaw > 0 && tcpPortRaw <= 65535
      ? tcpPortRaw
      : VMIX_TCP_DEFAULT_PORT;
  const pollingInterval =
    typeof r.pollingInterval === "number"
      ? r.pollingInterval
      : Number(r.pollingInterval ?? POLLING_INTERVAL_MS);
  const srtPort =
    typeof r.srtPort === "number" ? r.srtPort : Number(r.srtPort ?? 5000);
  return {
    ok: true,
    config: {
      host,
      port,
      tcpPort,
      pollingInterval: Number.isFinite(pollingInterval)
        ? pollingInterval
        : POLLING_INTERVAL_MS,
      srtPort: Number.isFinite(srtPort) ? srtPort : 5000,
    },
  };
}

// ─────────────────────────── Adapter ──────────────────────────────────

class VmixAdapter implements BrokerImpl {
  private broker: VmixTcpBroker;

  constructor(private config: VmixConfig) {
    // Per-instance real-time TCP broker bound to THIS connection's host. It
    // pushes tally/activator changes (instant deck feedback) and carries the
    // FUNCTION commands. Multiple vMix machines stay fully independent — a
    // deck button targeting "vMix #2" reads #2's tally and sends to #2. The
    // legacy pages follow the DEFAULT vMix via `useConnectionId`.
    this.broker = new VmixTcpBroker({
      host: config.host,
      httpPort: config.port,
      tcpPort: config.tcpPort,
      pollingInterval: config.pollingInterval,
    });
  }

  subscribe(cb: (event: KindEvent) => void): () => void {
    // vMix state-broker emits raw `Message` objects (no `type` field).
    // Wrap each one in `{ type: "state", ... }` so the generic SSE route
    // and the consumer hook can dispatch by tag like every other kind.
    //
    // The broker's StateMessage carries the full `raw` XML (~10-40 KB) for
    // its internal byte-identical short-circuit, but we DON'T forward it:
    // its only client was the (now-removed) debug page, yet it was
    // JSON-stringified into every SSE frame for every connected client on
    // every changed tick — the dominant serialization cost on this path.
    // Forward only the parsed state. (audit N11)
    return this.broker.subscribe((msg) => {
      if (msg.ok) {
        cb({ type: "state", ok: true, state: msg.state, ts: msg.ts } as KindEvent);
      } else {
        cb({ type: "state", ok: false, error: msg.error, ts: msg.ts } as KindEvent);
      }
    });
  }

  getSnapshot(): unknown | null {
    // Return the cached VmixState (not the Message wrapper) so the
    // /api/connections/:id GET response can render the connection
    // detail page without unwrapping. Returns null when no successful
    // poll has landed yet — a fresh / errored broker has no state.
    const msg = this.broker.getSnapshot();
    if (!msg || !msg.ok) return null;
    return msg.state;
  }

  async send(command: unknown): Promise<unknown> {
    if (!command || typeof command !== "object") {
      throw new Error("vMix command must be an object");
    }
    const body = command as Record<string, unknown>;
    // Action shortcut: `{ action: "test" }` runs the connection probe
    // (replaces the legacy `/api/vmix/test` route). All other commands
    // are interpreted as direct vMix Function calls.
    if (body.action === "test") {
      return this.runTest(body);
    }
    return this.dispatch(body);
  }

  /**
   * Forward a `VmixCommand` shape (`{Function, Input?, Value?, ...}`) to THIS
   * connection's vMix. Primary path is the persistent TCP socket (`FUNCTION`);
   * if it's momentarily down (reconnecting / firewall) we fall back to the
   * HTTP API so a live command is never silently lost. Either way it targets
   * `config.host`, so per-action routing to multiple vMix machines holds.
   */
  private async dispatch(body: Record<string, unknown>): Promise<unknown> {
    const fn = body.Function;
    if (!fn) throw new Error("Missing Function");

    const params: Record<string, string> = {};
    for (const k of [
      "Input",
      "Value",
      "Mix",
      "Duration",
      "Channel",
      "SelectedIndex",
      "SelectedName",
    ]) {
      if (body[k] !== undefined) params[k] = String(body[k]);
    }

    try {
      await this.broker.sendFunction(String(fn), params);
      return { success: true };
    } catch (err) {
      // TCP path unavailable — fall back to HTTP so the command still fires.
      createLogger("vmix").debug(
        `TCP send failed (${err instanceof Error ? err.message : "?"}), falling back to HTTP`
      );
      return this.httpDispatch(String(fn), params);
    }
  }

  /** Fallback command path over the HTTP API (`config.port`, default 8088). */
  private async httpDispatch(
    fn: string,
    params: Record<string, string>
  ): Promise<unknown> {
    const { host, port } = this.config;
    const qs = new URLSearchParams({ Function: fn, ...params });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COMMAND_FETCH_TIMEOUT_MS
    );
    try {
      const res = await fetch(`http://${host}:${port}/api/?${qs.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`vMix returned ${res.status}: ${text}`);
      }
      return { success: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Probe vMix by GETting its API root and pulling the version /
   * edition out of the XML. Optional `host` / `port` overrides let the
   * connections panel test new values before persisting them — same
   * contract as the legacy `/api/vmix/test` route.
   */
  private async runTest(body: Record<string, unknown>): Promise<unknown> {
    const host = (
      typeof body.host === "string" ? body.host : this.config.host
    ).trim();
    const port =
      typeof body.port === "number" ? body.port : this.config.port;
    if (!host) return { ok: false, error: "Host is empty" };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`http://${host}:${port}/api/`, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const xml = await res.text();
      const version = xml.match(/<version>([^<]+)<\/version>/i)?.[1]?.trim();
      const edition = xml.match(/<edition>([^<]+)<\/edition>/i)?.[1]?.trim();
      if (!version) {
        return { ok: false, error: "Reply didn't look like vMix XML" };
      }
      return { ok: true, version, edition };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      return {
        ok: false,
        error: msg.includes("aborted") ? "Timed out" : msg,
      };
    }
  }

  updateConfig(raw: unknown): void {
    const parsed = parseVmixConfig(raw);
    if (!parsed.ok) {
      createLogger("vmix").warn(`updateConfig rejected: ${parsed.error}`);
      return;
    }
    // Per-instance: update our config + the poller's so commands AND
    // polling both follow the new host.
    this.config = parsed.config;
    this.broker.updateConfig({
      host: parsed.config.host,
      httpPort: parsed.config.port,
      tcpPort: parsed.config.tcpPort,
      pollingInterval: parsed.config.pollingInterval,
    });
  }

  getStatus(): ConnectionStatus {
    // Delegate to the broker so the list surfaces "connecting" during the
    // first round-trip / right after a host switch, instead of jumping
    // offline → error/connected with no progress shown.
    return this.broker.getStatus();
  }

  /** Live transport label for the connections card — TCP when the real-time
   *  socket is carrying state/commands, HTTP when we've fallen back. Null when
   *  offline so the card shows the kind's static tagline. */
  statusLabel(): string | null {
    switch (this.broker.activeTransport()) {
      case "tcp":
        return "TCP (real-time)";
      case "http":
        return "HTTP (fallback)";
      default:
        return null;
    }
  }

  dispose(): void {
    this.broker.dispose();
  }
}

// Actions + presets are generated from the vMix Shortcut reference in
// `./vmix-shortcut-actions.ts` (see its header). The legacy operator pages
// (live/audio/replay/…) build their own commands via `src/lib/vmix/
// commands.ts`; this kind only contributes the surface catalog.

// ─────────────────────────── Variables ────────────────────────────────

const vmixVariables: VariableDefinition[] = [
  { id: "tally_active", label: "Active input #", hint: "number" },
  { id: "tally_preview", label: "Preview input #", hint: "number" },
  { id: "input_count", label: "Total inputs", hint: "number" },
  { id: "streaming", label: "Streaming on/off", hint: "boolean" },
  { id: "recording", label: "Recording on/off", hint: "boolean" },
  { id: "fade_to_black", label: "Fade to black on/off", hint: "boolean" },
  // Overlay channels 1-8 → live (program) input # on each, 0 = off. The
  // matching `overlay_<n>_pvw` (preview input #) are published alongside for
  // feedback but not declared here.
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `overlay_${i + 1}`,
    label: `Overlay ${i + 1} live input # (0 = off)`,
    hint: "number" as const,
  })),
  { id: "bus_m_on", label: "Master bus on", hint: "boolean" },
  { id: "bus_a_on", label: "Bus A on", hint: "boolean" },
  { id: "bus_b_on", label: "Bus B on", hint: "boolean" },
  { id: "bus_c_on", label: "Bus C on", hint: "boolean" },
  { id: "bus_d_on", label: "Bus D on", hint: "boolean" },
  { id: "bus_e_on", label: "Bus E on", hint: "boolean" },
  { id: "bus_f_on", label: "Bus F on", hint: "boolean" },
  { id: "bus_g_on", label: "Bus G on", hint: "boolean" },
];

// ─────────────────────────── Kind definition ──────────────────────────

const vmixKind: DeviceKind = {
  kind: "vmix",
  displayName: "vMix",
  icon: Monitor,
  tagline: "TCP API (real-time)",
  parseConfig: parseVmixConfig,
  defaultConfig: (): VmixConfig => ({
    host: "localhost",
    port: VMIX_DEFAULT_PORT,
    tcpPort: VMIX_TCP_DEFAULT_PORT,
    pollingInterval: POLLING_INTERVAL_MS,
    srtPort: 5000,
  }),
  pages: [
    { href: "/live", label: "Live", icon: Monitor },
    { href: "/audio", label: "Audio", icon: Volume2 },
    { href: "/replay", label: "Replay", icon: Clapperboard },
    { href: "/playlist", label: "Playlist", icon: ListMusic },
    { href: "/titles", label: "Titles", icon: Type },
    { href: "/colorimetry", label: "Color", icon: Palette },
  ],
  // ONE generated vMix catalog: every documented Function (families
  // condensed to one parameterized entry) + the named transitions the
  // reference omits. Each action carries its tile colour; the unified
  // browser synthesizes the draggable tile, so vMix ships NO presets.
  actions: vmixShortcutActions,
  variables: vmixVariables,
  make({ config }): BrokerImpl {
    const parsed = parseVmixConfig(config);
    if (!parsed.ok) {
      throw new Error(`vMix config invalid: ${parsed.error}`);
    }
    return new VmixAdapter(parsed.config);
  },
};

registerDeviceKind(vmixKind);
