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
    const s = this.broker.getStatus();
    return s === "connected"
      ? "connected"
      : s === "connecting"
        ? "connecting"
        : "offline";
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
    label: "Clip · Stop",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
    ],
    // AbletonOSC stops a specific clip via /live/clip/stop, not a
    // clip_slot endpoint (the clip_slot namespace only has fire/create/
    // delete/duplicate/has_clip).
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip/stop",
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
    id: "scene-create",
    label: "Scene · Create",
    category: "Scenes",
    options: [
      {
        id: "index",
        type: "number",
        label: "Insert at (-1 = append)",
        default: -1,
        min: -1,
      },
    ],
    // AbletonOSC has no capture_and_insert_scene; create_scene(index) is
    // the supported way to add a scene (-1 appends at the end).
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/create_scene",
      args: [Number(o.index ?? -1)],
    }),
  },
  {
    id: "scene-fire-selected",
    label: "Scene · Fire selected",
    category: "Scenes",
    // AbletonOSC exposes no fire_prev/next_scene. Pair this with
    // "View · Select scene" to build prev/next on a surface.
    toCommand: () => ({
      action: "raw",
      address: "/live/scene/fire_selected",
      args: [],
    }),
  },
  {
    id: "scene-fire-as-selected",
    label: "Scene · Fire and select",
    category: "Scenes",
    options: [
      { id: "scene", type: "number", label: "Scene #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/scene/fire_as_selected",
      args: [Number(o.scene ?? 0)],
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
    // nudge_up/down are boolean properties (momentary tempo bend while
    // set), addressed via /set — not bare trigger endpoints.
    toCommand: () => ({
      action: "raw",
      address: "/live/song/set/nudge_up",
      args: [1],
    }),
  },
  {
    id: "tempo-nudge-down",
    label: "Tempo · Nudge down",
    category: "Transport",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/set/nudge_down",
      args: [1],
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
    // Selection lives under the /live/view namespace in AbletonOSC, not
    // /live/song.
    toCommand: (o) => ({
      action: "raw",
      address: "/live/view/set/selected_track",
      args: [Number(o.track ?? 0)],
    }),
  },
  {
    id: "view-select-scene",
    label: "View · Select scene",
    category: "View",
    options: [
      { id: "scene", type: "number", label: "Scene #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/view/set/selected_scene",
      args: [Number(o.scene ?? 0)],
    }),
  },
  {
    id: "view-select-clip",
    label: "View · Select clip",
    category: "View",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "scene", type: "number", label: "Scene #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/view/set/selected_clip",
      args: [Number(o.track ?? 0), Number(o.scene ?? 0)],
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

  // ════════════════════════ Recording / capture ═══════════════════════
  {
    id: "trigger-session-record",
    label: "Trigger session record",
    description: "Records into the highlighted slot (the big record button).",
    category: "Recording",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/trigger_session_record",
      args: [],
    }),
  },
  {
    id: "capture-midi",
    label: "Capture MIDI",
    category: "Recording",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/capture_midi",
      args: [],
    }),
  },
  {
    id: "record-mode",
    label: "Arrangement record (toggle)",
    category: "Recording",
    options: [{ id: "on", type: "boolean", label: "Recording", default: true }],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/record_mode",
      args: [o.on ? 1 : 0],
    }),
  },
  {
    id: "arrangement-overdub",
    label: "Arrangement overdub (toggle)",
    category: "Recording",
    options: [{ id: "on", type: "boolean", label: "Overdub", default: true }],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/arrangement_overdub",
      args: [o.on ? 1 : 0],
    }),
  },
  {
    id: "back-to-arranger",
    label: "Back to arranger (clear)",
    category: "Recording",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/set/back_to_arranger",
      args: [0],
    }),
  },

  // ════════════════════════ Undo / loop / cues ════════════════════════
  {
    id: "song-undo",
    label: "Undo",
    category: "Transport",
    toCommand: () => ({ action: "raw", address: "/live/song/undo", args: [] }),
  },
  {
    id: "song-redo",
    label: "Redo",
    category: "Transport",
    toCommand: () => ({ action: "raw", address: "/live/song/redo", args: [] }),
  },
  {
    id: "loop-toggle",
    label: "Arrangement loop (toggle)",
    category: "Transport",
    options: [{ id: "on", type: "boolean", label: "Loop", default: true }],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/set/loop",
      args: [o.on ? 1 : 0],
    }),
  },
  {
    id: "jump-by",
    label: "Jump by (beats)",
    category: "Transport",
    options: [
      {
        id: "beats",
        type: "number",
        label: "Beats (±)",
        default: 4,
        step: 1,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/jump_by",
      args: [Number(o.beats ?? 4)],
    }),
  },
  {
    id: "jump-next-cue",
    label: "Jump to next cue",
    category: "Transport",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/jump_to_next_cue",
      args: [],
    }),
  },
  {
    id: "jump-prev-cue",
    label: "Jump to previous cue",
    category: "Transport",
    toCommand: () => ({
      action: "raw",
      address: "/live/song/jump_to_prev_cue",
      args: [],
    }),
  },
  {
    id: "cue-jump",
    label: "Jump to cue #",
    category: "Transport",
    options: [
      { id: "cue", type: "number", label: "Cue point #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/cue_point/jump",
      args: [Number(o.cue ?? 0)],
    }),
  },

  // ════════════════════════ Track extras ══════════════════════════════
  {
    id: "track-monitoring",
    label: "Track · Monitoring (In/Auto/Off)",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      {
        id: "state",
        type: "dropdown",
        label: "Monitor",
        default: "1",
        choices: [
          { id: "0", label: "In" },
          { id: "1", label: "Auto" },
          { id: "2", label: "Off" },
        ],
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/current_monitoring_state",
      args: [Number(o.track ?? 0), Number(o.state ?? 1)],
    }),
  },
  {
    id: "track-stop-all",
    label: "Track · Stop all clips",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/stop_all_clips",
      args: [Number(o.track ?? 0)],
    }),
  },
  {
    id: "track-name",
    label: "Track · Set name",
    category: "Tracks",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "name", type: "string", label: "Name", default: "" },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/track/set/name",
      args: [Number(o.track ?? 0), String(o.name ?? "")],
    }),
  },

  // ════════════════════════ Clip extras ═══════════════════════════════
  {
    id: "clip-fire",
    label: "Clip · Fire",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip/fire",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0)],
    }),
  },
  {
    id: "clip-mute",
    label: "Clip · Mute (deactivate)",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
      { id: "muted", type: "boolean", label: "Muted", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip/set/muted",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0), o.muted ? 1 : 0],
    }),
  },
  {
    id: "clip-warp",
    label: "Clip · Warp (toggle)",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
      { id: "warping", type: "boolean", label: "Warping", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip/set/warping",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0), o.warping ? 1 : 0],
    }),
  },
  {
    id: "clip-duplicate-loop",
    label: "Clip · Duplicate loop",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip/duplicate_loop",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0)],
    }),
  },
  {
    id: "clipslot-create",
    label: "Clip slot · Create empty clip",
    category: "Clips",
    options: [
      { id: "track", type: "number", label: "Track #", default: 0, min: 0 },
      { id: "clip", type: "number", label: "Clip slot #", default: 0, min: 0 },
      {
        id: "length",
        type: "number",
        label: "Length (beats)",
        default: 4,
        min: 0.25,
        step: 0.25,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/clip_slot/create_clip",
      args: [Number(o.track ?? 0), Number(o.clip ?? 0), Number(o.length ?? 4)],
    }),
  },

  // ════════════════════════ Create / delete ═══════════════════════════
  {
    id: "create-audio-track",
    label: "Create audio track",
    category: "Session",
    options: [
      {
        id: "index",
        type: "number",
        label: "Insert at (-1 = end)",
        default: -1,
        min: -1,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/create_audio_track",
      args: [Number(o.index ?? -1)],
    }),
  },
  {
    id: "create-midi-track",
    label: "Create MIDI track",
    category: "Session",
    options: [
      {
        id: "index",
        type: "number",
        label: "Insert at (-1 = end)",
        default: -1,
        min: -1,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      address: "/live/song/create_midi_track",
      args: [Number(o.index ?? -1)],
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
    id: "scene-fire-selected",
    label: "Scene · Fire selected",
    category: "Scenes",
    text: "SC ▶\nSEL",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "scene-fire-selected" }],
  },
  {
    id: "scene-create",
    label: "Scene · Create",
    category: "Scenes",
    text: "SC +",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "scene-create", options: { index: -1 } }],
  },
  {
    id: "view-select-scene",
    label: "View · Select scene",
    category: "Scenes",
    text: "SEL\nSCENE",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-select-scene", options: { scene: 0 } }],
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
    id: "view-select-clip",
    label: "View · Select clip",
    category: "View",
    text: "VIEW\nCLIP",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "view-select-clip", options: { track: 0, scene: 0 } }],
  },

  // ── Recording ────────────────────────────────────────────────────────
  {
    id: "trigger-session-record",
    label: "Session record (slot)",
    category: "Recording",
    text: "REC\nSLOT",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "trigger-session-record" }],
  },
  {
    id: "capture-midi",
    label: "Capture MIDI",
    category: "Recording",
    text: "CAPT\nMIDI",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "capture-midi" }],
  },
  {
    id: "record-mode",
    label: "Arrangement record",
    category: "Recording",
    text: "ARR\nREC",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "record-mode", options: { on: true } }],
  },
  {
    id: "arrangement-overdub",
    label: "Overdub",
    category: "Recording",
    text: "OVR\nDUB",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "arrangement-overdub", options: { on: true } }],
  },

  // ── Transport extras ──────────────────────────────────────────────────
  {
    id: "song-undo",
    label: "Undo",
    category: "Transport",
    text: "UNDO",
    bgcolor: "#1c1c1e",
    fgcolor: "#ffffff",
    steps: [{ actionId: "song-undo" }],
  },
  {
    id: "song-redo",
    label: "Redo",
    category: "Transport",
    text: "REDO",
    bgcolor: "#1c1c1e",
    fgcolor: "#ffffff",
    steps: [{ actionId: "song-redo" }],
  },
  {
    id: "loop-toggle",
    label: "Arrangement loop",
    category: "Transport",
    text: "LOOP",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "loop-toggle", options: { on: true } }],
  },
  {
    id: "jump-next-cue",
    label: "Next cue",
    category: "Transport",
    text: "CUE →",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "jump-next-cue" }],
  },
  {
    id: "jump-prev-cue",
    label: "Previous cue",
    category: "Transport",
    text: "← CUE",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [{ actionId: "jump-prev-cue" }],
  },

  // ── Track / clip extras ────────────────────────────────────────────────
  {
    id: "track-monitoring",
    label: "Track · Monitoring",
    category: "Tracks",
    text: "MON",
    bgcolor: "#af52de",
    fgcolor: "#ffffff",
    steps: [{ actionId: "track-monitoring", options: { track: 0, state: "1" } }],
  },
  {
    id: "track-stop-all",
    label: "Track · Stop all clips",
    category: "Tracks",
    text: "T STOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "track-stop-all", options: { track: 0 } }],
  },
  {
    id: "clip-fire",
    label: "Clip · Fire",
    category: "Clips",
    text: "CLIP ▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "clip-fire", options: { track: 0, clip: 0 } }],
  },
  {
    id: "clip-mute",
    label: "Clip · Mute",
    category: "Clips",
    text: "CLIP\nMUTE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff9500",
    steps: [{ actionId: "clip-mute", options: { track: 0, clip: 0, muted: true } }],
  },

  // ── Session structure ──────────────────────────────────────────────────
  {
    id: "create-audio-track",
    label: "Create audio track",
    category: "Session",
    text: "+ AUD\nTRK",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "create-audio-track", options: { index: -1 } }],
  },
  {
    id: "create-midi-track",
    label: "Create MIDI track",
    category: "Session",
    text: "+ MIDI\nTRK",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [{ actionId: "create-midi-track", options: { index: -1 } }],
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
