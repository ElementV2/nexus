"use client";

import { useCallback } from "react";
import { useConnections } from "./use-connections";
import {
  useConnectionCommand,
  useConnectionId,
} from "./use-connection-command";

/**
 * POST a command to the OBS broker. Resolves the first enabled
 * connection of kind="obs" and forwards via the generic
 * `/api/connections/:id/command` endpoint. Same `{ ok, data | error }`
 * envelope the legacy hook returned so component call sites don't
 * change shape.
 */
export type ObsCommand =
  | { action: "set-program-scene"; sceneName: string }
  | { action: "set-preview-scene"; sceneName: string }
  | { action: "trigger-studio-transition" }
  | { action: "set-studio-mode"; enabled: boolean }
  | { action: "set-current-transition"; name: string }
  | { action: "set-transition-duration"; ms: number }
  | { action: "toggle-stream" }
  | { action: "start-stream" }
  | { action: "stop-stream" }
  | { action: "toggle-record" }
  | { action: "start-record" }
  | { action: "stop-record" }
  | { action: "pause-record" }
  | { action: "resume-record" }
  | { action: "toggle-replay-buffer" }
  | { action: "save-replay-buffer" }
  | { action: "toggle-virtual-cam" }
  | { action: "set-mute"; inputName: string; muted: boolean }
  | { action: "toggle-mute"; inputName: string }
  | {
      action: "set-volume";
      inputName: string;
      volumeMul?: number;
      volumeDb?: number;
    }
  | { action: "set-balance"; inputName: string; balance: number }
  | { action: "set-sync-offset"; inputName: string; ms: number }
  | { action: "set-monitor-type"; inputName: string; monitorType: string }
  | {
      action: "set-scene-item-enabled";
      sceneName: string;
      sceneItemId: number;
      enabled: boolean;
    }
  | {
      action: "set-scene-item-locked";
      sceneName: string;
      sceneItemId: number;
      locked: boolean;
    }
  | { action: "ensure-scene-items"; sceneName: string }
  | { action: "trigger-media"; inputName: string; mediaAction: string }
  | { action: "set-media-cursor"; inputName: string; cursorMs: number }
  | { action: "trigger-hotkey"; name: string }
  | { action: "set-profile"; name: string }
  | { action: "set-scene-collection"; name: string }
  | { action: "set-meters-enabled"; enabled: boolean }
  | { action: "set-tbar"; position: number; release?: boolean }
  | {
      action: "set-transition-override";
      sceneName: string;
      transitionName: string | null;
      transitionDuration: number | null;
    }
  | { action: "get-transition-override"; sceneName: string }
  | { action: "get-record-directory" }
  | { action: "set-record-directory"; recordDirectory: string }
  | { action: "split-record-file" }
  | { action: "create-record-chapter"; chapterName?: string }
  | { action: "send-caption"; text: string }
  | { action: "get-stream-service-settings" }
  | {
      action: "set-stream-service-settings";
      streamServiceType: string;
      streamServiceSettings: Record<string, unknown>;
    }
  | { action: "get-output-list" }
  | { action: "start-output"; outputName: string }
  | { action: "stop-output"; outputName: string }
  | { action: "toggle-output"; outputName: string }
  | { action: "get-output-settings"; outputName: string }
  | {
      action: "set-output-settings";
      outputName: string;
      outputSettings: Record<string, unknown>;
    }
  | { action: "get-source-active"; sourceName: string }
  | { action: "refresh-browser-source"; inputName: string }
  | {
      action: "press-input-button";
      inputName: string;
      propertyName: string;
    }
  | { action: "create-scene"; sceneName: string }
  | { action: "remove-scene"; sceneName: string }
  | { action: "rename-scene"; sceneName: string; newSceneName: string }
  | {
      action: "create-scene-item";
      sceneName: string;
      sourceName: string;
      enabled?: boolean;
    }
  | { action: "remove-scene-item"; sceneName: string; sceneItemId: number }
  | {
      action: "duplicate-scene-item";
      sceneName: string;
      sceneItemId: number;
      destinationSceneName?: string;
    }
  | {
      action: "set-scene-item-index";
      sceneName: string;
      sceneItemId: number;
      sceneItemIndex: number;
    }
  | {
      action: "set-scene-item-blend-mode";
      sceneName: string;
      sceneItemId: number;
      sceneItemBlendMode: string;
    }
  | {
      action: "set-scene-item-transform";
      sceneName: string;
      sceneItemId: number;
      sceneItemTransform: Record<string, unknown>;
    }
  | {
      action: "create-input";
      sceneName: string;
      inputName: string;
      inputKind: string;
      inputSettings?: Record<string, unknown>;
      enabled?: boolean;
    }
  | { action: "remove-input"; inputName: string }
  | { action: "rename-input"; inputName: string; newInputName: string }
  | { action: "get-input-settings"; inputName: string }
  | {
      action: "set-input-settings";
      inputName: string;
      inputSettings: Record<string, unknown>;
      overlay?: boolean;
    }
  | { action: "get-input-kind-list"; unversioned?: boolean }
  | { action: "get-special-inputs" }
  | {
      action: "create-filter";
      sourceName: string;
      filterName: string;
      filterKind: string;
      filterSettings?: Record<string, unknown>;
    }
  | { action: "remove-filter"; sourceName: string; filterName: string }
  | {
      action: "set-filter-index";
      sourceName: string;
      filterName: string;
      filterIndex: number;
    }
  | {
      action: "set-filter-settings";
      sourceName: string;
      filterName: string;
      filterSettings: Record<string, unknown>;
      overlay?: boolean;
    }
  | {
      action: "rename-filter";
      sourceName: string;
      filterName: string;
      newFilterName: string;
    }
  | { action: "get-filter-kinds" }
  | { action: "get-filter-defaults"; filterKind: string }
  | { action: "get-last-replay" }
  | { action: "get-monitor-list" }
  | { action: "get-profile-parameter"; category: string; name: string }
  | {
      action: "set-profile-parameter";
      category: string;
      name: string;
      value: string;
    }
  | {
      action: "call-vendor";
      vendorName: string;
      requestType: string;
      requestData?: Record<string, unknown>;
    }
  | { action: "broadcast"; eventData: Record<string, unknown> }
  | {
      action: "raw";
      requestType: string;
      requestData?: Record<string, unknown>;
    };

export function useObsCommand() {
  const { data: connectionsData } = useConnections();
  const obsId = useConnectionId(
    connectionsData?.connections ?? null,
    "obs",
    connectionsData?.defaults
  );
  const send = useConnectionCommand(obsId);

  return useCallback(
    async (cmd: ObsCommand) => {
      // Per-command logging (success + failure) is centralized in
      // useConnectionCommand so every kind logs uniformly — no per-hook
      // console line needed here (it would double-log on the Logs page).
      return await send(cmd);
    },
    [send]
  );
}
