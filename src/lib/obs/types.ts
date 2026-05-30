/**
 * Types for the OBS WebSocket v5 integration. Mirrors the broker's
 * internal model — the server fetches the full snapshot once and then
 * applies incremental events; the client subscribes to deltas via SSE.
 *
 * The shapes here are intentionally trimmed down from the raw OBS
 * payloads to what the UI actually consumes. Anything not used by a
 * component stays out of the snapshot so SSE messages don't blow up.
 */

// ────────────────────────── Connection status ─────────────────────────

export type ObsConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected";

// ────────────────────────── Scenes / items ────────────────────────────

export interface ObsScene {
  /** Scene UUID — stable across renames. */
  uuid: string;
  /** Display name. Acts as the natural key for most OBS API calls. */
  name: string;
  /** Sort index in OBS's scene panel. */
  index: number;
}

export interface ObsSceneItem {
  sceneItemId: number;
  sourceName: string;
  sourceUuid?: string;
  /** Sort order within the scene (top of list = drawn last = on top). */
  sceneItemIndex: number;
  sceneItemEnabled: boolean;
  sceneItemLocked: boolean;
  /** Optional input kind for items backed by an input source — useful for
   *  the UI to pick the right icon (text, browser, media, capture). */
  inputKind: string | null;
  isGroup: boolean;
  transform?: ObsSceneItemTransform;
}

export interface ObsSceneItemTransform {
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  alignment: number;
  boundsAlignment: number;
  boundsType: string;
  boundsWidth: number;
  boundsHeight: number;
}

// ────────────────────────── Inputs / audio ────────────────────────────

export interface ObsInput {
  inputName: string;
  inputUuid?: string;
  inputKind: string;
  unversionedInputKind: string;
}

export interface ObsAudioInput {
  inputName: string;
  inputUuid?: string;
  muted: boolean;
  /** Linear gain 0..1 (OBS calls this `inputVolumeMul`). */
  volume: number;
  /** dB representation (OBS reports this directly). */
  volumeDb: number;
  /** -1..1 stereo balance. */
  balance: number;
  /** Milliseconds offset applied to the audio stream. */
  syncOffsetMs: number;
  /** Bitmask over the 6 audio tracks (1=enabled). */
  trackBitmask: number;
  /** `none` | `monitorOnly` | `monitorAndOutput`. */
  monitorType: string;
}

// ────────────────────────── Transitions ───────────────────────────────

export interface ObsTransition {
  transitionName: string;
  transitionKind: string;
  transitionUuid?: string;
  transitionConfigurable: boolean;
  transitionFixed: boolean;
}

// ────────────────────────── Outputs (stream/rec/replay/vcam) ──────────

export interface ObsStreamStatus {
  active: boolean;
  reconnecting: boolean;
  /** Milliseconds since start. */
  timecodeMs: number;
  bytesSent: number;
  skippedFrames: number;
  totalFrames: number;
}

export interface ObsRecordStatus {
  active: boolean;
  paused: boolean;
  timecodeMs: number;
  bytes: number;
}

export interface ObsReplayBufferStatus {
  active: boolean;
}

export interface ObsVirtualCamStatus {
  active: boolean;
}

// ────────────────────────── Stats ─────────────────────────────────────

export interface ObsStats {
  /** 0..100 */
  cpuUsage: number;
  /** MB */
  memoryUsage: number;
  /** GB */
  availableDiskSpace: number;
  activeFps: number;
  averageFrameRenderTime: number;
  renderSkippedFrames: number;
  renderTotalFrames: number;
  outputSkippedFrames: number;
  outputTotalFrames: number;
  websocketIncomingMessages: number;
  websocketOutgoingMessages: number;
}

// ────────────────────────── Video / profile ───────────────────────────

export interface ObsVideoSettings {
  fpsNumerator: number;
  fpsDenominator: number;
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
}

// ────────────────────────── Snapshot ──────────────────────────────────

export interface ObsSnapshot {
  obsVersion: string;
  obsWebSocketVersion: string;
  platform: string;
  rpcVersion: number;

  scenes: ObsScene[];
  /** Keyed by scene name. Lazy — filled when the user opens a scene. */
  sceneItemsByScene: Record<string, ObsSceneItem[]>;

  currentProgramSceneName: string | null;
  currentPreviewSceneName: string | null;
  studioModeEnabled: boolean;

  inputs: ObsInput[];
  /** Keyed by input name. Only audio-capable inputs appear here. */
  audioByInput: Record<string, ObsAudioInput>;

  transitions: ObsTransition[];
  currentTransitionName: string | null;
  currentTransitionDuration: number;

  stream: ObsStreamStatus;
  record: ObsRecordStatus;
  replayBuffer: ObsReplayBufferStatus;
  virtualCam: ObsVirtualCamStatus;

  stats: ObsStats;
  video: ObsVideoSettings | null;

  profiles: string[];
  currentProfile: string | null;
  sceneCollections: string[];
  currentSceneCollection: string | null;
}

// ────────────────────────── Broker events (SSE) ───────────────────────

export type ObsEvent =
  | {
      type: "status";
      status: ObsConnectionStatus;
      host: string;
      port: number;
      obsVersion?: string;
      obsWebSocketVersion?: string;
      error?: string;
    }
  | { type: "snapshot"; snapshot: ObsSnapshot }
  | { type: "scenes-changed"; scenes: ObsScene[] }
  | { type: "program-scene-changed"; sceneName: string | null }
  | { type: "preview-scene-changed"; sceneName: string | null }
  | { type: "studio-mode-changed"; enabled: boolean }
  | {
      type: "scene-items-changed";
      sceneName: string;
      items: ObsSceneItem[];
    }
  | {
      type: "scene-item-enabled";
      sceneName: string;
      sceneItemId: number;
      enabled: boolean;
    }
  | {
      type: "scene-item-locked";
      sceneName: string;
      sceneItemId: number;
      locked: boolean;
    }
  | {
      type: "scene-item-transform";
      sceneName: string;
      sceneItemId: number;
      transform: ObsSceneItemTransform;
    }
  | { type: "input-list-changed"; inputs: ObsInput[] }
  | { type: "input-mute"; inputName: string; muted: boolean }
  | {
      type: "input-volume";
      inputName: string;
      volume: number;
      volumeDb: number;
    }
  | { type: "input-balance"; inputName: string; balance: number }
  | { type: "input-sync-offset"; inputName: string; syncOffsetMs: number }
  | { type: "input-monitor-type"; inputName: string; monitorType: string }
  | { type: "input-tracks"; inputName: string; trackBitmask: number }
  | { type: "transitions-changed"; transitions: ObsTransition[] }
  | { type: "current-transition"; name: string | null; duration: number }
  | { type: "transition-duration"; duration: number }
  | { type: "stream-state"; status: ObsStreamStatus }
  | { type: "record-state"; status: ObsRecordStatus }
  | { type: "replay-buffer-state"; status: ObsReplayBufferStatus }
  | { type: "virtual-cam-state"; status: ObsVirtualCamStatus }
  | { type: "replay-buffer-saved"; path: string }
  | { type: "stats"; stats: ObsStats }
  | { type: "video-settings"; video: ObsVideoSettings }
  | {
      type: "media-state";
      inputName: string;
      state: string;
      durationMs?: number;
      cursorMs?: number;
    }
  | { type: "profiles-changed"; profiles: string[] }
  | { type: "current-profile"; name: string | null }
  | { type: "scene-collections-changed"; collections: string[] }
  | { type: "current-scene-collection"; name: string | null }
  /** Volume meters fire at ~60 Hz when InputVolumeMeters is subscribed.
   *  Levels are per-channel (typically 1 stereo pair) of dB triplets:
   *  [magnitude, peak, peakHold]. */
  | {
      type: "volume-meters";
      inputs: Array<{
        inputName: string;
        levels: Array<[number, number, number]>;
      }>;
    }
  /** Push fired when an input's PGM/PVW render state changes — useful to
   *  badge "live" or "armed" in the inspector. */
  | {
      type: "input-active";
      inputName: string;
      videoActive: boolean;
      videoShowing: boolean;
    }
  /** OBS told us it's quitting — let the UI grey out the page rather
   *  than wait for the reconnect backoff to expose the disconnect. */
  | { type: "exit-started" };
