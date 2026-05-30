import { create } from "zustand";
import type {
  ObsAudioInput,
  ObsConnectionStatus,
  ObsRecordStatus,
  ObsReplayBufferStatus,
  ObsScene,
  ObsSceneItem,
  ObsSceneItemTransform,
  ObsSnapshot,
  ObsStats,
  ObsStreamStatus,
  ObsTransition,
  ObsVideoSettings,
  ObsVirtualCamStatus,
} from "@/lib/obs/types";

/**
 * Mirror of the OBS broker's state on the client. The SSE hook
 * (`use-obs-events`) calls into this store on every event; pages
 * subscribe with selectors so they only re-render on relevant slices.
 *
 * Stats lives at the top level (not inside `snapshot`) so the 1.5 Hz
 * stats push doesn't invalidate the whole snapshot reference and force
 * the scene grid to re-mount.
 */
interface ObsStore {
  status: ObsConnectionStatus;
  host: string;
  port: number;
  obsVersion?: string;
  obsWebSocketVersion?: string;
  error?: string;

  snapshot: ObsSnapshot | null;
  stats: ObsStats | null;
  /** Last saved replay file path — surfaces a brief toast in the UI. */
  lastReplayPath: string | null;
  /** inputName → per-channel dB levels [mag, peak, peakHold]. Updated
   *  at ~60 Hz when the audio mixer panel is mounted (and therefore
   *  subscribed to InputVolumeMeters). */
  volumeLevels: Record<string, Array<[number, number, number]>>;
  /** inputName → { videoActive, videoShowing }. Drives the "live" badge
   *  on inspector items. */
  inputActive: Record<string, { videoActive: boolean; videoShowing: boolean }>;
  /** True once OBS told us it's exiting — UI greys out before the
   *  reconnect attempt fails. */
  exiting: boolean;

  setStatus: (
    status: ObsConnectionStatus,
    host: string,
    port: number,
    obsVersion?: string,
    obsWebSocketVersion?: string,
    error?: string
  ) => void;
  setSnapshot: (snapshot: ObsSnapshot) => void;
  setScenes: (scenes: ObsScene[]) => void;
  setProgramScene: (name: string | null) => void;
  setPreviewScene: (name: string | null) => void;
  setStudioMode: (enabled: boolean) => void;
  setSceneItems: (sceneName: string, items: ObsSceneItem[]) => void;
  patchSceneItemEnabled: (
    sceneName: string,
    sceneItemId: number,
    enabled: boolean
  ) => void;
  patchSceneItemLocked: (
    sceneName: string,
    sceneItemId: number,
    locked: boolean
  ) => void;
  patchSceneItemTransform: (
    sceneName: string,
    sceneItemId: number,
    transform: ObsSceneItemTransform
  ) => void;
  setInputs: (inputs: ObsSnapshot["inputs"]) => void;
  patchAudio: (inputName: string, patch: Partial<ObsAudioInput>) => void;
  setTransitions: (transitions: ObsTransition[]) => void;
  setCurrentTransition: (name: string | null, duration: number) => void;
  setTransitionDuration: (duration: number) => void;
  setStream: (status: ObsStreamStatus) => void;
  setRecord: (status: ObsRecordStatus) => void;
  setReplayBuffer: (status: ObsReplayBufferStatus) => void;
  setVirtualCam: (status: ObsVirtualCamStatus) => void;
  setLastReplayPath: (path: string) => void;
  setStats: (stats: ObsStats) => void;
  setVideo: (video: ObsVideoSettings) => void;
  setProfiles: (profiles: string[]) => void;
  setCurrentProfile: (name: string | null) => void;
  setSceneCollections: (collections: string[]) => void;
  setCurrentSceneCollection: (name: string | null) => void;
  setVolumeLevels: (
    levels: Array<{
      inputName: string;
      levels: Array<[number, number, number]>;
    }>
  ) => void;
  setInputActive: (
    inputName: string,
    patch: { videoActive?: boolean; videoShowing?: boolean }
  ) => void;
  markExiting: () => void;
}

export const useObsStore = create<ObsStore>((set) => ({
  status: "disconnected",
  host: "127.0.0.1",
  port: 4455,
  snapshot: null,
  stats: null,
  lastReplayPath: null,
  volumeLevels: {},
  inputActive: {},
  exiting: false,

  setStatus: (status, host, port, obsVersion, obsWebSocketVersion, error) =>
    set({ status, host, port, obsVersion, obsWebSocketVersion, error }),

  setSnapshot: (snapshot) =>
    set({ snapshot, stats: snapshot.stats }),

  setScenes: (scenes) =>
    set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, scenes } } : {})),

  setProgramScene: (name) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, currentProgramSceneName: name } }
        : {}
    ),

  setPreviewScene: (name) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, currentPreviewSceneName: name } }
        : {}
    ),

  setStudioMode: (enabled) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, studioModeEnabled: enabled } }
        : {}
    ),

  setSceneItems: (sceneName, items) =>
    set((s) =>
      s.snapshot
        ? {
            snapshot: {
              ...s.snapshot,
              sceneItemsByScene: {
                ...s.snapshot.sceneItemsByScene,
                [sceneName]: items,
              },
            },
          }
        : {}
    ),

  patchSceneItemEnabled: (sceneName, sceneItemId, enabled) =>
    set((s) => {
      if (!s.snapshot) return {};
      const cur = s.snapshot.sceneItemsByScene[sceneName];
      if (!cur) return {};
      return {
        snapshot: {
          ...s.snapshot,
          sceneItemsByScene: {
            ...s.snapshot.sceneItemsByScene,
            [sceneName]: cur.map((it) =>
              it.sceneItemId === sceneItemId
                ? { ...it, sceneItemEnabled: enabled }
                : it
            ),
          },
        },
      };
    }),

  patchSceneItemLocked: (sceneName, sceneItemId, locked) =>
    set((s) => {
      if (!s.snapshot) return {};
      const cur = s.snapshot.sceneItemsByScene[sceneName];
      if (!cur) return {};
      return {
        snapshot: {
          ...s.snapshot,
          sceneItemsByScene: {
            ...s.snapshot.sceneItemsByScene,
            [sceneName]: cur.map((it) =>
              it.sceneItemId === sceneItemId
                ? { ...it, sceneItemLocked: locked }
                : it
            ),
          },
        },
      };
    }),

  patchSceneItemTransform: (sceneName, sceneItemId, transform) =>
    set((s) => {
      if (!s.snapshot) return {};
      const cur = s.snapshot.sceneItemsByScene[sceneName];
      if (!cur) return {};
      return {
        snapshot: {
          ...s.snapshot,
          sceneItemsByScene: {
            ...s.snapshot.sceneItemsByScene,
            [sceneName]: cur.map((it) =>
              it.sceneItemId === sceneItemId ? { ...it, transform } : it
            ),
          },
        },
      };
    }),

  setInputs: (inputs) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, inputs } } : {}
    ),

  patchAudio: (inputName, patch) =>
    set((s) => {
      if (!s.snapshot) return {};
      const cur = s.snapshot.audioByInput[inputName];
      if (!cur) return {};
      return {
        snapshot: {
          ...s.snapshot,
          audioByInput: {
            ...s.snapshot.audioByInput,
            [inputName]: { ...cur, ...patch },
          },
        },
      };
    }),

  setTransitions: (transitions) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, transitions } } : {}
    ),

  setCurrentTransition: (name, duration) =>
    set((s) =>
      s.snapshot
        ? {
            snapshot: {
              ...s.snapshot,
              currentTransitionName: name,
              currentTransitionDuration: duration,
            },
          }
        : {}
    ),

  setTransitionDuration: (duration) =>
    set((s) =>
      s.snapshot
        ? {
            snapshot: { ...s.snapshot, currentTransitionDuration: duration },
          }
        : {}
    ),

  setStream: (status) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, stream: status } } : {}
    ),
  setRecord: (status) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, record: status } } : {}
    ),
  setReplayBuffer: (status) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, replayBuffer: status } } : {}
    ),
  setVirtualCam: (status) =>
    set((s) =>
      s.snapshot ? { snapshot: { ...s.snapshot, virtualCam: status } } : {}
    ),
  setLastReplayPath: (path) => set({ lastReplayPath: path }),

  setStats: (stats) => set({ stats }),

  setVideo: (video) =>
    set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, video } } : {})),

  setProfiles: (profiles) =>
    set((s) => (s.snapshot ? { snapshot: { ...s.snapshot, profiles } } : {})),
  setCurrentProfile: (name) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, currentProfile: name } }
        : {}
    ),
  setSceneCollections: (collections) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, sceneCollections: collections } }
        : {}
    ),
  setCurrentSceneCollection: (name) =>
    set((s) =>
      s.snapshot
        ? { snapshot: { ...s.snapshot, currentSceneCollection: name } }
        : {}
    ),

  setVolumeLevels: (levels) =>
    set(() => {
      // Replace the whole map every tick — the event already lists
      // every audio input. This keeps GC cheap (one allocation per
      // tick rather than per input).
      const next: Record<string, Array<[number, number, number]>> = {};
      for (const l of levels) next[l.inputName] = l.levels;
      return { volumeLevels: next };
    }),

  setInputActive: (inputName, patch) =>
    set((s) => ({
      inputActive: {
        ...s.inputActive,
        [inputName]: {
          videoActive:
            patch.videoActive ??
            s.inputActive[inputName]?.videoActive ??
            false,
          videoShowing:
            patch.videoShowing ??
            s.inputActive[inputName]?.videoShowing ??
            false,
        },
      },
    })),

  markExiting: () => set({ exiting: true }),
}));
