import { create } from "zustand";
import type {
  AbletonConnectionStatus,
  AbletonSnapshot,
  AbletonTransport,
} from "@/lib/ableton/types";

/** Per-track sample of "which clip is playing and where". */
export interface ClipPositionSample {
  clipIndex: number;
  position: number;
  ts: number;
}

interface AbletonStore {
  status: AbletonConnectionStatus;
  host: string;
  port: number;
  version?: string;
  error?: string;
  snapshot: AbletonSnapshot | null;
  /**
   * Transport lives as its own top-level field — NOT inside snapshot — so
   * that every tempo / songBeat / metronome push doesn't recreate the
   * snapshot reference. With it nested, the page's `s.snapshot`
   * subscription fired ~once every 1.5 s (songtime resync) and re-walked
   * the entire clip grid even though only the bars.beats counter
   * actually changed.
   */
  transport: AbletonTransport | null;
  /** trackIndex → latest position sample for the clip playing there. */
  positions: Map<number, ClipPositionSample>;
  /**
   * trackIndex → sceneIndex the user just clicked but Ableton hasn't
   * confirmed playing yet. Mirrors Ableton's own "blinking play" cue
   * for clips that are queued behind a launch-quantize boundary. Cleared
   * the moment a playing-slot push arrives for that track.
   */
  pendingClips: Map<number, number>;

  setStatus: (
    status: AbletonConnectionStatus,
    host: string,
    port: number,
    version?: string,
    error?: string
  ) => void;
  setSnapshot: (snapshot: AbletonSnapshot) => void;
  setPlayingSlot: (trackIndex: number, slot: number) => void;
  applyTransportPatch: (patch: Partial<AbletonTransport>) => void;
  setClipPosition: (sample: ClipPositionSample & { trackIndex: number }) => void;
  markPending: (trackIndex: number, sceneIndex: number) => void;
  clearPending: (trackIndex: number) => void;
}

const DEFAULT_TRANSPORT: AbletonTransport = {
  tempo: 120,
  isPlaying: false,
  metronome: false,
  sigNum: 4,
  sigDen: 4,
  songBeat: 0,
  lastUpdateTs: 0,
};

export const useAbletonStore = create<AbletonStore>((set) => ({
  status: "disconnected",
  host: "127.0.0.1",
  port: 11000,
  snapshot: null,
  transport: null,
  positions: new Map(),
  pendingClips: new Map(),

  setStatus: (status, host, port, version, error) =>
    set({ status, host, port, version, error }),

  setSnapshot: (snapshot) =>
    set((s) => {
      // Only wipe the position cache when the snapshot is materially
      // different (track count changed). The broker re-publishes the
      // current snapshot to every new SSE subscriber (and on every
      // reconnect handshake), so unconditionally clearing positions
      // would blank the clip progress bars every time a new browser
      // tab opens or the connection blips.
      const prev = s.snapshot;
      const trackShapeChanged = !prev || prev.numTracks !== snapshot.numTracks;
      return {
        // Strip transport off the snapshot before storing — it lives
        // in its own top-level field. Wire shape is unchanged.
        snapshot,
        transport: snapshot.transport ?? null,
        positions: trackShapeChanged ? new Map() : s.positions,
      };
    }),

  setPlayingSlot: (trackIndex, slot) =>
    set((s) => {
      if (!s.snapshot) return s;
      const track = s.snapshot.tracks[trackIndex];
      if (!track) return s;
      const tracks = [...s.snapshot.tracks];
      tracks[trackIndex] = { ...track, playingSlotIndex: slot };
      // Drop the stale position sample for this track — the new clip's
      // own playing_position push will refill it; an empty slot stays
      // empty until then so the progress bar doesn't ghost the old clip.
      const positions = new Map(s.positions);
      positions.delete(trackIndex);
      // Any playing-slot push for this track resolves whatever was
      // pending on it (either the queued clip actually started, or
      // another action overrode it). Either way the blinking "pending"
      // cue should go away.
      let pendingClips = s.pendingClips;
      if (pendingClips.has(trackIndex)) {
        pendingClips = new Map(pendingClips);
        pendingClips.delete(trackIndex);
      }
      return { snapshot: { ...s.snapshot, tracks }, positions, pendingClips };
    }),

  applyTransportPatch: (patch) =>
    set((s) => {
      // Defensive: a stale broker (pre-V2) may have published a snapshot
      // without a transport field. Merge over a baseline so the page
      // doesn't crash before the next full snapshot arrives.
      const base = s.transport ?? DEFAULT_TRANSPORT;
      return { transport: { ...base, ...patch } };
    }),

  setClipPosition: ({ trackIndex, clipIndex, position, ts }) =>
    set((s) => {
      const positions = new Map(s.positions);
      positions.set(trackIndex, { clipIndex, position, ts });
      return { positions };
    }),

  markPending: (trackIndex, sceneIndex) =>
    set((s) => {
      // Skip the map allocation if the same clip is already pending —
      // happens when a user spam-clicks the same cell waiting for the
      // quantize boundary.
      if (s.pendingClips.get(trackIndex) === sceneIndex) return s;
      const pendingClips = new Map(s.pendingClips);
      pendingClips.set(trackIndex, sceneIndex);
      return { pendingClips };
    }),

  clearPending: (trackIndex) =>
    set((s) => {
      if (!s.pendingClips.has(trackIndex)) return s;
      const pendingClips = new Map(s.pendingClips);
      pendingClips.delete(trackIndex);
      return { pendingClips };
    }),
}));
