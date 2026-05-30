import { variableBus, type VariableValue } from "./variable-bus";
import type { BrokerImpl, KindEvent } from "./types";

/**
 * Bridge a kind's broker events into the global VariableBus. Each
 * registered bridge subscribes to its broker on `attach` and returns
 * an `unattach` callback the manager calls on connection removal.
 *
 * Bridges are NOT inlined inside the kind's `make()` because attaching
 * a bus subscriber would keep the broker hot even with no SSE
 * consumers — and that's exactly what we want for variables (a
 * surface button must reflect tally state regardless of whether the
 * Live page is open). Keeping the bridge separate makes that intent
 * explicit and centralises the kind→variable mappings in one place.
 */

type BridgeFactory = (connectionId: string, broker: BrokerImpl) => () => void;

const BRIDGE_REGISTRY: Record<string, BridgeFactory> = {
  vmix: bridgeVmix,
  obs: bridgeObs,
  ableton: bridgeAbleton,
  // x32 and grandma3 register their own bridges below when imported.
};

export function registerBridge(kind: string, factory: BridgeFactory): void {
  BRIDGE_REGISTRY[kind] = factory;
}

export function attachBridge(
  kind: string,
  connectionId: string,
  broker: BrokerImpl
): () => void {
  const factory = BRIDGE_REGISTRY[kind];
  if (!factory) return () => {};
  try {
    return factory(connectionId, broker);
  } catch (err) {
    console.warn(`[variable-bridges] failed to attach ${kind}:`, err);
    return () => {};
  }
}

// ─────────────────────────── vMix bridge ──────────────────────────────

interface VmixInputLite {
  number?: number;
  muted?: boolean;
  hasAudio?: boolean;
}
interface VmixStateMessage {
  ok: boolean;
  state?: {
    activeInput?: number;
    previewInput?: number;
    inputs?: VmixInputLite[];
    streaming?: boolean;
    recording?: boolean;
    fadeToBlack?: boolean;
    overlays?: Array<{ number: number; inputNumber: number; preview?: boolean }>;
    audio?: { muted?: boolean };
    audioBuses?: Array<{ name: string; muted: boolean }>;
  };
}

const VMIX_BUS_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;

function bridgeVmix(connectionId: string, broker: BrokerImpl): () => void {
  return broker.subscribe((event: KindEvent) => {
    if (event.type !== "state") return;
    const msg = event as unknown as VmixStateMessage & KindEvent;
    if (!msg.ok || !msg.state) return;
    const s = msg.state;
    const batch: Record<string, VariableValue> = {
      tally_active: s.activeInput ?? null,
      tally_preview: s.previewInput ?? null,
      input_count: Array.isArray(s.inputs) ? s.inputs.length : null,
      streaming: s.streaming ?? null,
      recording: s.recording ?? null,
      fade_to_black: s.fadeToBlack ?? null,
    };
    // Overlay channels 1-4 → the Input number on each, split by where it
    // sits: `overlay_<ch>` = live/program input, `overlay_<ch>_pvw` =
    // preview input (0 = none). Drives red-live / green-preview tally on
    // OverlayInput + PreviewOverlayInput buttons.
    for (let ch = 1; ch <= 8; ch++) {
      const live = s.overlays?.find((x) => x.number === ch && !x.preview);
      const pvw = s.overlays?.find((x) => x.number === ch && x.preview);
      batch[`overlay_${ch}`] = live ? live.inputNumber : 0;
      batch[`overlay_${ch}_pvw`] = pvw ? pvw.inputNumber : 0;
    }
    // Audio bus on/off (on = NOT muted). Master is bus "M".
    batch.bus_m_on = s.audio ? !s.audio.muted : null;
    for (const L of VMIX_BUS_LETTERS) {
      const bus = s.audioBuses?.find((b) => b.name === L);
      batch[`bus_${L.toLowerCase()}_on`] = bus ? !bus.muted : null;
    }
    // Per-input mute (mic-mute tally) for inputs that carry audio.
    if (Array.isArray(s.inputs)) {
      for (const inp of s.inputs) {
        if (inp.hasAudio && typeof inp.number === "number") {
          batch[`input_${inp.number}_muted`] = Boolean(inp.muted);
        }
      }
    }
    variableBus.setBatch(connectionId, batch);
  });
}

// ─────────────────────────── OBS bridge ───────────────────────────────

interface ObsSnapshotShape {
  currentProgramSceneName: string | null;
  currentPreviewSceneName: string | null;
  studioModeEnabled: boolean;
  stream?: { active: boolean; timecodeMs: number };
  record?: { active: boolean; timecodeMs: number };
  stats?: { cpuUsage: number; activeFps: number };
}

function bridgeObs(connectionId: string, broker: BrokerImpl): () => void {
  return broker.subscribe((event: KindEvent) => {
    const ev = event as KindEvent & { [k: string]: unknown };
    switch (ev.type) {
      case "snapshot": {
        const s = ev.snapshot as ObsSnapshotShape | undefined;
        if (!s) return;
        variableBus.setBatch(connectionId, {
          current_program_scene: s.currentProgramSceneName ?? null,
          current_preview_scene: s.currentPreviewSceneName ?? null,
          studio_mode: Boolean(s.studioModeEnabled),
          streaming: Boolean(s.stream?.active),
          recording: Boolean(s.record?.active),
          stream_timecode: s.stream?.timecodeMs ?? 0,
          record_timecode: s.record?.timecodeMs ?? 0,
          fps: s.stats?.activeFps ?? 0,
          cpu_usage: s.stats?.cpuUsage ?? 0,
        });
        return;
      }
      case "program-scene-changed":
        variableBus.set(
          connectionId,
          "current_program_scene",
          (ev.sceneName as string | null) ?? null
        );
        return;
      case "preview-scene-changed":
        variableBus.set(
          connectionId,
          "current_preview_scene",
          (ev.sceneName as string | null) ?? null
        );
        return;
      case "studio-mode-changed":
        variableBus.set(connectionId, "studio_mode", Boolean(ev.enabled));
        return;
      case "stream-state": {
        const s = ev.status as { active: boolean; timecodeMs: number };
        variableBus.setBatch(connectionId, {
          streaming: Boolean(s.active),
          stream_timecode: s.timecodeMs,
        });
        return;
      }
      case "record-state": {
        const s = ev.status as { active: boolean; timecodeMs: number };
        variableBus.setBatch(connectionId, {
          recording: Boolean(s.active),
          record_timecode: s.timecodeMs,
        });
        return;
      }
      case "stats": {
        const s = ev.stats as { cpuUsage: number; activeFps: number };
        variableBus.setBatch(connectionId, {
          fps: s.activeFps,
          cpu_usage: s.cpuUsage,
        });
        return;
      }
    }
  });
}

// ─────────────────────────── Ableton bridge ───────────────────────────

interface AbletonSnapshotShape {
  numTracks?: number;
  numScenes?: number;
  transport?: {
    tempo?: number;
    isPlaying?: boolean;
    metronome?: boolean;
    songBeat?: number;
  };
}

function bridgeAbleton(connectionId: string, broker: BrokerImpl): () => void {
  return broker.subscribe((event: KindEvent) => {
    const ev = event as KindEvent & { [k: string]: unknown };
    if (ev.type === "snapshot") {
      const s = ev.snapshot as AbletonSnapshotShape | undefined;
      if (!s) return;
      variableBus.setBatch(connectionId, {
        track_count: s.numTracks ?? 0,
        scene_count: s.numScenes ?? 0,
        tempo: s.transport?.tempo ?? 0,
        is_playing: Boolean(s.transport?.isPlaying),
        metronome: Boolean(s.transport?.metronome),
        current_song_time: s.transport?.songBeat ?? 0,
      });
      return;
    }
    if (ev.type === "transport") {
      const patch = ev.patch as AbletonSnapshotShape["transport"];
      if (!patch) return;
      const updates: Record<string, number | boolean> = {};
      if (typeof patch.tempo === "number") updates.tempo = patch.tempo;
      if (typeof patch.isPlaying === "boolean") {
        updates.is_playing = patch.isPlaying;
      }
      if (typeof patch.metronome === "boolean") {
        updates.metronome = patch.metronome;
      }
      if (typeof patch.songBeat === "number") {
        updates.current_song_time = patch.songBeat;
      }
      variableBus.setBatch(connectionId, updates);
    }
  });
}
