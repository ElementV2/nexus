import { variableBus, type VariableValue } from "./variable-bus";
import { createLogger } from "./logger";
import type { BrokerImpl, KindEvent } from "./types";

const log = createLogger("variable-bridges");

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
    log.warn(`failed to attach ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    return () => {};
  }
}

// ─────────────────────────── vMix bridge ──────────────────────────────

interface VmixInputLite {
  key?: string;
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
  // Input numbers we published per-input vars for last snapshot, so a
  // deleted/renumbered input's `input_<n>_*` vars are purged instead of
  // lingering and driving a stale mute-tally feedback (audit N22).
  let lastInputNums = new Set<number>();
  return broker.subscribe((event: KindEvent) => {
    if (event.type !== "state") return;
    const msg = event as unknown as VmixStateMessage & KindEvent;
    if (!msg.ok || !msg.state) return;
    const s = msg.state;
    // Bindings are pinned by the input's stable KEY (GUID), but vMix reports
    // tally/overlay state by NUMBER. Publish the KEY (for matching) AND the
    // number (legacy bindings + display) for every feedback slot, plus
    // `input_keys` (all current keys) so a button whose key has vanished can
    // render "disconnected".
    const inputs = Array.isArray(s.inputs) ? s.inputs : [];
    const keyByNum = new Map<number, string>();
    for (const inp of inputs) {
      if (typeof inp.number === "number") keyByNum.set(inp.number, inp.key ?? "");
    }
    const keyOf = (n: number | undefined | null): string =>
      n ? keyByNum.get(n) ?? "" : "";

    const batch: Record<string, VariableValue> = {
      tally_active: s.activeInput ?? null,
      tally_active_key: keyOf(s.activeInput),
      tally_preview: s.previewInput ?? null,
      tally_preview_key: keyOf(s.previewInput),
      input_count: inputs.length,
      input_keys: inputs.map((i) => i.key ?? "").filter(Boolean).join(","),
      streaming: s.streaming ?? null,
      recording: s.recording ?? null,
      fade_to_black: s.fadeToBlack ?? null,
    };
    // Overlay channels 1-8 → input on each, split by where it sits:
    // `overlay_<ch>` (live/program) vs `overlay_<ch>_pvw` (preview), 0 =
    // none, each with a `_key` companion. Drives red-live / green-preview
    // tally on OverlayInput + PreviewOverlayInput buttons.
    for (let ch = 1; ch <= 8; ch++) {
      const live = s.overlays?.find((x) => x.number === ch && !x.preview);
      const pvw = s.overlays?.find((x) => x.number === ch && x.preview);
      batch[`overlay_${ch}`] = live ? live.inputNumber : 0;
      batch[`overlay_${ch}_key`] = keyOf(live?.inputNumber);
      batch[`overlay_${ch}_pvw`] = pvw ? pvw.inputNumber : 0;
      batch[`overlay_${ch}_pvw_key`] = keyOf(pvw?.inputNumber);
    }
    // Audio bus on/off (on = NOT muted). Master is bus "M".
    batch.bus_m_on = s.audio ? !s.audio.muted : null;
    for (const L of VMIX_BUS_LETTERS) {
      const bus = s.audioBuses?.find((b) => b.name === L);
      batch[`bus_${L.toLowerCase()}_on`] = bus ? !bus.muted : null;
    }
    // Per-input mute (mic-mute tally) for inputs that carry audio — keyed by
    // number, with a `_key` companion so a key-pinned mute button resolves.
    const inputNums = new Set<number>();
    for (const inp of inputs) {
      if (inp.hasAudio && typeof inp.number === "number") {
        inputNums.add(inp.number);
        batch[`input_${inp.number}_muted`] = Boolean(inp.muted);
        batch[`input_${inp.number}_key`] = inp.key ?? "";
      }
    }
    variableBus.setBatch(connectionId, batch);
    // Purge per-input vars for inputs that vanished since the last snapshot.
    for (const n of lastInputNums) {
      if (!inputNums.has(n)) {
        variableBus.remove(connectionId, `input_${n}_muted`);
        variableBus.remove(connectionId, `input_${n}_key`);
      }
    }
    lastInputNums = inputNums;
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
