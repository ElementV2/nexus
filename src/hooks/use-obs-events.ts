"use client";

import { useCallback } from "react";
import { useObsStore } from "@/stores/obs-store";
import { useConnections } from "./use-connections";
import { useConnectionEvents } from "./use-connection-events";
import { useConnectionId } from "./use-connection-command";
import type { ObsEvent } from "@/lib/obs/types";

/**
 * Subscribe to the OBS broker via the generic connections SSE stream.
 * The hook resolves the first enabled connection of kind="obs" and
 * subscribes through `/api/connections/:id/events`. Meta envelopes
 * (`__status`, `__snapshot`) emitted by the connection manager are
 * ignored — the underlying broker already replays its own status and
 * snapshot events on subscribe, which carry richer payloads (host,
 * port, OBS version) that the store needs.
 */
export function useObsEvents() {
  const setStatus = useObsStore((s) => s.setStatus);
  const setSnapshot = useObsStore((s) => s.setSnapshot);
  const setScenes = useObsStore((s) => s.setScenes);
  const setProgramScene = useObsStore((s) => s.setProgramScene);
  const setPreviewScene = useObsStore((s) => s.setPreviewScene);
  const setStudioMode = useObsStore((s) => s.setStudioMode);
  const setSceneItems = useObsStore((s) => s.setSceneItems);
  const patchSceneItemEnabled = useObsStore((s) => s.patchSceneItemEnabled);
  const patchSceneItemLocked = useObsStore((s) => s.patchSceneItemLocked);
  const patchSceneItemTransform = useObsStore(
    (s) => s.patchSceneItemTransform
  );
  const setInputs = useObsStore((s) => s.setInputs);
  const patchAudio = useObsStore((s) => s.patchAudio);
  const setCurrentTransition = useObsStore((s) => s.setCurrentTransition);
  const setTransitionDuration = useObsStore((s) => s.setTransitionDuration);
  const setStream = useObsStore((s) => s.setStream);
  const setRecord = useObsStore((s) => s.setRecord);
  const setReplayBuffer = useObsStore((s) => s.setReplayBuffer);
  const setVirtualCam = useObsStore((s) => s.setVirtualCam);
  const setLastReplayPath = useObsStore((s) => s.setLastReplayPath);
  const setStats = useObsStore((s) => s.setStats);
  const setVideo = useObsStore((s) => s.setVideo);
  const setProfiles = useObsStore((s) => s.setProfiles);
  const setCurrentProfile = useObsStore((s) => s.setCurrentProfile);
  const setSceneCollections = useObsStore((s) => s.setSceneCollections);
  const setCurrentSceneCollection = useObsStore(
    (s) => s.setCurrentSceneCollection
  );
  const setVolumeLevels = useObsStore((s) => s.setVolumeLevels);
  const setInputActive = useObsStore((s) => s.setInputActive);
  const markExiting = useObsStore((s) => s.markExiting);

  const { data: connectionsData } = useConnections();
  const obsId = useConnectionId(
    connectionsData?.connections ?? null,
    "obs",
    connectionsData?.defaults
  );

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let event: ObsEvent | { type: string };
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      // Skip manager meta events — the OBS broker replays its own
      // status/snapshot on subscribe with full payloads, which carry
      // host/port/version that the store needs and the meta envelope
      // doesn't have.
      if (event.type === "__status" || event.type === "__snapshot") return;
      const ev = event as ObsEvent;
      switch (ev.type) {
        case "status":
          setStatus(
            ev.status,
            ev.host,
            ev.port,
            ev.obsVersion,
            ev.obsWebSocketVersion,
            ev.error
          );
          break;
        case "snapshot":
          setSnapshot(ev.snapshot);
          break;
        case "scenes-changed":
          setScenes(ev.scenes);
          break;
        case "program-scene-changed":
          setProgramScene(ev.sceneName);
          break;
        case "preview-scene-changed":
          setPreviewScene(ev.sceneName);
          break;
        case "studio-mode-changed":
          setStudioMode(ev.enabled);
          break;
        case "scene-items-changed":
          setSceneItems(ev.sceneName, ev.items);
          break;
        case "scene-item-enabled":
          patchSceneItemEnabled(ev.sceneName, ev.sceneItemId, ev.enabled);
          break;
        case "scene-item-locked":
          patchSceneItemLocked(ev.sceneName, ev.sceneItemId, ev.locked);
          break;
        case "scene-item-transform":
          patchSceneItemTransform(
            ev.sceneName,
            ev.sceneItemId,
            ev.transform
          );
          break;
        case "input-list-changed":
          setInputs(ev.inputs);
          break;
        case "input-mute":
          patchAudio(ev.inputName, { muted: ev.muted });
          break;
        case "input-volume":
          patchAudio(ev.inputName, {
            volume: ev.volume,
            volumeDb: ev.volumeDb,
          });
          break;
        case "input-balance":
          patchAudio(ev.inputName, { balance: ev.balance });
          break;
        case "input-sync-offset":
          patchAudio(ev.inputName, { syncOffsetMs: ev.syncOffsetMs });
          break;
        case "input-monitor-type":
          patchAudio(ev.inputName, { monitorType: ev.monitorType });
          break;
        case "input-tracks":
          patchAudio(ev.inputName, { trackBitmask: ev.trackBitmask });
          break;
        case "current-transition":
          setCurrentTransition(ev.name, ev.duration);
          break;
        case "transition-duration":
          setTransitionDuration(ev.duration);
          break;
        case "stream-state":
          setStream(ev.status);
          break;
        case "record-state":
          setRecord(ev.status);
          break;
        case "replay-buffer-state":
          setReplayBuffer(ev.status);
          break;
        case "virtual-cam-state":
          setVirtualCam(ev.status);
          break;
        case "replay-buffer-saved":
          setLastReplayPath(ev.path);
          break;
        case "stats":
          setStats(ev.stats);
          break;
        case "video-settings":
          setVideo(ev.video);
          break;
        case "profiles-changed":
          setProfiles(ev.profiles);
          break;
        case "current-profile":
          setCurrentProfile(ev.name);
          break;
        case "scene-collections-changed":
          setSceneCollections(ev.collections);
          break;
        case "current-scene-collection":
          setCurrentSceneCollection(ev.name);
          break;
        case "volume-meters":
          setVolumeLevels(ev.inputs);
          break;
        case "input-active":
          setInputActive(ev.inputName, {
            videoActive: ev.videoActive,
            videoShowing: ev.videoShowing,
          });
          break;
        case "exit-started":
          markExiting();
          break;
      }
    },
    [
      setStatus,
      setSnapshot,
      setScenes,
      setProgramScene,
      setPreviewScene,
      setStudioMode,
      setSceneItems,
      patchSceneItemEnabled,
      patchSceneItemLocked,
      patchSceneItemTransform,
      setInputs,
      patchAudio,
      setCurrentTransition,
      setTransitionDuration,
      setStream,
      setRecord,
      setReplayBuffer,
      setVirtualCam,
      setLastReplayPath,
      setStats,
      setVideo,
      setProfiles,
      setCurrentProfile,
      setSceneCollections,
      setCurrentSceneCollection,
      setVolumeLevels,
      setInputActive,
      markExiting,
    ]
  );

  useConnectionEvents(obsId, onMessage);
}
