/**
 * Snapshot of the Ableton session as observed via AbletonOSC. Reflects
 * only what the clip-launchpad UI needs — extend as more screens land.
 */

export interface AbletonClip {
  /** Display name from /live/clip/get/name. Empty string for unnamed clips. */
  name: string;
  /** Raw 32-bit RGB color (from /live/clip/get/color). */
  color: number;
  /** Loop length in beats (from /live/clip/get/length). 0 if unknown. */
  length: number;
}

export interface AbletonClipSlot {
  /** True if the slot contains a clip (or a stop button on group tracks). */
  hasClip: boolean;
  /** Populated when hasClip is true. */
  clip?: AbletonClip;
}

export interface AbletonTrack {
  index: number;
  name: string;
  /** Index of the slot currently playing (-1 = none). Pushed by Ableton. */
  playingSlotIndex: number;
  /** track_data returns has_clip flags per slot, indexed by scene. */
  slots: AbletonClipSlot[];
}

export interface AbletonScene {
  index: number;
  name: string;
}

export interface AbletonTransport {
  /** BPM. */
  tempo: number;
  /** True when arrangement / session transport is rolling. */
  isPlaying: boolean;
  /** Metronome enabled. */
  metronome: boolean;
  /** Time signature numerator (e.g. 4 in 4/4). */
  sigNum: number;
  /** Time signature denominator (e.g. 4 in 4/4). */
  sigDen: number;
  /**
   * Last reported song position, in beats. Use together with `tempo` and
   * `lastUpdateTs` to interpolate forward smoothly via rAF on the client.
   */
  songBeat: number;
  /** Wall-clock ms when `songBeat` was last refreshed. */
  lastUpdateTs: number;
}

export interface AbletonSnapshot {
  numTracks: number;
  numScenes: number;
  tracks: AbletonTrack[];
  scenes: AbletonScene[];
  transport: AbletonTransport;
  /** Live version string from /live/application/get/version, if known. */
  version?: string;
}

export type AbletonConnectionStatus = "connected" | "disconnected" | "connecting";

/** Discriminated union pushed over SSE to clients. */
export type AbletonEvent =
  | {
      type: "status";
      status: AbletonConnectionStatus;
      host: string;
      port: number;
      version?: string;
      error?: string;
    }
  | { type: "snapshot"; snapshot: AbletonSnapshot }
  | {
      type: "playing-slot";
      trackIndex: number;
      playingSlotIndex: number;
    }
  | {
      type: "transport";
      /** Partial update — only fields that changed. */
      patch: Partial<AbletonTransport>;
      /** Server timestamp for songBeat updates so clients can interpolate. */
      ts: number;
    }
  | {
      type: "clip-position";
      trackIndex: number;
      clipIndex: number;
      /** Position in beats. */
      position: number;
      ts: number;
    };
