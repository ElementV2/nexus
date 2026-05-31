import {
  Monitor,
  Volume2,
  Clapperboard,
  ListMusic,
  Type,
  Palette,
} from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { VmixStateBroker } from "@/lib/vmix/state-broker";
import {
  COMMAND_FETCH_TIMEOUT_MS,
  POLLING_INTERVAL_MS,
  VMIX_DEFAULT_PORT,
} from "@/lib/vmix/constants";
import type {
  BrokerImpl,
  ConnectionStatus,
  DeviceKind,
  KindEvent,
  VariableDefinition,
} from "@/lib/core/types";
import {
  vmixShortcutActions,
  vmixShortcutPresets,
} from "./vmix-shortcut-actions";

/**
 * vMix kind — fully per-instance.
 *
 * Each connection owns its own `VmixStateBroker` (its own HTTP poll loop
 * + cached state) AND dispatches commands to its own `config.host`. So
 * multiple vMix machines poll and are controlled independently — a deck
 * button targeting "vMix #2" both reads vMix #2's tally (per-connection
 * variables → deck feedback) and sends to vMix #2. The legacy
 * live/playlist/title/audio/replay/colour pages subscribe to the DEFAULT
 * connection's SSE (resolved via `useConnectionId` → default), so they
 * follow whichever vMix is marked default.
 */

// ─────────────────────────── Config schema ────────────────────────────

interface VmixConfig {
  host: string;
  /** vMix HTTP API port — default 8088. */
  port: number;
  /** Poll cadence (ms) for the shared state broker. */
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
      pollingInterval: Number.isFinite(pollingInterval)
        ? pollingInterval
        : POLLING_INTERVAL_MS,
      srtPort: Number.isFinite(srtPort) ? srtPort : 5000,
    },
  };
}

// ─────────────────────────── Adapter ──────────────────────────────────

class VmixAdapter implements BrokerImpl {
  private broker: VmixStateBroker;

  constructor(private config: VmixConfig) {
    // Per-instance poller bound to THIS connection's host/port/cadence.
    // No longer writes the global `vmix_*` prefs (that's what made two
    // vMix connections fight over one host). The legacy pages follow the
    // DEFAULT vMix via `applyDefaultsToLegacy` + `useConnectionId`.
    this.broker = new VmixStateBroker({
      host: config.host,
      port: config.port,
      pollingInterval: config.pollingInterval,
    });
  }

  subscribe(cb: (event: KindEvent) => void): () => void {
    // vMix state-broker emits raw `Message` objects (no `type` field).
    // Wrap each one in `{ type: "state", ... }` so the generic SSE
    // route — which JSON-stringifies untyped messages just fine — and
    // the consumer hook can both dispatch by tag like every other kind.
    return this.broker.subscribe((msg) => {
      cb({ type: "state", ...msg } as KindEvent);
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
   * Forward a `VmixCommand` shape (`{Function, Input?, Value?, ...}`)
   * to THIS connection's vMix HTTP API — `config.host`/`port`, not the
   * global prefs. That's what makes per-action targeting of multiple
   * vMix machines actually route to the right one.
   */
  private async dispatch(body: Record<string, unknown>): Promise<unknown> {
    const fn = body.Function;
    if (!fn) throw new Error("Missing Function");
    const host = this.config.host;
    const port = this.config.port;

    const params = new URLSearchParams({ Function: String(fn) });
    for (const k of [
      "Input",
      "Value",
      "Mix",
      "Duration",
      "Channel",
      "SelectedIndex",
      "SelectedName",
    ]) {
      if (body[k] !== undefined) params.set(k, String(body[k]));
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COMMAND_FETCH_TIMEOUT_MS
    );
    try {
      const res = await fetch(
        `http://${host}:${port}/api/?${params.toString()}`,
        { signal: controller.signal, cache: "no-store" }
      );
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
      console.warn(`[vmix] updateConfig rejected: ${parsed.error}`);
      return;
    }
    // Per-instance: update our config + the poller's so commands AND
    // polling both follow the new host.
    this.config = parsed.config;
    this.broker.updateConfig({
      host: parsed.config.host,
      port: parsed.config.port,
      pollingInterval: parsed.config.pollingInterval,
    });
  }

  getStatus(): ConnectionStatus {
    // Delegate to the broker so the list surfaces "connecting" during the
    // first round-trip / right after a host switch, instead of jumping
    // offline → error/connected with no progress shown.
    return this.broker.getStatus();
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
  tagline: "HTTP XML API",
  parseConfig: parseVmixConfig,
  defaultConfig: (): VmixConfig => ({
    host: "localhost",
    port: VMIX_DEFAULT_PORT,
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
  // Actions + presets are the single generated vMix catalog — every
  // documented Function (families condensed to one parameterized entry),
  // plus the named transitions the reference omits. Curated colours are
  // carried onto the matching tiles inside the generator.
  actions: vmixShortcutActions,
  variables: vmixVariables,
  presets: vmixShortcutPresets,
  make({ config }): BrokerImpl {
    const parsed = parseVmixConfig(config);
    if (!parsed.ok) {
      throw new Error(`vMix config invalid: ${parsed.error}`);
    }
    return new VmixAdapter(parsed.config);
  },
};

registerDeviceKind(vmixKind);
