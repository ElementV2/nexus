import type {
  ActionDefinition,
  ActionOption,
} from "@/lib/core/types";

/**
 * Full catalog of OBS actions exposed to the action / preset browser.
 *
 * Goal: every operation reachable through the Nexus OBS pages — scene
 * routing, stream / record / replay / virtual cam, audio (mute / vol /
 * balance / sync / monitor), scene-item visibility / lock / transform,
 * scene CRUD, input CRUD, filter CRUD, outputs, hotkeys, T-bar,
 * transition overrides, record extras, stream caption, profile /
 * scene-collection switching, vendor requests — exists here so a
 * surface (Stream Deck, etc.) can drive it.
 *
 * Every entry produces a `{ action: "...", ... }` body matching the
 * adapter's `ACTIONS` dispatcher in `obs.ts`. Adding a new operation
 * = one entry here + (if not already mapped) one handler in `ACTIONS`.
 */

// ─────────────────────────── Option fragments ─────────────────────────

const inputNameOpt: ActionOption = {
  id: "inputName",
  type: "string",
  label: "Input name",
  placeholder: "Mic",
};
const sceneNameOpt: ActionOption = {
  id: "sceneName",
  type: "string",
  label: "Scene name",
  placeholder: "Scene",
};
const sourceNameOpt: ActionOption = {
  id: "sourceName",
  type: "string",
  label: "Source name",
  placeholder: "Source",
};
const filterNameOpt: ActionOption = {
  id: "filterName",
  type: "string",
  label: "Filter name",
  placeholder: "Filter",
};

// ─────────────────────────── Catalog ──────────────────────────────────

export const obsActions: ActionDefinition[] = [
  // ════════════════════════ Scenes ════════════════════════════════════
  {
    id: "set-program-scene",
    label: "Set program scene",
    category: "Scenes",
    options: [sceneNameOpt],
    toCommand: (o) => ({
      action: "set-program-scene",
      sceneName: String(o.sceneName ?? ""),
    }),
  },
  {
    id: "set-preview-scene",
    label: "Set preview scene",
    category: "Scenes",
    options: [sceneNameOpt],
    toCommand: (o) => ({
      action: "set-preview-scene",
      sceneName: String(o.sceneName ?? ""),
    }),
  },
  {
    id: "trigger-studio-transition",
    label: "Trigger studio transition",
    category: "Scenes",
    toCommand: () => ({ action: "trigger-studio-transition" }),
  },
  {
    id: "set-studio-mode",
    label: "Set studio mode",
    category: "Scenes",
    options: [{ id: "enabled", type: "boolean", label: "Enabled", default: true }],
    toCommand: (o) => ({
      action: "set-studio-mode",
      enabled: Boolean(o.enabled),
    }),
  },
  {
    id: "create-scene",
    label: "Create scene",
    category: "Scenes",
    options: [sceneNameOpt],
    toCommand: (o) => ({
      action: "create-scene",
      sceneName: String(o.sceneName ?? ""),
    }),
  },
  {
    id: "remove-scene",
    label: "Remove scene",
    category: "Scenes",
    options: [sceneNameOpt],
    toCommand: (o) => ({
      action: "remove-scene",
      sceneName: String(o.sceneName ?? ""),
    }),
  },
  {
    id: "rename-scene",
    label: "Rename scene",
    category: "Scenes",
    options: [
      sceneNameOpt,
      {
        id: "newSceneName",
        type: "string",
        label: "New name",
        placeholder: "Renamed",
      },
    ],
    toCommand: (o) => ({
      action: "rename-scene",
      sceneName: String(o.sceneName ?? ""),
      newSceneName: String(o.newSceneName ?? ""),
    }),
  },

  // ── Transitions ──
  {
    id: "set-current-transition",
    label: "Set current transition",
    category: "Transitions",
    options: [
      {
        id: "name",
        type: "string",
        label: "Transition name",
        placeholder: "Fade",
      },
    ],
    toCommand: (o) => ({
      action: "set-current-transition",
      name: String(o.name ?? ""),
    }),
  },
  {
    id: "set-transition-duration",
    label: "Set transition duration",
    category: "Transitions",
    options: [
      {
        id: "ms",
        type: "number",
        label: "Duration (ms)",
        default: 300,
        min: 0,
        max: 10000,
      },
    ],
    toCommand: (o) => ({
      action: "set-transition-duration",
      ms: Number(o.ms ?? 300),
    }),
  },
  {
    id: "set-tbar",
    label: "Set T-bar position",
    category: "Transitions",
    options: [
      {
        id: "position",
        type: "number",
        label: "Position (0-1)",
        default: 0,
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        id: "release",
        type: "boolean",
        label: "Release on transition complete",
        default: false,
      },
    ],
    toCommand: (o) => ({
      action: "set-tbar",
      position: Number(o.position ?? 0),
      release: Boolean(o.release),
    }),
  },
  {
    id: "set-transition-override",
    label: "Set scene transition override",
    category: "Transitions",
    options: [
      sceneNameOpt,
      {
        id: "transitionName",
        type: "string",
        label: "Transition name",
        placeholder: "Fade",
      },
      {
        id: "transitionDuration",
        type: "number",
        label: "Duration (ms)",
        default: 300,
        min: 0,
        max: 10000,
      },
    ],
    toCommand: (o) => ({
      action: "set-transition-override",
      sceneName: String(o.sceneName ?? ""),
      transitionName: o.transitionName ? String(o.transitionName) : null,
      transitionDuration:
        o.transitionDuration !== undefined && o.transitionDuration !== ""
          ? Number(o.transitionDuration)
          : null,
    }),
  },

  // ════════════════════════ Stream ════════════════════════════════════
  {
    id: "toggle-stream",
    label: "Toggle stream",
    category: "Stream",
    toCommand: () => ({ action: "toggle-stream" }),
  },
  {
    id: "start-stream",
    label: "Start stream",
    category: "Stream",
    toCommand: () => ({ action: "start-stream" }),
  },
  {
    id: "stop-stream",
    label: "Stop stream",
    category: "Stream",
    toCommand: () => ({ action: "stop-stream" }),
  },
  {
    id: "send-caption",
    label: "Send stream caption",
    category: "Stream",
    options: [{ id: "text", type: "string", label: "Caption text" }],
    toCommand: (o) => ({
      action: "send-caption",
      text: String(o.text ?? ""),
    }),
  },

  // ════════════════════════ Record ════════════════════════════════════
  {
    id: "toggle-record",
    label: "Toggle record",
    category: "Record",
    toCommand: () => ({ action: "toggle-record" }),
  },
  {
    id: "start-record",
    label: "Start record",
    category: "Record",
    toCommand: () => ({ action: "start-record" }),
  },
  {
    id: "stop-record",
    label: "Stop record",
    category: "Record",
    toCommand: () => ({ action: "stop-record" }),
  },
  {
    id: "pause-record",
    label: "Pause record",
    category: "Record",
    toCommand: () => ({ action: "pause-record" }),
  },
  {
    id: "resume-record",
    label: "Resume record",
    category: "Record",
    toCommand: () => ({ action: "resume-record" }),
  },
  {
    id: "split-record-file",
    label: "Split record file",
    category: "Record",
    toCommand: () => ({ action: "split-record-file" }),
  },
  {
    id: "create-record-chapter",
    label: "Create record chapter",
    category: "Record",
    options: [
      {
        id: "chapterName",
        type: "string",
        label: "Chapter name (optional)",
        placeholder: "Act 2",
      },
    ],
    toCommand: (o) => ({
      action: "create-record-chapter",
      ...(o.chapterName ? { chapterName: String(o.chapterName) } : {}),
    }),
  },
  {
    id: "set-record-directory",
    label: "Set record directory",
    category: "Record",
    options: [
      {
        id: "recordDirectory",
        type: "string",
        label: "Folder path",
        placeholder: "D:\\Recordings",
      },
    ],
    toCommand: (o) => ({
      action: "set-record-directory",
      recordDirectory: String(o.recordDirectory ?? ""),
    }),
  },

  // ════════════════════════ Replay buffer + virtual cam ══════════════
  {
    id: "toggle-replay-buffer",
    label: "Toggle replay buffer",
    category: "Replay",
    toCommand: () => ({ action: "toggle-replay-buffer" }),
  },
  {
    id: "save-replay-buffer",
    label: "Save replay buffer",
    category: "Replay",
    toCommand: () => ({ action: "save-replay-buffer" }),
  },
  {
    id: "toggle-virtual-cam",
    label: "Toggle virtual cam",
    category: "Replay",
    toCommand: () => ({ action: "toggle-virtual-cam" }),
  },

  // ════════════════════════ Audio ═════════════════════════════════════
  {
    id: "toggle-mute",
    label: "Toggle mute",
    category: "Audio",
    options: [inputNameOpt],
    toCommand: (o) => ({
      action: "toggle-mute",
      inputName: String(o.inputName ?? ""),
    }),
  },
  {
    id: "set-mute",
    label: "Set mute",
    category: "Audio",
    options: [
      inputNameOpt,
      { id: "muted", type: "boolean", label: "Muted", default: true },
    ],
    toCommand: (o) => ({
      action: "set-mute",
      inputName: String(o.inputName ?? ""),
      muted: Boolean(o.muted),
    }),
  },
  {
    id: "set-volume-db",
    label: "Set volume (dB)",
    category: "Audio",
    options: [
      inputNameOpt,
      {
        id: "volumeDb",
        type: "number",
        label: "Volume (dB)",
        default: 0,
        min: -100,
        max: 26,
        step: 0.5,
      },
    ],
    toCommand: (o) => ({
      action: "set-volume",
      inputName: String(o.inputName ?? ""),
      volumeDb: Number(o.volumeDb ?? 0),
    }),
  },
  {
    id: "set-volume-mul",
    label: "Set volume (linear 0-1)",
    category: "Audio",
    options: [
      inputNameOpt,
      {
        id: "volumeMul",
        type: "number",
        label: "Volume (0..1)",
        default: 1,
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
    toCommand: (o) => ({
      action: "set-volume",
      inputName: String(o.inputName ?? ""),
      volumeMul: Number(o.volumeMul ?? 1),
    }),
  },
  {
    id: "set-balance",
    label: "Set balance",
    category: "Audio",
    options: [
      inputNameOpt,
      {
        id: "balance",
        type: "number",
        label: "Balance (-1..1)",
        default: 0,
        min: -1,
        max: 1,
        step: 0.05,
      },
    ],
    toCommand: (o) => ({
      action: "set-balance",
      inputName: String(o.inputName ?? ""),
      balance: Number(o.balance ?? 0),
    }),
  },
  {
    id: "set-sync-offset",
    label: "Set sync offset (ms)",
    category: "Audio",
    options: [
      inputNameOpt,
      {
        id: "ms",
        type: "number",
        label: "Offset (ms)",
        default: 0,
        min: -950,
        max: 20000,
      },
    ],
    toCommand: (o) => ({
      action: "set-sync-offset",
      inputName: String(o.inputName ?? ""),
      ms: Number(o.ms ?? 0),
    }),
  },
  {
    id: "set-monitor-type",
    label: "Set audio monitor type",
    category: "Audio",
    options: [
      inputNameOpt,
      {
        id: "monitorType",
        type: "dropdown",
        label: "Monitor",
        default: "OBS_MONITORING_TYPE_NONE",
        choices: [
          { id: "OBS_MONITORING_TYPE_NONE", label: "None" },
          { id: "OBS_MONITORING_TYPE_MONITOR_ONLY", label: "Monitor only" },
          {
            id: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
            label: "Monitor + output",
          },
        ],
      },
    ],
    toCommand: (o) => ({
      action: "set-monitor-type",
      inputName: String(o.inputName ?? ""),
      monitorType: String(o.monitorType ?? "OBS_MONITORING_TYPE_NONE"),
    }),
  },
  {
    id: "set-meters-enabled",
    label: "Set volume meters enabled",
    category: "Audio",
    options: [{ id: "enabled", type: "boolean", label: "Enabled", default: true }],
    toCommand: (o) => ({
      action: "set-meters-enabled",
      enabled: Boolean(o.enabled),
    }),
  },

  // ════════════════════════ Scene items ═══════════════════════════════
  {
    id: "set-scene-item-enabled",
    label: "Show/hide scene item",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
      { id: "enabled", type: "boolean", label: "Visible", default: true },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-enabled",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      enabled: Boolean(o.enabled),
    }),
  },
  {
    id: "set-scene-item-locked",
    label: "Lock/unlock scene item",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
      { id: "locked", type: "boolean", label: "Locked", default: true },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-locked",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      locked: Boolean(o.locked),
    }),
  },
  {
    id: "set-scene-item-index",
    label: "Set scene item z-index",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
      {
        id: "sceneItemIndex",
        type: "number",
        label: "Z-index",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-index",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      sceneItemIndex: Number(o.sceneItemIndex ?? 0),
    }),
  },
  {
    id: "set-scene-item-blend-mode",
    label: "Set scene item blend mode",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
      {
        id: "sceneItemBlendMode",
        type: "dropdown",
        label: "Blend mode",
        default: "OBS_BLEND_NORMAL",
        choices: [
          "OBS_BLEND_NORMAL",
          "OBS_BLEND_ADDITIVE",
          "OBS_BLEND_SUBTRACT",
          "OBS_BLEND_SCREEN",
          "OBS_BLEND_MULTIPLY",
          "OBS_BLEND_LIGHTEN",
          "OBS_BLEND_DARKEN",
        ].map((id) => ({ id, label: id.replace("OBS_BLEND_", "") })),
      },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-blend-mode",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      sceneItemBlendMode: String(o.sceneItemBlendMode ?? "OBS_BLEND_NORMAL"),
    }),
  },
  {
    id: "create-scene-item",
    label: "Add source to scene",
    category: "Scene items",
    options: [
      sceneNameOpt,
      sourceNameOpt,
      { id: "enabled", type: "boolean", label: "Visible on add", default: true },
    ],
    toCommand: (o) => ({
      action: "create-scene-item",
      sceneName: String(o.sceneName ?? ""),
      sourceName: String(o.sourceName ?? ""),
      enabled: Boolean(o.enabled),
    }),
  },
  {
    id: "remove-scene-item",
    label: "Remove scene item",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "remove-scene-item",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
    }),
  },
  {
    id: "duplicate-scene-item",
    label: "Duplicate scene item",
    category: "Scene items",
    options: [
      sceneNameOpt,
      {
        id: "sceneItemId",
        type: "number",
        label: "Scene item id",
        default: 0,
        min: 0,
      },
      {
        id: "destinationSceneName",
        type: "string",
        label: "Destination scene (blank = same)",
      },
    ],
    toCommand: (o) => ({
      action: "duplicate-scene-item",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      ...(o.destinationSceneName
        ? { destinationSceneName: String(o.destinationSceneName) }
        : {}),
    }),
  },

  // ════════════════════════ Inputs ════════════════════════════════════
  {
    id: "remove-input",
    label: "Remove input",
    category: "Inputs",
    options: [inputNameOpt],
    toCommand: (o) => ({
      action: "remove-input",
      inputName: String(o.inputName ?? ""),
    }),
  },
  {
    id: "rename-input",
    label: "Rename input",
    category: "Inputs",
    options: [
      inputNameOpt,
      {
        id: "newInputName",
        type: "string",
        label: "New name",
        placeholder: "Renamed",
      },
    ],
    toCommand: (o) => ({
      action: "rename-input",
      inputName: String(o.inputName ?? ""),
      newInputName: String(o.newInputName ?? ""),
    }),
  },
  {
    id: "refresh-browser-source",
    label: "Refresh browser source",
    category: "Inputs",
    options: [inputNameOpt],
    toCommand: (o) => ({
      action: "refresh-browser-source",
      inputName: String(o.inputName ?? ""),
    }),
  },
  {
    id: "press-input-button",
    label: "Press input properties button",
    category: "Inputs",
    description:
      "Click a button inside an input's Properties UI (e.g. capture device 'Activate').",
    options: [
      inputNameOpt,
      {
        id: "propertyName",
        type: "string",
        label: "Property name",
        placeholder: "activate",
      },
    ],
    toCommand: (o) => ({
      action: "press-input-button",
      inputName: String(o.inputName ?? ""),
      propertyName: String(o.propertyName ?? ""),
    }),
  },

  // ════════════════════════ Media ═════════════════════════════════════
  {
    id: "trigger-media",
    label: "Media action",
    category: "Media",
    options: [
      inputNameOpt,
      {
        id: "mediaAction",
        type: "dropdown",
        label: "Action",
        default: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
        choices: [
          { id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY", label: "Play" },
          { id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE", label: "Pause" },
          { id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP", label: "Stop" },
          { id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART", label: "Restart" },
          {
            id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
            label: "Next (playlist)",
          },
          {
            id: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS",
            label: "Previous (playlist)",
          },
        ],
      },
    ],
    toCommand: (o) => ({
      action: "trigger-media",
      inputName: String(o.inputName ?? ""),
      mediaAction: String(
        o.mediaAction ?? "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY"
      ),
    }),
  },
  {
    id: "set-media-cursor",
    label: "Set media cursor (ms)",
    category: "Media",
    options: [
      inputNameOpt,
      {
        id: "cursorMs",
        type: "number",
        label: "Cursor (ms)",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "set-media-cursor",
      inputName: String(o.inputName ?? ""),
      cursorMs: Number(o.cursorMs ?? 0),
    }),
  },

  // ════════════════════════ Filters ═══════════════════════════════════
  {
    id: "create-filter",
    label: "Create source filter",
    category: "Filters",
    options: [
      sourceNameOpt,
      filterNameOpt,
      {
        id: "filterKind",
        type: "string",
        label: "Filter kind",
        placeholder: "color_filter_v2",
      },
    ],
    toCommand: (o) => ({
      action: "create-filter",
      sourceName: String(o.sourceName ?? ""),
      filterName: String(o.filterName ?? ""),
      filterKind: String(o.filterKind ?? ""),
    }),
  },
  {
    id: "remove-filter",
    label: "Remove source filter",
    category: "Filters",
    options: [sourceNameOpt, filterNameOpt],
    toCommand: (o) => ({
      action: "remove-filter",
      sourceName: String(o.sourceName ?? ""),
      filterName: String(o.filterName ?? ""),
    }),
  },
  {
    id: "set-filter-index",
    label: "Set filter index",
    category: "Filters",
    options: [
      sourceNameOpt,
      filterNameOpt,
      {
        id: "filterIndex",
        type: "number",
        label: "Index",
        default: 0,
        min: 0,
      },
    ],
    toCommand: (o) => ({
      action: "set-filter-index",
      sourceName: String(o.sourceName ?? ""),
      filterName: String(o.filterName ?? ""),
      filterIndex: Number(o.filterIndex ?? 0),
    }),
  },
  {
    id: "rename-filter",
    label: "Rename source filter",
    category: "Filters",
    options: [
      sourceNameOpt,
      filterNameOpt,
      {
        id: "newFilterName",
        type: "string",
        label: "New name",
      },
    ],
    toCommand: (o) => ({
      action: "rename-filter",
      sourceName: String(o.sourceName ?? ""),
      filterName: String(o.filterName ?? ""),
      newFilterName: String(o.newFilterName ?? ""),
    }),
  },

  // ════════════════════════ Outputs ═══════════════════════════════════
  {
    id: "start-output",
    label: "Start output",
    category: "Outputs",
    options: [
      { id: "outputName", type: "string", label: "Output name" },
    ],
    toCommand: (o) => ({
      action: "start-output",
      outputName: String(o.outputName ?? ""),
    }),
  },
  {
    id: "stop-output",
    label: "Stop output",
    category: "Outputs",
    options: [
      { id: "outputName", type: "string", label: "Output name" },
    ],
    toCommand: (o) => ({
      action: "stop-output",
      outputName: String(o.outputName ?? ""),
    }),
  },
  {
    id: "toggle-output",
    label: "Toggle output",
    category: "Outputs",
    options: [
      { id: "outputName", type: "string", label: "Output name" },
    ],
    toCommand: (o) => ({
      action: "toggle-output",
      outputName: String(o.outputName ?? ""),
    }),
  },

  // ════════════════════════ Profiles / Scene collections ═════════════
  {
    id: "set-profile",
    label: "Set current profile",
    category: "Profiles",
    options: [{ id: "name", type: "string", label: "Profile name" }],
    toCommand: (o) => ({ action: "set-profile", name: String(o.name ?? "") }),
  },
  {
    id: "set-scene-collection",
    label: "Set current scene collection",
    category: "Profiles",
    options: [{ id: "name", type: "string", label: "Collection name" }],
    toCommand: (o) => ({
      action: "set-scene-collection",
      name: String(o.name ?? ""),
    }),
  },
  {
    id: "set-profile-parameter",
    label: "Set profile parameter",
    category: "Profiles",
    options: [
      {
        id: "category",
        type: "string",
        label: "Category",
        placeholder: "Output",
      },
      {
        id: "name",
        type: "string",
        label: "Parameter name",
      },
      { id: "value", type: "string", label: "Value" },
    ],
    toCommand: (o) => ({
      action: "set-profile-parameter",
      category: String(o.category ?? ""),
      name: String(o.name ?? ""),
      value: String(o.value ?? ""),
    }),
  },

  // ════════════════════════ Hotkeys & misc ════════════════════════════
  {
    id: "trigger-hotkey",
    label: "Trigger hotkey by name",
    category: "Misc",
    options: [
      {
        id: "name",
        type: "string",
        label: "Hotkey name",
        placeholder: "OBSBasic.Transition",
      },
    ],
    toCommand: (o) => ({
      action: "trigger-hotkey",
      name: String(o.name ?? ""),
    }),
  },
  {
    id: "call-vendor",
    label: "Call vendor request",
    category: "Misc",
    description:
      "Call a vendor (plugin) request — e.g. the obs-websocket-camera plugin.",
    options: [
      {
        id: "vendorName",
        type: "string",
        label: "Vendor name",
        placeholder: "obs-websocket",
      },
      { id: "requestType", type: "string", label: "Request type" },
    ],
    toCommand: (o) => ({
      action: "call-vendor",
      vendorName: String(o.vendorName ?? ""),
      requestType: String(o.requestType ?? ""),
    }),
  },
  {
    id: "raw",
    label: "Raw OBS request",
    category: "Misc",
    description:
      "Send any obs-websocket v5 requestType. Escape hatch for things this catalog doesn't expose explicitly.",
    options: [
      {
        id: "requestType",
        type: "string",
        label: "Request type",
        placeholder: "GetVersion",
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      requestType: String(o.requestType ?? ""),
    }),
  },

  // ════════════════════════ Recording extras ══════════════════════════
  {
    id: "toggle-record-pause",
    label: "Toggle record pause",
    category: "Record",
    toCommand: () => ({ action: "raw", requestType: "ToggleRecordPause" }),
  },
  {
    id: "get-record-status",
    label: "Get record status",
    category: "Record",
    toCommand: () => ({ action: "raw", requestType: "GetRecordStatus" }),
  },

  // ════════════════════════ Stream extras ═════════════════════════════
  {
    id: "get-stream-status",
    label: "Get stream status",
    category: "Stream",
    toCommand: () => ({ action: "raw", requestType: "GetStreamStatus" }),
  },

  // ════════════════════════ Virtual cam — explicit start/stop ─────────
  {
    id: "start-virtual-cam",
    label: "Virtual cam · Start",
    category: "Replay",
    toCommand: () => ({ action: "raw", requestType: "StartVirtualCam" }),
  },
  {
    id: "stop-virtual-cam",
    label: "Virtual cam · Stop",
    category: "Replay",
    toCommand: () => ({ action: "raw", requestType: "StopVirtualCam" }),
  },

  // ════════════════════════ Replay buffer extras ══════════════════════
  {
    id: "start-replay-buffer",
    label: "Replay buffer · Start",
    category: "Replay",
    toCommand: () => ({ action: "raw", requestType: "StartReplayBuffer" }),
  },
  {
    id: "stop-replay-buffer",
    label: "Replay buffer · Stop",
    category: "Replay",
    toCommand: () => ({ action: "raw", requestType: "StopReplayBuffer" }),
  },
  {
    id: "get-last-replay",
    label: "Get last replay path",
    category: "Replay",
    toCommand: () => ({ action: "get-last-replay" }),
  },

  // ════════════════════════ Filter enable/disable ═════════════════════
  {
    id: "set-filter-enabled",
    label: "Filter · Enable / disable",
    category: "Filters",
    options: [
      sourceNameOpt,
      filterNameOpt,
      { id: "filterEnabled", type: "boolean", label: "Enabled", default: true },
    ],
    toCommand: (o) => ({
      action: "raw",
      requestType: "SetSourceFilterEnabled",
      requestData: {
        sourceName: String(o.sourceName ?? ""),
        filterName: String(o.filterName ?? ""),
        filterEnabled: Boolean(o.filterEnabled),
      },
    }),
  },
  {
    id: "get-filter-list",
    label: "Filter · Get list for source",
    category: "Filters",
    options: [sourceNameOpt],
    toCommand: (o) => ({
      action: "raw",
      requestType: "GetSourceFilterList",
      requestData: { sourceName: String(o.sourceName ?? "") },
    }),
  },

  // ════════════════════════ Screenshot to file ════════════════════════
  {
    id: "save-source-screenshot",
    label: "Save source screenshot to file",
    category: "Misc",
    options: [
      sourceNameOpt,
      {
        id: "imageFormat",
        type: "dropdown",
        label: "Format",
        default: "png",
        choices: ["png", "jpg", "jpeg", "bmp"].map((id) => ({
          id,
          label: id,
        })),
      },
      {
        id: "imageFilePath",
        type: "string",
        label: "File path",
        placeholder: "C:\\screens\\out.png",
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      requestType: "SaveSourceScreenshot",
      requestData: {
        sourceName: String(o.sourceName ?? ""),
        imageFormat: String(o.imageFormat ?? "png"),
        imageFilePath: String(o.imageFilePath ?? ""),
      },
    }),
  },

  // ════════════════════════ Scene transition cursor (T-bar) ═══════════
  {
    id: "get-scene-transition-cursor",
    label: "Get scene transition cursor",
    category: "Transitions",
    toCommand: () => ({
      action: "raw",
      requestType: "GetSceneTransitionCursor",
    }),
  },

  // ════════════════════════ Sleep / wait (request batch helper) ───────
  {
    id: "sleep",
    label: "Sleep (delay in ms)",
    category: "Misc",
    description:
      "Inserts a pause between steps. Most useful in multi-step presets that need to wait for OBS to settle before firing the next step.",
    options: [
      {
        id: "sleepMillis",
        type: "number",
        label: "Milliseconds",
        default: 250,
        min: 0,
        max: 60000,
      },
    ],
    toCommand: (o) => ({
      action: "raw",
      requestType: "Sleep",
      requestData: { sleepMillis: Number(o.sleepMillis ?? 250) },
    }),
  },

  // ════════════════════════ Scene collection / Profile listing ────────
  {
    id: "get-scene-collection-list",
    label: "Get scene collection list",
    category: "Profiles",
    toCommand: () => ({
      action: "raw",
      requestType: "GetSceneCollectionList",
    }),
  },
  {
    id: "get-profile-list",
    label: "Get profile list",
    category: "Profiles",
    toCommand: () => ({ action: "raw", requestType: "GetProfileList" }),
  },

  // ════════════════════════ Source visibility shortcuts ──────────────
  {
    id: "show-scene-item",
    label: "Show scene item (alias)",
    category: "Scene items",
    description: "Convenience preset — same as Set scene item enabled = true.",
    options: [
      sceneNameOpt,
      { id: "sceneItemId", type: "number", label: "Scene item id", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-enabled",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      enabled: true,
    }),
  },
  {
    id: "hide-scene-item",
    label: "Hide scene item (alias)",
    category: "Scene items",
    options: [
      sceneNameOpt,
      { id: "sceneItemId", type: "number", label: "Scene item id", default: 0, min: 0 },
    ],
    toCommand: (o) => ({
      action: "set-scene-item-enabled",
      sceneName: String(o.sceneName ?? ""),
      sceneItemId: Number(o.sceneItemId ?? 0),
      enabled: false,
    }),
  },
];
