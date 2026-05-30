import { Music2 } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { AbletonBroker } from "@/lib/ableton/osc-broker";
import type {
  ActionDefinition,
  BrokerImpl,
  ConnectionStatus,
  DeviceKind,
  KindEvent,
  PresetDefinition,
  VariableDefinition,
} from "@/lib/core/types";

/**
 * Ableton Live kind — fully per-instance. Each connection constructs its
 * own `AbletonBroker` (its own UDP socket + state), with the same
 * per-action dispatcher pattern OBS uses for commands.
 */

// ─────────────────────────── Config schema ────────────────────────────

interface AbletonConfig {
  /** Host running Live + AbletonOSC. Usually 127.0.0.1. */
  host: string;
  /** Port AbletonOSC listens on (default 11000). */
  sendPort: number;
  /** Port AbletonOSC replies to (default 11001). */
  recvPort: number;
}

function parseAbletonConfig(
  raw: unknown
): { ok: true; config: AbletonConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const host = typeof r.host === "string" ? r.host.trim() : "";
  if (!host) return { ok: false, error: "host is required" };
  const sendPort =
    typeof r.sendPort === "number" ? r.sendPort : Number(r.sendPort);
  const recvPort =
    typeof r.recvPort === "number" ? r.recvPort : Number(r.recvPort);
  if (!Number.isFinite(sendPort) || sendPort <= 0 || sendPort > 65535) {
    return { ok: false, error: "sendPort must be 1-65535" };
  }
  if (!Number.isFinite(recvPort) || recvPort <= 0 || recvPort > 65535) {
    return { ok: false, error: "recvPort must be 1-65535" };
  }
  return { ok: true, config: { host, sendPort, recvPort } };
}

// ─────────────────────────── Action dispatch ──────────────────────────

type B = AbletonBroker;

/**
 * Mirrors the legacy `/api/ableton/command` discriminated union — same
 * `{action, ...}` body shape so existing client code keeps working
 * after the URL swap.
 */
const ACTIONS: Record<
  string,
  (b: B, body: Record<string, unknown>) => unknown
> = {
  "fire-clip": (b, x) =>
    boolResult(b.fireClip(x.track as number, x.scene as number)),
  "stop-track": (b, x) => boolResult(b.stopTrack(x.track as number)),
  "stop-all": (b) => boolResult(b.stopAll()),
  "play": (b) => boolResult(b.play()),
  "stop": (b) => boolResult(b.stopSong()),
  "continue": (b) => boolResult(b.continueSong()),
  "tap-tempo": (b) => boolResult(b.tap()),
  "set-tempo": (b, x) => {
    const bpm = x.bpm as number;
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 999) {
      throw new Error("Bad BPM");
    }
    return boolResult(b.setTempo(bpm));
  },
  "set-metronome": (b, x) => boolResult(b.toggleMetronome(Boolean(x.on))),
  "refresh-snapshot": (b) => boolResult(b.refreshSnapshot()),
  "raw": (b, x) => {
    const address = x.address as string;
    if (typeof address !== "string" || !address.startsWith("/")) {
      throw new Error("Bad address");
    }
    const args = Array.isArray(x.args)
      ? (x.args as Parameters<typeof b.sendRaw>[1])
      : [];
    return boolResult(b.sendRaw(address, args));
  },
  // Replaces `/api/ableton/test`.
  "test": (b) => b.testConnection(),
};

/**
 * The broker's sync methods return `boolean` (true = sent, false =
 * socket not ready). Convert into the `{success}`-style envelope the
 * generic command route can serialize, and throw on send failure so
 * the route returns 502 — matches the old route's 503-on-fail-but-
 * close-enough behaviour.
 */
function boolResult(ok: boolean): { success: true } {
  if (!ok) throw new Error("OSC send failed (socket not ready?)");
  return { success: true };
}

// ─────────────────────────── Adapter ──────────────────────────────────

class AbletonAdapter implements BrokerImpl {
  private broker: AbletonBroker;

  constructor(config: AbletonConfig) {
    this.broker = new AbletonBroker({
      host: config.host,
      sendPort: config.sendPort,
      recvPort: config.recvPort,
    });
  }

  subscribe(cb: (event: KindEvent) => void): () => void {
    // `AbletonEvent` already carries a `type` discriminator on every
    // variant, so it matches the generic `KindEvent` shape without
    // translation.
    return this.broker.subscribe(
      cb as Parameters<AbletonBroker["subscribe"]>[0]
    );
  }

  getSnapshot(): unknown | null {
    // The Ableton broker doesn't expose a public getSnapshot — its
    // snapshot rides only inside the `snapshot` event replayed on
    // subscribe. Returning null is fine; the SSE route's auto
    // hydration relies on subscribe-replay anyway.
    return null;
  }

  async send(command: unknown): Promise<unknown> {
    if (!command || typeof command !== "object") {
      throw new Error("Ableton command must be an object");
    }
    const body = command as Record<string, unknown>;
    const action = body.action;
    if (typeof action !== "string") {
      throw new Error("Ableton command needs an `action` field");
    }
    const handler = ACTIONS[action];
    if (!handler) {
      throw new Error(`Unknown Ableton action: ${action}`);
    }
    return await handler(this.broker, body);
  }

  updateConfig(raw: unknown): void {
    const parsed = parseAbletonConfig(raw);
    if (!parsed.ok) {
      console.warn(`[ableton] updateConfig rejected: ${parsed.error}`);
      return;
    }
    this.broker.updateConfig({
      host: parsed.config.host,
      sendPort: parsed.config.sendPort,
      recvPort: parsed.config.recvPort,
    });
  }

  getStatus(): ConnectionStatus {
    return this.broker.getStatus() === "connected" ? "connected" : "offline";
  }

  dispose(): void {
    this.broker.dispose();
  }
}

// ─────────────────────────── Actions catalog ─────────────────────────

const abletonActions: ActionDefinition[] = [
  // ── Clips ──
  {
    id: "fire-clip",
    label: "Fire clip",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "scene", type: "number", label: "Scene #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "fire-clip",
      track: Number(o.track ?? 0),
      scene: Number(o.scene ?? 0),
    }),
  },
  {
    id: "stop-track",
    label: "Stop track",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({ action: "stop-track", track: Number(o.track ?? 0) }),
  },
  {
    id: "stop-all",
    label: "Stop all clips",
    category: "Clips",
    toCommand: () => ({ action: "stop-all" }),
  },

  // ── Transport ──
  {
    id: "play",
    label: "Play",
    category: "Transport",
    toCommand: () => ({ action: "play" }),
  },
  {
    id: "stop",
    label: "Stop",
    category: "Transport",
    toCommand: () => ({ action: "stop" }),
  },
  {
    id: "continue",
    label: "Continue",
    category: "Transport",
    toCommand: () => ({ action: "continue" }),
  },
  {
    id: "tap-tempo",
    label: "Tap tempo",
    category: "Transport",
    toCommand: () => ({ action: "tap-tempo" }),
  },
  {
    id: "set-tempo",
    label: "Set tempo",
    category: "Transport",
    options: [
      {
        id: "bpm",
        type: "number",
        label: "BPM",
        default: 120,
        min: 20,
        max: 999,
        step: 0.5,
      },
    ],
    toCommand: (o) => ({ action: "set-tempo", bpm: Number(o.bpm ?? 120) }),
  },
  {
    id: "set-metronome",
    label: "Set metronome",
    category: "Transport",
    options: [{ id: "on", type: "boolean", label: "On", default: true }],
    toCommand: (o) => ({ action: "set-metronome", on: Boolean(o.on) }),
  },

  // ════════════════════════ Track ops ═════════════════════════════════
  // The AbletonOSC spec exposes per-track mute / solo / arm / volume /
  // pan / name endpoints. Track index is 0-based, matching the Live
  // API surface.
  {
    id: "track-mute",
    label: "Track mute",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "muted", type: "boolean", label: "Muted", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/mute",
      args: [Number(o.track ?? 0), o.muted ? 1 : 0],
    }),
  },
  {
    id: "track-solo",
    label: "Track solo",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "soloed", type: "boolean", label: "Soloed", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/solo",
      args: [Number(o.track ?? 0), o.soloed ? 1 : 0],
    }),
  },
  {
    id: "track-arm",
    label: "Track arm record",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "armed", type: "boolean", label: "Armed", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/arm",
      args: [Number(o.track ?? 0), o.armed ? 1 : 0],
    }),
  },
  {
    id: "track-volume",
    label: "Track volume (0..1)",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      {
        id: "volume",
        type: "number",
        label: "Volume (0..1)",
        default: 0.85,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/volume",
      args: [Number(o.track ?? 0), Number(o.volume ?? 0.85)],
    }),
  },
  {
    id: "track-pan",
    label: "Track pan (-1..1)",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      {
        id: "pan",
        type: "number",
        label: "Pan (-1..1)",
        default: 0,
        min: -1,
        max: 1,
        step: 0.05,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/panning",
      args: [Number(o.track ?? 0), Number(o.pan ?? 0)],
    }),
  },
  {
    id: "track-send",
    label: "Track send level",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "send", type: "number", label: "Send #", default: 0, min: 0 },
      {
        id: "level",
        type: "number",
        label: "Level (0..1)",
        default: 0,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/send",
      args: [
        Number(o.track ?? 0),
        Number(o.send ?? 0),
        Number(o.level ?? 0),
      ],
    }),
  },

  // ════════════════════════ Clip ops ══════════════════════════════════
  {
    id: "clip-stop",
    label: "Clip · Stop slot",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip_slot/stop_clip",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0)],
    }),
  },
  {
    id: "clip-delete",
    label: "Clip · Delete",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip_slot/delete_clip",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0)],
    }),
  },
  {
    id: "clip-duplicate",
    label: "Clip · Duplicate to another slot",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Source clip #", default: 0, min: 0 },
      {
        id: "destClip",
        type: "number",
        label: "Dest clip #",
        default: 1,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip_slot/duplicate_clip_to",
      args: [
        Number(o.track ?? 0),
        Number(o.clip ?? 0),
        Number(o.destClip ?? 1),
      ],
    }),
  },

  // ════════════════════════ Scene ops ═════════════════════════════════
  {
    id: "scene-launch",
    label: "Scene · Launch",
    category: "Scenes",
    options: [
      { id: "scene", type: "number", label: "Scene #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/scene/fire",
      args: [Number(o.scene ?? 0)],
    }),
  },
  {
    id: "scene-capture",
    label: "Scene · Capture & insert",
    category: "Scenes",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/capture_and_insert_scene",
      args: [],
    }),
  },
  {
    id: "scene-fire-prev",
    label: "Scene · Fire previous",
    category: "Scenes",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/fire_prev_scene",
      args: [],
    }),
  },
  {
    id: "scene-fire-next",
    label: "Scene · Fire next",
    category: "Scenes",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/fire_next_scene",
      args: [],
    }),
  },

  // ════════════════════════ Transport extras ══════════════════════════
  {
    id: "session-record",
    label: "Session record (toggle)",
    category: "Transport",
    options: [{ id: "armed", type: "boolean", label: "Armed", default: true }],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/session_record",
      args: [o.armed ? 1 : 0],
    }),
  },
  {
    id: "tempo-nudge-up",
    label: "Tempo · Nudge up",
    category: "Transport",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/nudge_up",
      args: [],
    }),
  },
  {
    id: "tempo-nudge-down",
    label: "Tempo · Nudge down",
    category: "Transport",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/nudge_down",
      args: [],
    }),
  },
  {
    id: "song-position-jump",
    label: "Jump song position (beats)",
    category: "Transport",
    options: [
      {
        id: "beats",
        type: "number",
        label: "Position (beats)",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/current_song_time",
      args: [Number(o.beats ?? 0)],
    }),
  },

  // ════════════════════════ Device ops ════════════════════════════════
  {
    id: "device-enable",
    label: "Device · Enable / disable",
    category: "Devices",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "device", type: "number", label: "Device #", default: 0, min: 0 },
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/device/set/parameter/value",
      // AbletonOSC convention: param 0 of every device is its on/off.
      args: [
        Number(o.track ?? 0),
        Number(o.device ?? 0),
        0,
        o.enabled ? 1 : 0,
      ],
    }),
  },
  {
    id: "device-param",
    label: "Device · Set parameter value",
    category: "Devices",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "device", type: "number", label: "Device #", default: 0, min: 0 },
      { id: "param", type: "number", label: "Parameter #", default: 1, min: 0 },
      {
        id: "value",
        type: "number",
        label: "Value (0..1)",
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/device/set/parameter/value",
      args: [
        Number(o.track ?? 0),
        Number(o.device ?? 0),
        Number(o.param ?? 1),
        Number(o.value ?? 0.5),
      ],
    }),
  },

  // ════════════════════════ View ops ══════════════════════════════════
  {
    id: "view-select-track",
    label: "View · Select track",
    category: "View",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/selected_track",
      args: [Number(o.track ?? 0)],
    }),
  },
  {
    id: "view-toggle-session-arrangement",
    label: "View · Toggle session/arrangement",
    category: "View",
    toCommand: () => ({
      action: "raw",
      address: "/live/view/show_view",
      args: ["Session"],
    }),
  },

  // ════════════════════════ Stop everything ═══════════════════════════
  {
    id: "stop-all-tracks",
    label: "Stop all tracks",
    category: "Clips",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/stop_all_clips",
      args: [],
    }),
  },
];

// ─────────────────────────── Variables ────────────────────────────────

const abletonVariables: VariableDefinition[] = [
  { id: "tempo", label: "Tempo (BPM)", hint: "number" },
  { id: "is_playing", label: "Playing on/off", hint: "boolean" },
  { id: "metronome", label: "Metronome on/off", hint: "boolean" },
  { id: "current_song_time", label: "Song time", hint: "time" },
  { id: "track_count", label: "Track count", hint: "number" },
  { id: "scene_count", label: "Scene count", hint: "number" },
];

// ─────────────────────────── Presets ──────────────────────────────────

const abletonPresets: PresetDefinition[] = [
  {
    id: "play",
    label: "Play",
    category: "Transport",
    text: "PLAY",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "play" }],
  },
  {
    id: "stop",
    label: "Stop",
    category: "Transport",
    text: "STOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ffffff",
    steps: [{ actionId: "stop" }],
  },
  {
    id: "continue",
    label: "Continue",
    category: "Transport",
    text: "CONT",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "continue" }],
  },
  {
    id: "tap-tempo",
    label: "Tap tempo",
    category: "Transport",
    text: "TAP",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "tap-tempo" }],
  },
  {
    id: "metronome-toggle",
    label: "Metronome on",
    category: "Transport",
    text: "METR",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "set-metronome", options: { on: true } }],
  },
  {
    id: "stop-all-clips",
    label: "Stop all clips",
    category: "Clips",
    text: "STOP ALL",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "stop-all" }],
  },
  // Quick-fire scene 1 across the first 4 tracks — handy for a
  // launch-pad-style intro cue. The scene index is 0-based, matching
  // the Live API.
  ...[0, 1, 2, 3].map((t) => ({
    id: `fire-track-${t + 1}-scene-1`,
    label: `Fire track ${t + 1} / scene 1`,
    category: "Clips",
    text: `T${t + 1}.1`,
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "fire-clip", options: { track: t, scene: 0 } }],
  })),

  // ── Tracks (configure track # in inspector) ─────────────────────────
  {
    id: "track-mute",
    label: "Track · Mute",
    category: "Tracks",
    text: "T MUTE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "track-mute", options: { track: 0, muted: true } }],
  },
  {
    id: "track-solo",
    label: "Track · Solo",
    category: "Tracks",
    text: "T SOLO",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "track-solo", options: { track: 0, soloed: true } }],
  },
  {
    id: "track-arm",
    label: "Track · Arm record",
    category: "Tracks",
    text: "T ARM",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "track-arm", options: { track: 0, armed: true } }],
  },
  {
    id: "track-volume",
    label: "Track · Set volume",
    category: "Tracks",
    text: "T VOL",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "track-volume", options: { track: 0, volume: 0.85 } },
    ],
  },
  {
    id: "track-pan",
    label: "Track · Set pan",
    category: "Tracks",
    text: "T PAN",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "track-pan", options: { track: 0, pan: 0 } }],
  },
  {
    id: "track-send",
    label: "Track · Send level",
    category: "Tracks",
    text: "T SEND",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "track-send", options: { track: 0, send: 0, level: 0.5 } },
    ],
  },

  // ── Clips ──────────────────────────────────────────────────────────
  {
    id: "clip-stop",
    label: "Clip · Stop slot",
    category: "Clips",
    text: "CLIP\nSTOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "clip-stop", options: { track: 0, clip: 0 } }],
  },
  {
    id: "clip-delete",
    label: "Clip · Delete",
    category: "Clips",
    text: "CLIP\nDEL",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "clip-delete", options: { track: 0, clip: 0 } }],
  },
  {
    id: "clip-duplicate",
    label: "Clip · Duplicate",
    category: "Clips",
    text: "CLIP\nDUP",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "clip-duplicate",
        options: { track: 0, clip: 0, destClip: 1 },
      },
    ],
  },
  {
    id: "stop-all-tracks",
    label: "Stop all tracks",
    category: "Clips",
    text: "STOP\nALL TR",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "stop-all-tracks" }],
  },

  // ── Scenes ─────────────────────────────────────────────────────────
  {
    id: "scene-launch",
    label: "Scene · Launch",
    category: "Scenes",
    text: "SC ▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "scene-launch", options: { scene: 0 } }],
  },
  {
    id: "scene-capture",
    label: "Scene · Capture & insert",
    category: "Scenes",
    text: "SC\nCAP",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "scene-capture" }],
  },
  {
    id: "scene-fire-prev",
    label: "Scene · Previous",
    category: "Scenes",
    text: "SC ←",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "scene-fire-prev" }],
  },
  {
    id: "scene-fire-next",
    label: "Scene · Next",
    category: "Scenes",
    text: "SC →",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "scene-fire-next" }],
  },

  // ── Transport extras ────────────────────────────────────────────────
  {
    id: "session-record",
    label: "Session record",
    category: "Transport",
    text: "SESS\nREC",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "session-record", options: { armed: true } }],
  },
  {
    id: "tempo-nudge-up",
    label: "Tempo · Nudge up",
    category: "Transport",
    text: "BPM +",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "tempo-nudge-up" }],
  },
  {
    id: "tempo-nudge-down",
    label: "Tempo · Nudge down",
    category: "Transport",
    text: "BPM −",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "tempo-nudge-down" }],
  },
  {
    id: "song-position-jump",
    label: "Jump song position",
    category: "Transport",
    text: "JUMP",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "song-position-jump", options: { beats: 0 } }],
  },

  // ── Devices ────────────────────────────────────────────────────────
  {
    id: "device-enable",
    label: "Device · Enable/disable",
    category: "Devices",
    text: "DEV\nON/OFF",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "device-enable",
        options: { track: 0, device: 0, enabled: true },
      },
    ],
  },
  {
    id: "device-param",
    label: "Device · Set parameter",
    category: "Devices",
    text: "DEV\nPARAM",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "device-param",
        options: { track: 0, device: 0, param: 1, value: 0.5 },
      },
    ],
  },

  // ── View ──────────────────────────────────────────────────────────
  {
    id: "view-select-track",
    label: "View · Select track",
    category: "View",
    text: "VIEW\nT",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-select-track", options: { track: 0 } }],
  },
  {
    id: "view-toggle-session",
    label: "View · Toggle session",
    category: "View",
    text: "VIEW\nSESS",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-toggle-session-arrangement" }],
  },
];

// ─────────────────────────── Kind definition ──────────────────────────

const abletonKind: DeviceKind = {
  kind: "ableton",
  displayName: "Ableton Live",
  icon: Music2,
  tagline: "AbletonOSC (UDP)",
  parseConfig: parseAbletonConfig,
  defaultConfig: (): AbletonConfig => ({
    host: "127.0.0.1",
    sendPort: 11000,
    recvPort: 11001,
  }),
  pages: [{ href: "/ableton", label: "Ableton", icon: Music2 }],
  actions: abletonActions,
  variables: abletonVariables,
  presets: abletonPresets,
  make({ config }): BrokerImpl {
    const parsed = parseAbletonConfig(config);
    if (!parsed.ok) {
      throw new Error(`Ableton config invalid: ${parsed.error}`);
    }
    return new AbletonAdapter(parsed.config);
  },
};

registerDeviceKind(abletonKind);
