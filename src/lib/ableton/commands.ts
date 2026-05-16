import type { OscMessage } from "./osc-codec";

/**
 * Typed builders for the OSC addresses we send. Kept as pure functions
 * so they're trivially testable and so the broker stays the only thing
 * that touches the UDP socket.
 *
 * AbletonOSC quirks worth remembering:
 *   • Volume/pan ranges are 0.0–1.0, NOT 0.0–127.
 *   • Track/clip indices are 0-based.
 *   • Replies come back at the matching `get/` address.
 */

export const getVersion = (): OscMessage => ({
  address: "/live/application/get/version",
  args: [],
});

// ─── Session metadata ─────────────────────────────────────────────

export const getNumTracks = (): OscMessage => ({
  address: "/live/song/get/num_tracks",
  args: [],
});

export const getNumScenes = (): OscMessage => ({
  address: "/live/song/get/num_scenes",
  args: [],
});

export const getTrackNames = (): OscMessage => ({
  address: "/live/song/get/track_names",
  args: [],
});

/**
 * Bulk query: per-clip-slot booleans whether a clip is present. Returns
 * one int per slot, in row-major order (track, scene). AbletonOSC also
 * supports per-property bulk fetch via /live/song/get/track_data with
 * a list of property names — that's what we use for clip names/colors.
 */
export const getTrackData = (
  startTrack: number,
  endTrack: number,
  properties: string[]
): OscMessage => ({
  address: "/live/song/get/track_data",
  args: [startTrack, endTrack, ...properties],
});

export const getSceneName = (sceneIndex: number): OscMessage => ({
  address: "/live/scene/get/name",
  args: [sceneIndex],
});

// ─── Clip slot triggering (the launchpad core) ─────────────────────

export const fireClip = (
  trackIndex: number,
  sceneIndex: number
): OscMessage => ({
  address: "/live/clip_slot/fire",
  args: [trackIndex, sceneIndex],
});

export const stopTrack = (trackIndex: number): OscMessage => ({
  address: "/live/track/stop_all_clips",
  args: [trackIndex],
});

export const stopAllClips = (): OscMessage => ({
  address: "/live/song/stop_all_clips",
  args: [],
});

// ─── Transport ─────────────────────────────────────────────────────

export const playTransport = (): OscMessage => ({
  address: "/live/song/start_playing",
  args: [],
});
export const stopTransport = (): OscMessage => ({
  address: "/live/song/stop_playing",
  args: [],
});
export const continueTransport = (): OscMessage => ({
  address: "/live/song/continue_playing",
  args: [],
});
export const tapTempo = (): OscMessage => ({
  address: "/live/song/tap_tempo",
  args: [],
});
export const setTempo = (bpm: number): OscMessage => ({
  address: "/live/song/set/tempo",
  args: [bpm],
});
export const setMetronome = (on: boolean): OscMessage => ({
  address: "/live/song/set/metronome",
  args: [on ? 1 : 0],
});

export const getTempo = (): OscMessage => ({
  address: "/live/song/get/tempo",
  args: [],
});
export const getIsPlaying = (): OscMessage => ({
  address: "/live/song/get/is_playing",
  args: [],
});
export const getMetronome = (): OscMessage => ({
  address: "/live/song/get/metronome",
  args: [],
});
export const getSigNum = (): OscMessage => ({
  address: "/live/song/get/signature_numerator",
  args: [],
});
export const getSigDen = (): OscMessage => ({
  address: "/live/song/get/signature_denominator",
  args: [],
});
export const getCurrentSongTime = (): OscMessage => ({
  address: "/live/song/get/current_song_time",
  args: [],
});

// ─── Subscriptions ────────────────────────────────────────────────

/** Subscribe to "which clip is playing on this track right now". */
export const listenPlayingSlot = (trackIndex: number): OscMessage => ({
  address: "/live/track/start_listen/playing_slot_index",
  args: [trackIndex],
});

export const unlistenPlayingSlot = (trackIndex: number): OscMessage => ({
  address: "/live/track/stop_listen/playing_slot_index",
  args: [trackIndex],
});

export const listenTempo = (): OscMessage => ({
  address: "/live/song/start_listen/tempo",
  args: [],
});
export const unlistenTempo = (): OscMessage => ({
  address: "/live/song/stop_listen/tempo",
  args: [],
});
export const listenIsPlaying = (): OscMessage => ({
  address: "/live/song/start_listen/is_playing",
  args: [],
});
export const unlistenIsPlaying = (): OscMessage => ({
  address: "/live/song/stop_listen/is_playing",
  args: [],
});
export const listenMetronome = (): OscMessage => ({
  address: "/live/song/start_listen/metronome",
  args: [],
});
export const unlistenMetronome = (): OscMessage => ({
  address: "/live/song/stop_listen/metronome",
  args: [],
});
/**
 * Per-clip playing position listener. AbletonOSC pushes a float
 * (position in beats) whenever the position advances meaningfully.
 * We only subscribe to the clip currently playing on each track —
 * never every clip — to keep the UDP traffic bounded.
 */
export const listenClipPosition = (
  trackIndex: number,
  clipIndex: number
): OscMessage => ({
  address: "/live/clip/start_listen/playing_position",
  args: [trackIndex, clipIndex],
});
export const unlistenClipPosition = (
  trackIndex: number,
  clipIndex: number
): OscMessage => ({
  address: "/live/clip/stop_listen/playing_position",
  args: [trackIndex, clipIndex],
});
