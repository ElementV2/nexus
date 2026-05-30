import { Video } from "lucide-react";
import { registerDeviceKind } from "@/lib/core/registry";
import { ObsBroker } from "@/lib/obs/ws-broker";
import type {
  BrokerImpl,
  ConnectionStatus,
  DeviceKind,
  KindEvent,
  PresetDefinition,
  VariableDefinition,
} from "@/lib/core/types";
import { obsActions } from "./obs-actions";
import type { ObsConnectionStatus } from "@/lib/obs/types";

/**
 * OBS Studio kind — fully per-instance. Each connection constructs its
 * own `ObsBroker` (its own WS client + state), so multiple OBS machines
 * run independently. The adapter handles all action dispatch (the
 * kind-specific command body shape) and surfaces the broker's snapshot
 * and status through the generic `BrokerImpl` surface.
 */

// ─────────────────────────── Config schema ────────────────────────────

interface ObsConfig {
  host: string;
  /** Default obs-websocket v5 port is 4455. */
  port: number;
  /** Empty string when auth is disabled in OBS. */
  password: string;
}

function parseObsConfig(
  raw: unknown
): { ok: true; config: ObsConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "config must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const host = typeof r.host === "string" ? r.host.trim() : "";
  if (!host) return { ok: false, error: "host is required" };
  const port = typeof r.port === "number" ? r.port : Number(r.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { ok: false, error: "port must be 1-65535" };
  }
  const password = typeof r.password === "string" ? r.password : "";
  return { ok: true, config: { host, port, password } };
}

// ─────────────────────────── Status mapping ───────────────────────────

/**
 * Collapse obs-websocket's 4-state status into the generic 4-state.
 * "authenticating" is just a sub-state of connecting from the manager's
 * point of view — kind-specific pages can still distinguish them by
 * reading the raw event payload.
 */
function mapStatus(s: ObsConnectionStatus): ConnectionStatus {
  switch (s) {
    case "connected":
      return "connected";
    case "connecting":
    case "authenticating":
      return "connecting";
    case "disconnected":
    default:
      return "offline";
  }
}

// ─────────────────────────── Action dispatch ──────────────────────────

/**
 * Command body forwarded to the broker. The shape mirrors the legacy
 * `/api/obs/command` discriminated union so existing client code keeps
 * working — only the URL changes from `/api/obs/command` to
 * `/api/connections/:id/command`.
 *
 * Validation happens here rather than in the API route so the kind
 * owns the contract end-to-end.
 */
type ObsCommandBody = { action: string } & Record<string, unknown>;

type B = ObsBroker;

/**
 * action → handler map. Each handler receives the broker and the
 * already-narrowed body. Compact alternative to the 60-case switch
 * that used to live in the API route.
 */
const ACTIONS: Record<
  string,
  (b: B, body: ObsCommandBody) => Promise<unknown> | unknown
> = {
  "set-program-scene": (b, x) => b.setCurrentScene(x.sceneName as string),
  "set-preview-scene": (b, x) => b.setPreviewScene(x.sceneName as string),
  "trigger-studio-transition": (b) => b.triggerStudioTransition(),
  "set-studio-mode": (b, x) => b.setStudioMode(Boolean(x.enabled)),
  "set-current-transition": (b, x) => b.setCurrentTransition(x.name as string),
  "set-transition-duration": (b, x) =>
    b.setTransitionDuration(Math.max(0, (x.ms as number) | 0)),

  "toggle-stream": (b) => b.toggleStream(),
  "start-stream": (b) => b.startStream(),
  "stop-stream": (b) => b.stopStream(),
  "toggle-record": (b) => b.toggleRecord(),
  "start-record": (b) => b.startRecord(),
  "stop-record": (b) => b.stopRecord(),
  "pause-record": (b) => b.pauseRecord(),
  "resume-record": (b) => b.resumeRecord(),
  "toggle-replay-buffer": (b) => b.toggleReplayBuffer(),
  "save-replay-buffer": (b) => b.saveReplayBuffer(),
  "toggle-virtual-cam": (b) => b.toggleVirtualCam(),

  "set-mute": (b, x) => b.setMute(x.inputName as string, Boolean(x.muted)),
  "toggle-mute": (b, x) => b.toggleMute(x.inputName as string),
  "set-volume": (b, x) => {
    if (typeof x.volumeMul === "number") {
      return b.setVolumeMul(x.inputName as string, x.volumeMul);
    }
    if (typeof x.volumeDb === "number") {
      return b.setVolumeDb(x.inputName as string, x.volumeDb);
    }
    throw new Error("set-volume needs volumeMul or volumeDb");
  },
  "set-balance": (b, x) =>
    b.setAudioBalance(x.inputName as string, x.balance as number),
  "set-sync-offset": (b, x) =>
    b.setAudioSyncOffset(x.inputName as string, x.ms as number),
  "set-monitor-type": (b, x) =>
    b.setAudioMonitorType(x.inputName as string, x.monitorType as string),

  "set-scene-item-enabled": (b, x) =>
    b.setSceneItemEnabled(
      x.sceneName as string,
      x.sceneItemId as number,
      Boolean(x.enabled)
    ),
  "set-scene-item-locked": (b, x) =>
    b.setSceneItemLocked(
      x.sceneName as string,
      x.sceneItemId as number,
      Boolean(x.locked)
    ),
  "ensure-scene-items": (b, x) => b.ensureSceneItems(x.sceneName as string),

  "trigger-media": (b, x) =>
    b.triggerMediaAction(x.inputName as string, x.mediaAction as string),
  "set-media-cursor": (b, x) =>
    b.setMediaCursor(x.inputName as string, x.cursorMs as number),
  "trigger-hotkey": (b, x) => b.triggerHotkey(x.name as string),

  "set-profile": (b, x) => b.setCurrentProfile(x.name as string),
  "set-scene-collection": (b, x) =>
    b.setCurrentSceneCollection(x.name as string),

  "set-meters-enabled": (b, x) => {
    b.setVolumeMetersEnabled(Boolean(x.enabled));
    return { ok: true };
  },

  "set-tbar": (b, x) =>
    b.setTBarPosition(Number(x.position), Boolean(x.release)),

  "set-transition-override": (b, x) =>
    b.setSceneTransitionOverride(
      x.sceneName as string,
      x.transitionName as string | null,
      x.transitionDuration as number | null
    ),
  "get-transition-override": (b, x) =>
    b.getSceneTransitionOverride(x.sceneName as string),

  "get-record-directory": (b) => b.getRecordDirectory(),
  "set-record-directory": (b, x) =>
    b.setRecordDirectory(x.recordDirectory as string),
  "split-record-file": (b) => b.splitRecordFile(),
  "create-record-chapter": (b, x) =>
    b.createRecordChapter(x.chapterName as string | undefined),

  "send-caption": (b, x) => b.sendStreamCaption(x.text as string),
  "get-stream-service-settings": (b) => b.getStreamServiceSettings(),
  "set-stream-service-settings": (b, x) =>
    b.setStreamServiceSettings(
      x.streamServiceType as string,
      x.streamServiceSettings as Record<string, unknown>
    ),

  "get-output-list": (b) => b.getOutputList(),
  "start-output": (b, x) => b.startOutput(x.outputName as string),
  "stop-output": (b, x) => b.stopOutput(x.outputName as string),
  "toggle-output": (b, x) => b.toggleOutput(x.outputName as string),
  "get-output-settings": (b, x) => b.getOutputSettings(x.outputName as string),
  "set-output-settings": (b, x) =>
    b.setOutputSettings(
      x.outputName as string,
      x.outputSettings as Record<string, unknown>
    ),

  "get-source-active": (b, x) => b.getSourceActive(x.sourceName as string),
  "refresh-browser-source": (b, x) =>
    b.refreshBrowserSource(x.inputName as string),
  "press-input-button": (b, x) =>
    b.pressInputPropertiesButton(
      x.inputName as string,
      x.propertyName as string
    ),

  "create-scene": (b, x) => b.createScene(x.sceneName as string),
  "remove-scene": (b, x) => b.removeScene(x.sceneName as string),
  "rename-scene": (b, x) =>
    b.setSceneName(x.sceneName as string, x.newSceneName as string),

  "create-scene-item": (b, x) =>
    b.createSceneItem(
      x.sceneName as string,
      x.sourceName as string,
      x.enabled as boolean | undefined
    ),
  "remove-scene-item": (b, x) =>
    b.removeSceneItem(x.sceneName as string, x.sceneItemId as number),
  "duplicate-scene-item": (b, x) =>
    b.duplicateSceneItem(
      x.sceneName as string,
      x.sceneItemId as number,
      x.destinationSceneName as string | undefined
    ),
  "set-scene-item-index": (b, x) =>
    b.setSceneItemIndex(
      x.sceneName as string,
      x.sceneItemId as number,
      x.sceneItemIndex as number
    ),
  "set-scene-item-blend-mode": (b, x) =>
    b.setSceneItemBlendMode(
      x.sceneName as string,
      x.sceneItemId as number,
      x.sceneItemBlendMode as string
    ),
  "set-scene-item-transform": (b, x) =>
    b.setSceneItemTransform(
      x.sceneName as string,
      x.sceneItemId as number,
      x.sceneItemTransform as Record<string, unknown>
    ),

  "create-input": (b, x) =>
    b.createInput(
      x.sceneName as string,
      x.inputName as string,
      x.inputKind as string,
      x.inputSettings as Record<string, unknown> | undefined,
      x.enabled as boolean | undefined
    ),
  "remove-input": (b, x) => b.removeInput(x.inputName as string),
  "rename-input": (b, x) =>
    b.setInputName(x.inputName as string, x.newInputName as string),
  "get-input-settings": (b, x) => b.getInputSettings(x.inputName as string),
  "set-input-settings": (b, x) =>
    b.setInputSettings(
      x.inputName as string,
      x.inputSettings as Record<string, unknown>,
      x.overlay as boolean | undefined
    ),
  "get-input-kind-list": (b, x) =>
    b.getInputKindList(x.unversioned as boolean | undefined),
  "get-special-inputs": (b) => b.getSpecialInputs(),

  "create-filter": (b, x) =>
    b.createSourceFilter(
      x.sourceName as string,
      x.filterName as string,
      x.filterKind as string,
      x.filterSettings as Record<string, unknown> | undefined
    ),
  "remove-filter": (b, x) =>
    b.removeSourceFilter(x.sourceName as string, x.filterName as string),
  "set-filter-index": (b, x) =>
    b.setSourceFilterIndex(
      x.sourceName as string,
      x.filterName as string,
      x.filterIndex as number
    ),
  "set-filter-settings": (b, x) =>
    b.setSourceFilterSettings(
      x.sourceName as string,
      x.filterName as string,
      x.filterSettings as Record<string, unknown>,
      x.overlay as boolean | undefined
    ),
  "rename-filter": (b, x) =>
    b.setSourceFilterName(
      x.sourceName as string,
      x.filterName as string,
      x.newFilterName as string
    ),
  "get-filter-kinds": (b) => b.getSourceFilterKindList(),
  "get-filter-defaults": (b, x) =>
    b.getSourceFilterDefaultSettings(x.filterKind as string),

  "get-last-replay": (b) => b.getLastReplayBufferReplay(),
  "get-monitor-list": (b) => b.getMonitorList(),
  "get-profile-parameter": (b, x) =>
    b.getProfileParameter(x.category as string, x.name as string),
  "set-profile-parameter": (b, x) =>
    b.setProfileParameter(
      x.category as string,
      x.name as string,
      x.value as string
    ),

  "call-vendor": (b, x) =>
    b.callVendor(
      x.vendorName as string,
      x.requestType as string,
      x.requestData as Record<string, unknown> | undefined
    ),
  "broadcast": (b, x) =>
    b.broadcastCustomEvent(x.eventData as Record<string, unknown>),

  // Test/probe — replaces /api/obs/test.
  "test": (b) => b.testConnection(),

  // Screenshot — replaces /api/obs/screenshot.
  "get-source-screenshot": (b, x) =>
    b.getSourceScreenshot(
      x.sourceName as string,
      x.imageWidth as number | undefined,
      x.imageHeight as number | undefined
    ),

  // Escape hatch — pass any raw OBS request through unchanged.
  "raw": (b, x) => {
    const rt = x.requestType as string | undefined;
    if (!rt) throw new Error("raw needs requestType");
    return b.rawRequest(rt, x.requestData as Record<string, unknown> | undefined);
  },
};

// ─────────────────────────── Broker adapter ───────────────────────────

class ObsAdapter implements BrokerImpl {
  private broker: ObsBroker;

  constructor(config: ObsConfig) {
    this.broker = new ObsBroker({
      host: config.host,
      port: config.port,
      password: config.password,
    });
  }

  subscribe(cb: (event: KindEvent) => void): () => void {
    // `ObsEvent` already carries a `type` discriminator on every variant
    // so it matches the `KindEvent` shape without translation.
    return this.broker.subscribe(
      cb as Parameters<ObsBroker["subscribe"]>[0]
    );
  }

  getSnapshot(): unknown | null {
    return this.broker.getSnapshot();
  }

  async send(command: unknown): Promise<unknown> {
    if (!command || typeof command !== "object") {
      throw new Error("OBS command must be an object");
    }
    const body = command as ObsCommandBody;
    const action = body.action;
    if (typeof action !== "string") {
      throw new Error("OBS command needs an `action` field");
    }
    const handler = ACTIONS[action];
    if (!handler) {
      throw new Error(`Unknown OBS action: ${action}`);
    }
    return await handler(this.broker, body);
  }

  updateConfig(raw: unknown): void {
    const parsed = parseObsConfig(raw);
    if (!parsed.ok) {
      // Don't throw — the manager called this from reconcile() and we
      // shouldn't take the boot down. Log and keep the old config.
      console.warn(`[obs] updateConfig rejected: ${parsed.error}`);
      return;
    }
    this.broker.updateConfig({
      host: parsed.config.host,
      port: parsed.config.port,
      password: parsed.config.password,
    });
  }

  getStatus(): ConnectionStatus {
    return mapStatus(this.broker.getStatus());
  }

  dispose(): void {
    this.broker.dispose();
  }
}

// Inline catalog removed — full content lives in ./obs-actions.ts.

// ─────────────────────────── Variables ────────────────────────────────

const obsVariables: VariableDefinition[] = [
  { id: "current_program_scene", label: "Current program scene", hint: "string" },
  { id: "current_preview_scene", label: "Current preview scene", hint: "string" },
  { id: "studio_mode", label: "Studio mode on/off", hint: "boolean" },
  { id: "streaming", label: "Streaming on/off", hint: "boolean" },
  { id: "recording", label: "Recording on/off", hint: "boolean" },
  { id: "record_timecode", label: "Record timecode", hint: "time" },
  { id: "stream_timecode", label: "Stream timecode", hint: "time" },
  { id: "fps", label: "Active FPS", hint: "number" },
  { id: "cpu_usage", label: "CPU usage (%)", hint: "number" },
];

// ─────────────────────────── Presets ──────────────────────────────────

const obsPresets: PresetDefinition[] = [
  {
    id: "toggle-stream",
    label: "Toggle stream",
    category: "Stream",
    text: "STREAM",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "toggle-stream" }],
  },
  {
    id: "toggle-record",
    label: "Toggle record",
    category: "Record",
    text: "REC",
    bgcolor: "#8e44ad",
    fgcolor: "#ffffff",
    steps: [{ actionId: "toggle-record" }],
  },
  {
    id: "save-replay-buffer",
    label: "Save replay buffer",
    category: "Replay",
    text: "REPLAY",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "save-replay-buffer" }],
  },
  {
    id: "toggle-virtual-cam",
    label: "Toggle virtual cam",
    category: "Replay",
    text: "V-CAM",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "toggle-virtual-cam" }],
  },
  {
    id: "studio-take",
    label: "Studio take",
    category: "Scenes",
    text: "TAKE",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [{ actionId: "trigger-studio-transition" }],
  },
  {
    id: "go-live-record",
    label: "Stream + record",
    category: "Stream",
    text: "GO LIVE",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    steps: [
      { actionId: "start-stream" },
      { actionId: "start-record" },
    ],
  },
  {
    id: "end-show",
    label: "Stop stream + record",
    category: "Stream",
    text: "STOP",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [
      { actionId: "stop-stream" },
      { actionId: "stop-record" },
    ],
  },

  // ── Extras matching the expanded action catalog ─────────────────────
  {
    id: "toggle-record-pause",
    label: "Toggle record pause",
    category: "Record",
    text: "REC\nPAUSE",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "toggle-record-pause" }],
  },
  {
    id: "start-virtual-cam",
    label: "Virtual cam start",
    category: "Replay",
    text: "VCAM\n▶",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [{ actionId: "start-virtual-cam" }],
  },
  {
    id: "stop-virtual-cam",
    label: "Virtual cam stop",
    category: "Replay",
    text: "VCAM\n■",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "stop-virtual-cam" }],
  },
  {
    id: "start-replay-buffer",
    label: "Replay buffer start",
    category: "Replay",
    text: "RB ▶",
    bgcolor: "#ff9500",
    fgcolor: "#000000",
    steps: [{ actionId: "start-replay-buffer" }],
  },
  {
    id: "stop-replay-buffer",
    label: "Replay buffer stop",
    category: "Replay",
    text: "RB ■",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [{ actionId: "stop-replay-buffer" }],
  },
  {
    id: "filter-toggle",
    label: "Filter enable/disable",
    category: "Filters",
    text: "FILTER",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    steps: [
      {
        actionId: "set-filter-enabled",
        options: { sourceName: "", filterName: "", filterEnabled: true },
      },
    ],
  },
  {
    id: "save-screenshot",
    label: "Save source screenshot",
    category: "Misc",
    text: "📸",
    bgcolor: "#5ac8fa",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "save-source-screenshot",
        options: { sourceName: "", imageFormat: "png", imageFilePath: "" },
      },
    ],
  },
  {
    id: "show-scene-item",
    label: "Show scene item",
    category: "Scene items",
    text: "SHOW",
    bgcolor: "#34c759",
    fgcolor: "#000000",
    steps: [
      {
        actionId: "show-scene-item",
        options: { sceneName: "", sceneItemId: 0 },
      },
    ],
  },
  {
    id: "hide-scene-item",
    label: "Hide scene item",
    category: "Scene items",
    text: "HIDE",
    bgcolor: "#1c1c1e",
    fgcolor: "#ff3b30",
    steps: [
      {
        actionId: "hide-scene-item",
        options: { sceneName: "", sceneItemId: 0 },
      },
    ],
  },
];

// ─────────────────────────── Kind definition ──────────────────────────

const obsKind: DeviceKind = {
  kind: "obs",
  displayName: "OBS Studio",
  icon: Video,
  tagline: "obs-websocket v5",
  parseConfig: parseObsConfig,
  defaultConfig: (): ObsConfig => ({
    host: "127.0.0.1",
    port: 4455,
    password: "",
  }),
  pages: [{ href: "/obs", label: "OBS", icon: Video }],
  actions: obsActions,
  variables: obsVariables,
  presets: obsPresets,
  make({ config }): BrokerImpl {
    const parsed = parseObsConfig(config);
    if (!parsed.ok) {
      throw new Error(`OBS config invalid: ${parsed.error}`);
    }
    return new ObsAdapter(parsed.config);
  },
};

registerDeviceKind(obsKind);
