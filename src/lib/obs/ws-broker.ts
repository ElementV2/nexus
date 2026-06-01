import { randomUUID } from "node:crypto";
import {
  buildAuthResponse,
  DEFAULT_EVENT_SUBSCRIPTIONS,
  OP_EVENT,
  OP_HELLO,
  OP_IDENTIFIED,
  OP_IDENTIFY,
  OP_REIDENTIFY,
  OP_REQUEST,
  OP_REQUEST_RESPONSE,
  SUBSCRIPTIONS_WITH_METERS,
} from "./protocol";
import type {
  ObsAudioInput,
  ObsConnectionStatus,
  ObsEvent,
  ObsInput,
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
} from "./types";

/**
 * Per-instance OBS WebSocket v5 broker. ONE per configured OBS
 * connection — each owns its own WS client + auth + state, so multiple
 * OBS machines run independently (one socket per connection, no shared
 * control singleton).
 *
 *   • Push-driven — OBS pushes events for everything we care about; we
 *     only poll stats (CPU/FPS/dropped frames).
 *   • Self-healing — reconnects with exponential backoff on close;
 *     rebuilds the full snapshot on every fresh Identified.
 */

export interface ObsBrokerConfig {
  host: string;
  port: number;
  password: string;
}

type Subscriber = (e: ObsEvent) => void;

const RECONNECT_INITIAL_MS = 1_000;
// Cap low so OBS recovers within a few seconds of coming back on the LAN
// (was 30 s — same "feels like it never reconnects" lag as vMix had).
const RECONNECT_MAX_MS = 5_000;
// A socket that opens but never reaches "connected" (no Hello, or Identify /
// snapshot hangs) is force-closed after this, then reconnected. Without it a
// half-open socket would wedge the loop — `close`/`error` never fire — and
// the connection would sit "connecting" forever even after OBS came back.
const CONNECT_WATCHDOG_MS = 10_000;
const STATS_POLL_MS = 1_500;
const REQUEST_TIMEOUT_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const STOP_GRACE_MS = 3_000;

interface RequestEnvelope {
  op: typeof OP_REQUEST;
  d: {
    requestType: string;
    requestId: string;
    requestData?: Record<string, unknown>;
  };
}

interface HelloPayload {
  obsWebSocketVersion: string;
  rpcVersion: number;
  authentication?: {
    challenge: string;
    salt: string;
  };
}

interface IdentifiedPayload {
  negotiatedRpcVersion: number;
}

interface ResponsePayload {
  requestType: string;
  requestId: string;
  requestStatus: {
    result: boolean;
    code: number;
    comment?: string;
  };
  responseData?: Record<string, unknown>;
}

interface EventPayload {
  eventType: string;
  eventIntent: number;
  eventData: Record<string, unknown>;
}

// Minimal global WebSocket type guard — Node 20+ ships undici's
// WebSocket as a global, no `ws` dependency needed.
type WSConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

const emptyStats: ObsStats = {
  cpuUsage: 0,
  memoryUsage: 0,
  availableDiskSpace: 0,
  activeFps: 0,
  averageFrameRenderTime: 0,
  renderSkippedFrames: 0,
  renderTotalFrames: 0,
  outputSkippedFrames: 0,
  outputTotalFrames: 0,
  websocketIncomingMessages: 0,
  websocketOutgoingMessages: 0,
};

const emptyStream: ObsStreamStatus = {
  active: false,
  reconnecting: false,
  timecodeMs: 0,
  bytesSent: 0,
  skippedFrames: 0,
  totalFrames: 0,
};

const emptyRecord: ObsRecordStatus = {
  active: false,
  paused: false,
  timecodeMs: 0,
  bytes: 0,
};

export class ObsBroker {
  private subscribers = new Set<Subscriber>();
  private ws: WebSocket | null = null;

  private host: string;
  private port: number;
  private password: string;

  constructor(config: ObsBrokerConfig) {
    this.host = config.host;
    this.port = config.port;
    this.password = config.password;
  }

  private status: ObsConnectionStatus = "disconnected";
  private obsVersion: string | undefined;
  private obsWebSocketVersion: string | undefined;
  private platform: string | undefined;
  private snapshot: ObsSnapshot | null = null;
  private lastStatusEvent: ObsEvent | null = null;

  private reconnectMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private stopGraceTimer: ReturnType<typeof setTimeout> | null = null;

  /** requestId → resolver/rejecter for in-flight requests. */
  private pending = new Map<
    string,
    {
      resolve: (data: Record<string, unknown> | undefined) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Event subscriptions currently active on the OBS side. Toggle the
   *  volume-meter bit on/off via `setVolumeMetersEnabled`. */
  private subscriptions = DEFAULT_EVENT_SUBSCRIPTIONS;

  /** True while we're waiting for the Identified that answers a
   *  REIDENTIFY (volume-meter toggle) — as opposed to a fresh connect.
   *  Lets `onIdentified` skip the full snapshot rebuild in that case. */
  private reidentifying = false;
  /** Watchdog so a REIDENTIFY that never gets answered doesn't leave
   *  `reidentifying` stuck true (which would make a later genuine fresh
   *  Identified skip its snapshot rebuild). Cleared on Identified/stop. */
  private reidentifyTimer: ReturnType<typeof setTimeout> | null = null;

  // ───────────────────────── Subscriber API ─────────────────────────

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
    // Replay latest status + snapshot so a new client renders fast.
    if (this.lastStatusEvent) cb(this.lastStatusEvent);
    if (this.snapshot) cb({ type: "snapshot", snapshot: this.snapshot });
    if (this.subscribers.size === 1) this.start();
    return () => this.unsubscribe(cb);
  }

  private unsubscribe(cb: Subscriber) {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) {
      if (this.stopGraceTimer) clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = setTimeout(() => {
        this.stopGraceTimer = null;
        if (this.subscribers.size === 0) this.stop();
      }, STOP_GRACE_MS);
    }
  }

  getSnapshot(): ObsSnapshot | null {
    return this.snapshot;
  }

  /**
   * Current connection state. Public read of the otherwise-internal
   * status field so the device-registry adapter can report health
   * without subscribing to events.
   */
  getStatus(): ObsConnectionStatus {
    return this.status;
  }

  // ───────────────────────── Lifecycle ──────────────────────────────

  private start() {
    this.openSocket();
  }

  dispose() {
    this.stop();
  }

  private stop() {
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.reidentifyTimer) {
      clearTimeout(this.reidentifyTimer);
      this.reidentifyTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Broker shutting down"));
    }
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.status = "disconnected";
    this.snapshot = null;
    this.lastStatusEvent = null;
    this.obsVersion = undefined;
    this.obsWebSocketVersion = undefined;
    this.platform = undefined;
    this.reidentifying = false;
  }

  /** Apply a new config and reconnect if host/port/password changed.
   *  Called by the registry on reconcile (per-instance). */
  updateConfig(config: ObsBrokerConfig) {
    const before = `${this.host}:${this.port}:${this.password}`;
    this.host = config.host;
    this.port = config.port;
    this.password = config.password;
    const after = `${this.host}:${this.port}:${this.password}`;
    if (before === after) return;
    if (this.subscribers.size === 0) return;
    // Close + reconnect with new settings. Cancel any pending backoff.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectMs = RECONNECT_INITIAL_MS;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.openSocket();
  }

  // ───────────────────────── Socket open ────────────────────────────

  private openSocket() {
    // Fresh socket → any pending re-identify is moot; the next Identified
    // must trigger a real snapshot build.
    this.reidentifying = false;
    const Ctor = (globalThis as { WebSocket?: WSConstructor }).WebSocket;
    if (!Ctor) {
      this.publishStatus(
        "disconnected",
        "Global WebSocket not available — Node 20+ required"
      );
      return;
    }
    const url = `ws://${this.host}:${this.port}`;
    this.publishStatus("connecting");
    // Watchdog: force-close + reconnect if this socket doesn't reach
    // "connected" in time (server reachable but Hello/Identify/snapshot
    // hangs, or a half-open socket that never fires close/error). Cleared
    // on a successful snapshot and in onClose/stop.
    this.armConnectWatchdog();
    try {
      // Subprotocol: obs-websocket v5 accepts JSON or MsgPack. We use
      // JSON since it's what `JSON.parse` already handles natively.
      const ws = new Ctor(url, "obswebsocket.json");
      this.ws = ws;

      ws.addEventListener("open", () => {
        // Nothing to do here — the server sends Hello immediately, we
        // respond in `onMessage` after parsing it.
      });

      // Guard both handlers by socket identity: when updateConfig() (or the
      // onIdentified failure path) closes this socket and immediately opens a
      // new one, this socket's deferred `close`/`message` events still fire a
      // tick later. Without this check the stale close would null out
      // `this.ws` — orphaning the NEW healthy socket (commands then reject)
      // and firing a phantom reconnect, briefly running two live sockets.
      ws.addEventListener("message", (evt: MessageEvent) => {
        if (this.ws !== ws) return;
        this.onMessage(evt.data);
      });

      ws.addEventListener("close", (evt: CloseEvent) => {
        if (this.ws !== ws) return;
        this.onClose(evt.code, evt.reason);
      });

      ws.addEventListener("error", () => {
        // A failed CONNECT (server down / refused) does not reliably fire
        // `close` on every WebSocket impl — only `error`. If we relied on
        // `close` alone the reconnect loop would die after the first failed
        // attempt and never recover when OBS came back. Drive the same
        // teardown+reconnect path here; `onClose` nulls `this.ws`, so a
        // trailing `close` for the same socket is ignored by the guard.
        if (this.ws !== ws) return;
        this.onClose(1006, "connection error");
      });
    } catch (err) {
      this.publishStatus(
        "disconnected",
        err instanceof Error ? err.message : "Could not open OBS WebSocket"
      );
      this.scheduleReconnect();
    }
  }

  /** (Re)arm the connect watchdog for the socket currently opening. */
  private armConnectWatchdog() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.status === "connected") return; // already healthy
      // Stuck in connecting/authenticating → tear the socket down and let
      // the reconnect loop try again from scratch.
      const dead = this.ws;
      this.ws = null;
      if (dead) {
        try {
          dead.close();
        } catch {
          /* ignore */
        }
      }
      this.publishStatus("disconnected", "Connection timed out");
      this.scheduleReconnect();
    }, CONNECT_WATCHDOG_MS);
  }

  private onClose(code: number, reason: string) {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    // Auth failures are 4009 (bad password) / 4008 (unsupported feature).
    // Surface a clear message so the operator knows what to fix.
    const friendly =
      code === 4009
        ? "OBS rejected authentication (wrong password)"
        : code === 4008
          ? "OBS rejected the session (RPC version mismatch)"
          : code === 4006
            ? "OBS closed: server is shutting down"
            : reason || `Connection closed (code ${code})`;
    this.publishStatus("disconnected", friendly);
    this.snapshot = null;
    this.ws = null;
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    // Reject in-flight requests so callers don't dangle.
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("OBS disconnected"));
      this.pending.delete(id);
    }
    // 4009 (wrong password) / 4008 (RPC version mismatch) are PERMANENT
    // faults: retrying every few seconds just storms a server that will
    // reject us identically forever (and flaps the status). Stop the
    // auto-reconnect loop — a config edit (`updateConfig`) re-opens the
    // socket with the corrected password, so a real fix still reconnects.
    if (code === 4009 || code === 4008) {
      this.reconnectMs = RECONNECT_INITIAL_MS;
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.subscribers.size === 0) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(RECONNECT_MAX_MS, this.reconnectMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  // ───────────────────────── Message routing ────────────────────────

  private onMessage(raw: unknown) {
    let parsed: { op: number; d: unknown };
    try {
      parsed =
        typeof raw === "string"
          ? JSON.parse(raw)
          : JSON.parse(new TextDecoder().decode(raw as ArrayBuffer));
    } catch {
      return;
    }
    switch (parsed.op) {
      case OP_HELLO:
        this.onHello(parsed.d as HelloPayload);
        break;
      case OP_IDENTIFIED:
        this.onIdentified(parsed.d as IdentifiedPayload);
        break;
      case OP_REQUEST_RESPONSE:
        this.onRequestResponse(parsed.d as ResponsePayload);
        break;
      case OP_EVENT:
        this.onEvent(parsed.d as EventPayload);
        break;
    }
  }

  private onHello(hello: HelloPayload) {
    this.obsWebSocketVersion = hello.obsWebSocketVersion;
    this.publishStatus("authenticating");
    const auth = hello.authentication
      ? buildAuthResponse(
          this.password,
          hello.authentication.salt,
          hello.authentication.challenge
        )
      : undefined;
    const payload: Record<string, unknown> = {
      rpcVersion: 1,
      eventSubscriptions: this.subscriptions,
    };
    if (auth) payload.authentication = auth;
    this.send({ op: OP_IDENTIFY, d: payload });
  }

  private async onIdentified(_id: IdentifiedPayload) {
    // A REIDENTIFY (meter-subscription toggle) is also answered with an
    // Identified. That is NOT a fresh connect — the snapshot and stats
    // poll are already live, so rebuilding the whole snapshot (~20
    // round-trips) on every audio-panel open/close is pure waste. Just
    // clear the flag and keep running.
    if (this.reidentifying) {
      this.reidentifying = false;
      if (this.reidentifyTimer) {
        clearTimeout(this.reidentifyTimer);
        this.reidentifyTimer = null;
      }
      return;
    }
    // NOTE: reconnect backoff is reset only after a FULLY successful
    // snapshot (see fetchSnapshot) — not here. Resetting on identify meant
    // that an OBS that authenticates but then fails every snapshot looped
    // reconnect→identify→fail at the initial 1 s delay forever (no backoff).
    try {
      await this.fetchSnapshot();
      // Stats poll — OBS doesn't push them; the dashboard wants ~1 Hz.
      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = setInterval(() => {
        this.pollStats().catch(() => {
          /* surface via publishStatus on next disconnect */
        });
      }, STATS_POLL_MS);
    } catch (err) {
      this.publishStatus(
        "disconnected",
        err instanceof Error ? err.message : "Snapshot failed"
      );
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
    }
  }

  // ───────────────────────── Snapshot build ─────────────────────────

  private async fetchSnapshot() {
    const version = await this.request<{
      obsVersion: string;
      obsWebSocketVersion: string;
      rpcVersion: number;
      platform: string;
      platformDescription: string;
    }>("GetVersion");
    this.obsVersion = version.obsVersion;
    this.platform = version.platform;

    const stats = await this.request<ObsStats>("GetStats").catch(() => null);
    const sceneList = await this.request<{
      currentProgramSceneName: string | null;
      currentPreviewSceneName: string | null;
      scenes: Array<{ sceneName: string; sceneIndex: number; sceneUuid?: string }>;
    }>("GetSceneList");
    const studio = await this.request<{ studioModeEnabled: boolean }>(
      "GetStudioModeEnabled"
    ).catch(() => ({ studioModeEnabled: false }));

    const transitionList = await this.request<{
      currentSceneTransitionName: string | null;
      currentSceneTransitionUuid?: string;
      currentSceneTransitionKind: string;
      transitions: ObsTransition[];
    }>("GetSceneTransitionList").catch(() => ({
      currentSceneTransitionName: null,
      currentSceneTransitionKind: "",
      transitions: [] as ObsTransition[],
    }));
    const transitionDuration = await this.request<{
      transitionDuration: number;
    }>("GetCurrentSceneTransitionDuration").catch(() => ({
      transitionDuration: 0,
    }));

    const inputList = await this.request<{ inputs: ObsInput[] }>(
      "GetInputList"
    ).catch(() => ({ inputs: [] as ObsInput[] }));

    // Probe audio props per input in parallel. Failures = not an audio
    // input; we just drop them from `audioByInput`.
    const audioEntries = await Promise.all(
      inputList.inputs.map(async (i) => {
        const audio = await this.tryFetchAudio(i.inputName);
        return audio ? ([i.inputName, audio] as const) : null;
      })
    );
    const audioByInput: Record<string, ObsAudioInput> = {};
    for (const entry of audioEntries) {
      if (entry) audioByInput[entry[0]] = entry[1];
    }

    // Lazy scene items — the UI fetches per scene on demand.
    const sceneItemsByScene: Record<string, ObsSceneItem[]> = {};
    if (sceneList.currentProgramSceneName) {
      const items = await this.fetchSceneItems(
        sceneList.currentProgramSceneName
      ).catch(() => null);
      if (items) sceneItemsByScene[sceneList.currentProgramSceneName] = items;
    }
    if (
      sceneList.currentPreviewSceneName &&
      sceneList.currentPreviewSceneName !== sceneList.currentProgramSceneName
    ) {
      const items = await this.fetchSceneItems(
        sceneList.currentPreviewSceneName
      ).catch(() => null);
      if (items) sceneItemsByScene[sceneList.currentPreviewSceneName] = items;
    }

    const stream = await this.fetchStreamStatus();
    const record = await this.fetchRecordStatus();
    const replayBuffer = await this.fetchReplayBufferStatus();
    const virtualCam = await this.fetchVirtualCamStatus();

    const profileList = await this.request<{
      currentProfileName: string;
      profiles: string[];
    }>("GetProfileList").catch(() => ({
      currentProfileName: "",
      profiles: [] as string[],
    }));
    const collectionList = await this.request<{
      currentSceneCollectionName: string;
      sceneCollections: string[];
    }>("GetSceneCollectionList").catch(() => ({
      currentSceneCollectionName: "",
      sceneCollections: [] as string[],
    }));

    const video = await this.request<ObsVideoSettings>(
      "GetVideoSettings"
    ).catch(() => null);

    const scenes: ObsScene[] = sceneList.scenes
      .map((s) => ({
        uuid: s.sceneUuid ?? s.sceneName,
        name: s.sceneName,
        index: s.sceneIndex,
      }))
      // OBS returns scenes in reverse-index order; sort ascending so
      // the UI shows them top-down like the OBS scene panel.
      .sort((a, b) => a.index - b.index);

    this.snapshot = {
      obsVersion: version.obsVersion,
      obsWebSocketVersion: version.obsWebSocketVersion,
      platform: version.platform,
      rpcVersion: version.rpcVersion,
      scenes,
      sceneItemsByScene,
      currentProgramSceneName: sceneList.currentProgramSceneName,
      currentPreviewSceneName: sceneList.currentPreviewSceneName,
      studioModeEnabled: studio.studioModeEnabled,
      inputs: inputList.inputs,
      audioByInput,
      transitions: transitionList.transitions,
      currentTransitionName: transitionList.currentSceneTransitionName,
      currentTransitionDuration: transitionDuration.transitionDuration,
      stream,
      record,
      replayBuffer,
      virtualCam,
      stats: stats ?? emptyStats,
      video,
      profiles: profileList.profiles,
      currentProfile: profileList.currentProfileName || null,
      sceneCollections: collectionList.sceneCollections,
      currentSceneCollection: collectionList.currentSceneCollectionName || null,
    };

    // Full snapshot succeeded → NOW reset the reconnect backoff (a flaky
    // OBS that fails mid-snapshot keeps the grown backoff and won't storm).
    this.reconnectMs = RECONNECT_INITIAL_MS;
    // Healthy now — cancel the connect watchdog.
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.publishStatus("connected");
    this.publish({ type: "snapshot", snapshot: this.snapshot });
  }

  private async tryFetchAudio(inputName: string): Promise<ObsAudioInput | null> {
    // GetInputMute returns InputNotAudioInput (code 604) for non-audio
    // inputs — we treat any error as "this input has no audio".
    const mute = await this.request<{ inputMuted: boolean }>("GetInputMute", {
      inputName,
    }).catch(() => null);
    if (!mute) return null;

    const [vol, balance, sync, tracks, monitor] = await Promise.all([
      this.request<{ inputVolumeMul: number; inputVolumeDb: number }>(
        "GetInputVolume",
        { inputName }
      ).catch(() => ({ inputVolumeMul: 1, inputVolumeDb: 0 })),
      this.request<{ inputAudioBalance: number }>("GetInputAudioBalance", {
        inputName,
      }).catch(() => ({ inputAudioBalance: 0.5 })),
      this.request<{ inputAudioSyncOffset: number }>("GetInputAudioSyncOffset", {
        inputName,
      }).catch(() => ({ inputAudioSyncOffset: 0 })),
      this.request<{ inputAudioTracks: Record<string, boolean> }>(
        "GetInputAudioTracks",
        { inputName }
      ).catch(() => ({ inputAudioTracks: {} as Record<string, boolean> })),
      this.request<{ monitorType: string }>("GetInputAudioMonitorType", {
        inputName,
      }).catch(() => ({ monitorType: "OBS_MONITORING_TYPE_NONE" })),
    ]);

    return {
      inputName,
      muted: mute.inputMuted,
      volume: vol.inputVolumeMul,
      volumeDb: vol.inputVolumeDb,
      balance: balance.inputAudioBalance,
      syncOffsetMs: sync.inputAudioSyncOffset,
      trackBitmask: bitmaskFromTracks(tracks.inputAudioTracks),
      monitorType: monitor.monitorType,
    };
  }

  private async fetchSceneItems(sceneName: string): Promise<ObsSceneItem[]> {
    const res = await this.request<{
      sceneItems: Array<{
        sceneItemId: number;
        sourceName: string;
        sourceUuid?: string;
        sceneItemIndex: number;
        sceneItemEnabled: boolean;
        sceneItemLocked: boolean;
        inputKind: string | null;
        isGroup: boolean;
        sceneItemTransform?: ObsSceneItemTransform;
      }>;
    }>("GetSceneItemList", { sceneName });
    return res.sceneItems.map((it) => ({
      sceneItemId: it.sceneItemId,
      sourceName: it.sourceName,
      sourceUuid: it.sourceUuid,
      sceneItemIndex: it.sceneItemIndex,
      sceneItemEnabled: it.sceneItemEnabled,
      sceneItemLocked: it.sceneItemLocked,
      inputKind: it.inputKind,
      isGroup: it.isGroup,
      transform: it.sceneItemTransform,
    }));
  }

  private async fetchStreamStatus(): Promise<ObsStreamStatus> {
    return this.request<{
      outputActive: boolean;
      outputReconnecting: boolean;
      outputTimecode: string;
      outputDuration: number;
      outputCongestion: number;
      outputBytes: number;
      outputSkippedFrames: number;
      outputTotalFrames: number;
    }>("GetStreamStatus")
      .then((r) => ({
        active: r.outputActive,
        reconnecting: r.outputReconnecting,
        timecodeMs: r.outputDuration,
        bytesSent: r.outputBytes,
        skippedFrames: r.outputSkippedFrames,
        totalFrames: r.outputTotalFrames,
      }))
      .catch(() => emptyStream);
  }

  private async fetchRecordStatus(): Promise<ObsRecordStatus> {
    return this.request<{
      outputActive: boolean;
      outputPaused: boolean;
      outputTimecode: string;
      outputDuration: number;
      outputBytes: number;
    }>("GetRecordStatus")
      .then((r) => ({
        active: r.outputActive,
        paused: r.outputPaused,
        timecodeMs: r.outputDuration,
        bytes: r.outputBytes,
      }))
      .catch(() => emptyRecord);
  }

  private async fetchReplayBufferStatus(): Promise<ObsReplayBufferStatus> {
    return this.request<{ outputActive: boolean }>("GetReplayBufferStatus")
      .then((r) => ({ active: r.outputActive }))
      .catch(() => ({ active: false }));
  }

  private async fetchVirtualCamStatus(): Promise<ObsVirtualCamStatus> {
    return this.request<{ outputActive: boolean }>("GetVirtualCamStatus")
      .then((r) => ({ active: r.outputActive }))
      .catch(() => ({ active: false }));
  }

  private async pollStats() {
    if (this.status !== "connected" || !this.snapshot) return;
    const stats = await this.request<ObsStats>("GetStats");
    this.snapshot.stats = stats;
    this.publish({ type: "stats", stats });
  }

  // ───────────────────────── Event handling ─────────────────────────

  private onEvent(payload: EventPayload) {
    const d = payload.eventData;
    if (!this.snapshot) return;
    const snap = this.snapshot;

    switch (payload.eventType) {
      // ── Scenes ──────────────────────────────────────────────────
      case "SceneListChanged": {
        const scenes = ((d.scenes as Array<{
          sceneName: string;
          sceneIndex: number;
          sceneUuid?: string;
        }>) ?? []).map((s) => ({
          uuid: s.sceneUuid ?? s.sceneName,
          name: s.sceneName,
          index: s.sceneIndex,
        }));
        snap.scenes = scenes.sort((a, b) => a.index - b.index);
        // Drop cached scene-items for scenes that no longer exist —
        // otherwise a deleted scene's item array lingers in
        // `sceneItemsByScene` forever (it's only ever deleted on rename),
        // a slow bounded leak across a long session of scene churn.
        const liveNames = new Set(snap.scenes.map((s) => s.name));
        for (const name of Object.keys(snap.sceneItemsByScene)) {
          if (!liveNames.has(name)) delete snap.sceneItemsByScene[name];
        }
        this.publish({ type: "scenes-changed", scenes: snap.scenes });
        break;
      }
      case "CurrentProgramSceneChanged": {
        const name = (d.sceneName as string) ?? null;
        snap.currentProgramSceneName = name;
        this.publish({ type: "program-scene-changed", sceneName: name });
        if (name && !snap.sceneItemsByScene[name]) {
          this.fetchAndPublishSceneItems(name);
        }
        break;
      }
      case "CurrentPreviewSceneChanged": {
        const name = (d.sceneName as string) ?? null;
        snap.currentPreviewSceneName = name;
        this.publish({ type: "preview-scene-changed", sceneName: name });
        if (name && !snap.sceneItemsByScene[name]) {
          this.fetchAndPublishSceneItems(name);
        }
        break;
      }
      case "SceneNameChanged": {
        const oldName = d.oldSceneName as string;
        const newName = d.sceneName as string;
        snap.scenes = snap.scenes.map((s) =>
          s.name === oldName ? { ...s, name: newName } : s
        );
        if (snap.sceneItemsByScene[oldName]) {
          snap.sceneItemsByScene[newName] = snap.sceneItemsByScene[oldName];
          delete snap.sceneItemsByScene[oldName];
        }
        if (snap.currentProgramSceneName === oldName)
          snap.currentProgramSceneName = newName;
        if (snap.currentPreviewSceneName === oldName)
          snap.currentPreviewSceneName = newName;
        this.publish({ type: "scenes-changed", scenes: snap.scenes });
        break;
      }

      // ── Studio mode ─────────────────────────────────────────────
      case "StudioModeStateChanged": {
        snap.studioModeEnabled = Boolean(d.studioModeEnabled);
        this.publish({
          type: "studio-mode-changed",
          enabled: snap.studioModeEnabled,
        });
        break;
      }

      // ── Scene items ─────────────────────────────────────────────
      case "SceneItemCreated":
      case "SceneItemRemoved":
      case "SceneItemListReindexed": {
        const sceneName = d.sceneName as string;
        if (sceneName) this.fetchAndPublishSceneItems(sceneName);
        break;
      }
      case "SceneItemEnableStateChanged": {
        const sceneName = d.sceneName as string;
        const id = d.sceneItemId as number;
        const enabled = Boolean(d.sceneItemEnabled);
        const arr = snap.sceneItemsByScene[sceneName];
        if (arr) {
          const next = arr.map((it) =>
            it.sceneItemId === id
              ? { ...it, sceneItemEnabled: enabled }
              : it
          );
          snap.sceneItemsByScene[sceneName] = next;
        }
        this.publish({
          type: "scene-item-enabled",
          sceneName,
          sceneItemId: id,
          enabled,
        });
        break;
      }
      case "SceneItemLockStateChanged": {
        const sceneName = d.sceneName as string;
        const id = d.sceneItemId as number;
        const locked = Boolean(d.sceneItemLocked);
        const arr = snap.sceneItemsByScene[sceneName];
        if (arr) {
          snap.sceneItemsByScene[sceneName] = arr.map((it) =>
            it.sceneItemId === id ? { ...it, sceneItemLocked: locked } : it
          );
        }
        this.publish({
          type: "scene-item-locked",
          sceneName,
          sceneItemId: id,
          locked,
        });
        break;
      }
      case "SceneItemTransformChanged": {
        const sceneName = d.sceneName as string;
        const id = d.sceneItemId as number;
        const transform = d.sceneItemTransform as ObsSceneItemTransform;
        const arr = snap.sceneItemsByScene[sceneName];
        if (arr) {
          snap.sceneItemsByScene[sceneName] = arr.map((it) =>
            it.sceneItemId === id ? { ...it, transform } : it
          );
        }
        this.publish({
          type: "scene-item-transform",
          sceneName,
          sceneItemId: id,
          transform,
        });
        break;
      }

      // ── Inputs ──────────────────────────────────────────────────
      case "InputCreated":
      case "InputRemoved":
      case "InputNameChanged": {
        // Resync the input list so audio bookkeeping is consistent.
        this.refetchInputs();
        break;
      }
      case "InputMuteStateChanged": {
        const inputName = d.inputName as string;
        const muted = Boolean(d.inputMuted);
        const audio = snap.audioByInput[inputName];
        if (audio) snap.audioByInput[inputName] = { ...audio, muted };
        this.publish({ type: "input-mute", inputName, muted });
        break;
      }
      case "InputVolumeChanged": {
        const inputName = d.inputName as string;
        const volume = safeNum(d.inputVolumeMul, 1);
        const volumeDb = safeNum(d.inputVolumeDb, 0);
        const audio = snap.audioByInput[inputName];
        if (audio)
          snap.audioByInput[inputName] = {
            ...audio,
            volume,
            volumeDb,
          };
        this.publish({ type: "input-volume", inputName, volume, volumeDb });
        break;
      }
      case "InputAudioBalanceChanged": {
        const inputName = d.inputName as string;
        const balance = safeNum(d.inputAudioBalance, 0.5);
        const audio = snap.audioByInput[inputName];
        if (audio) snap.audioByInput[inputName] = { ...audio, balance };
        this.publish({ type: "input-balance", inputName, balance });
        break;
      }
      case "InputAudioSyncOffsetChanged": {
        const inputName = d.inputName as string;
        const syncOffsetMs = safeNum(d.inputAudioSyncOffset, 0);
        const audio = snap.audioByInput[inputName];
        if (audio)
          snap.audioByInput[inputName] = { ...audio, syncOffsetMs };
        this.publish({ type: "input-sync-offset", inputName, syncOffsetMs });
        break;
      }
      case "InputAudioTracksChanged": {
        const inputName = d.inputName as string;
        const trackBitmask = bitmaskFromTracks(
          d.inputAudioTracks as Record<string, boolean>
        );
        const audio = snap.audioByInput[inputName];
        if (audio)
          snap.audioByInput[inputName] = { ...audio, trackBitmask };
        this.publish({ type: "input-tracks", inputName, trackBitmask });
        break;
      }
      case "InputAudioMonitorTypeChanged": {
        const inputName = d.inputName as string;
        const monitorType = String(d.monitorType);
        const audio = snap.audioByInput[inputName];
        if (audio)
          snap.audioByInput[inputName] = { ...audio, monitorType };
        this.publish({ type: "input-monitor-type", inputName, monitorType });
        break;
      }

      // ── Transitions ─────────────────────────────────────────────
      case "CurrentSceneTransitionChanged": {
        const name = (d.transitionName as string) ?? null;
        snap.currentTransitionName = name;
        this.publish({
          type: "current-transition",
          name,
          duration: snap.currentTransitionDuration,
        });
        break;
      }
      case "CurrentSceneTransitionDurationChanged": {
        const duration = safeNum(d.transitionDuration, snap.currentTransitionDuration);
        snap.currentTransitionDuration = duration;
        this.publish({ type: "transition-duration", duration });
        break;
      }

      // ── Output state ────────────────────────────────────────────
      case "StreamStateChanged": {
        const active = Boolean(d.outputActive);
        snap.stream = { ...snap.stream, active };
        this.publish({ type: "stream-state", status: snap.stream });
        // Refresh full status to capture timecodes/bytes.
        this.fetchStreamStatus().then((s) => {
          if (this.snapshot) {
            this.snapshot.stream = s;
            this.publish({ type: "stream-state", status: s });
          }
        });
        break;
      }
      case "RecordStateChanged": {
        const active = Boolean(d.outputActive);
        snap.record = { ...snap.record, active };
        this.publish({ type: "record-state", status: snap.record });
        this.fetchRecordStatus().then((s) => {
          if (this.snapshot) {
            this.snapshot.record = s;
            this.publish({ type: "record-state", status: s });
          }
        });
        break;
      }
      case "ReplayBufferStateChanged": {
        const active = Boolean(d.outputActive);
        snap.replayBuffer = { active };
        this.publish({ type: "replay-buffer-state", status: snap.replayBuffer });
        break;
      }
      case "VirtualcamStateChanged": {
        const active = Boolean(d.outputActive);
        snap.virtualCam = { active };
        this.publish({ type: "virtual-cam-state", status: snap.virtualCam });
        break;
      }
      case "ReplayBufferSaved": {
        const path = String(d.savedReplayPath ?? "");
        this.publish({ type: "replay-buffer-saved", path });
        break;
      }

      // ── Media ───────────────────────────────────────────────────
      case "MediaInputPlaybackStarted":
      case "MediaInputPlaybackEnded":
      case "MediaInputActionTriggered": {
        const inputName = d.inputName as string;
        const state = String(d.mediaState ?? payload.eventType);
        this.publish({ type: "media-state", inputName, state });
        break;
      }

      // ── Config (profile / scene collection) ─────────────────────
      case "CurrentProfileChanged": {
        const name = (d.profileName as string) ?? null;
        snap.currentProfile = name;
        this.publish({ type: "current-profile", name });
        break;
      }
      case "ProfileListChanged": {
        const profiles = (d.profiles as string[]) ?? [];
        snap.profiles = profiles;
        this.publish({ type: "profiles-changed", profiles });
        break;
      }
      case "CurrentSceneCollectionChanged": {
        const name = (d.sceneCollectionName as string) ?? null;
        snap.currentSceneCollection = name;
        this.publish({ type: "current-scene-collection", name });
        // Scene collection switch wipes scenes — rebuild snapshot.
        this.fetchSnapshot().catch(() => {
          /* publishStatus on close */
        });
        break;
      }
      case "SceneCollectionListChanged": {
        const collections = (d.sceneCollections as string[]) ?? [];
        snap.sceneCollections = collections;
        this.publish({ type: "scene-collections-changed", collections });
        break;
      }

      // ── Video settings ──────────────────────────────────────────
      case "VideoSettingsChanged": {
        const video: ObsVideoSettings = {
          fpsNumerator: Number(d.fpsNumerator ?? 60),
          fpsDenominator: Number(d.fpsDenominator ?? 1),
          baseWidth: Number(d.baseWidth ?? 1920),
          baseHeight: Number(d.baseHeight ?? 1080),
          outputWidth: Number(d.outputWidth ?? 1920),
          outputHeight: Number(d.outputHeight ?? 1080),
        };
        snap.video = video;
        this.publish({ type: "video-settings", video });
        break;
      }

      // ── Active state (videoActive/videoShowing) ─────────────────
      case "InputActiveStateChanged": {
        this.publish({
          type: "input-active",
          inputName: String(d.inputName),
          videoActive: Boolean(d.videoActive),
          videoShowing: false,
        });
        break;
      }
      case "InputShowStateChanged": {
        this.publish({
          type: "input-active",
          inputName: String(d.inputName),
          videoActive: false,
          videoShowing: Boolean(d.videoShowing),
        });
        break;
      }

      // ── Volume meters (60 Hz when subscribed) ───────────────────
      case "InputVolumeMeters": {
        const inputs = (d.inputs as Array<{
          inputName: string;
          inputLevelsMul: number[][];
        }>) ?? [];
        this.publish({
          type: "volume-meters",
          inputs: inputs.map((i) => ({
            inputName: i.inputName,
            levels: (i.inputLevelsMul ?? []).map((ch) => {
              const [mag = 0, peak = 0, hold = 0] = ch;
              // OBS sends linear multipliers; convert to dB so the UI
              // can render a log-scale meter without recomputing per
              // tick.
              const toDb = (v: number) =>
                v <= 0 ? -100 : 20 * Math.log10(v);
              return [toDb(mag), toDb(peak), toDb(hold)] as [
                number,
                number,
                number
              ];
            }),
          })),
        });
        break;
      }

      // ── OBS shutdown ─────────────────────────────────────────────
      case "ExitStarted": {
        this.publish({ type: "exit-started" });
        break;
      }
    }
  }

  private async fetchAndPublishSceneItems(sceneName: string) {
    try {
      const items = await this.fetchSceneItems(sceneName);
      if (this.snapshot) {
        this.snapshot.sceneItemsByScene[sceneName] = items;
      }
      this.publish({ type: "scene-items-changed", sceneName, items });
    } catch {
      /* ignore — likely a scene that vanished mid-flight */
    }
  }

  private async refetchInputs() {
    try {
      const inputList = await this.request<{ inputs: ObsInput[] }>(
        "GetInputList"
      );
      if (this.snapshot) {
        this.snapshot.inputs = inputList.inputs;
      }
      this.publish({ type: "input-list-changed", inputs: inputList.inputs });
    } catch {
      /* silent */
    }
  }

  // ───────────────────────── Public commands ────────────────────────

  setCurrentScene(sceneName: string) {
    return this.request("SetCurrentProgramScene", { sceneName });
  }
  setPreviewScene(sceneName: string) {
    return this.request("SetCurrentPreviewScene", { sceneName });
  }
  triggerStudioTransition() {
    return this.request("TriggerStudioModeTransition");
  }
  setStudioMode(enabled: boolean) {
    return this.request("SetStudioModeEnabled", { studioModeEnabled: enabled });
  }
  setCurrentTransition(transitionName: string) {
    return this.request("SetCurrentSceneTransition", { transitionName });
  }
  setTransitionDuration(ms: number) {
    return this.request("SetCurrentSceneTransitionDuration", {
      transitionDuration: ms,
    });
  }
  toggleStream() {
    return this.request("ToggleStream");
  }
  startStream() {
    return this.request("StartStream");
  }
  stopStream() {
    return this.request("StopStream");
  }
  toggleRecord() {
    return this.request("ToggleRecord");
  }
  startRecord() {
    return this.request("StartRecord");
  }
  stopRecord() {
    return this.request("StopRecord");
  }
  pauseRecord() {
    return this.request("PauseRecord");
  }
  resumeRecord() {
    return this.request("ResumeRecord");
  }
  toggleReplayBuffer() {
    return this.request("ToggleReplayBuffer");
  }
  saveReplayBuffer() {
    return this.request("SaveReplayBuffer");
  }
  toggleVirtualCam() {
    return this.request("ToggleVirtualCam");
  }
  setMute(inputName: string, muted: boolean) {
    return this.request("SetInputMute", { inputName, inputMuted: muted });
  }
  toggleMute(inputName: string) {
    return this.request("ToggleInputMute", { inputName });
  }
  setVolumeMul(inputName: string, volumeMul: number) {
    return this.request("SetInputVolume", {
      inputName,
      inputVolumeMul: volumeMul,
    });
  }
  setVolumeDb(inputName: string, volumeDb: number) {
    return this.request("SetInputVolume", {
      inputName,
      inputVolumeDb: volumeDb,
    });
  }
  setAudioBalance(inputName: string, balance: number) {
    return this.request("SetInputAudioBalance", {
      inputName,
      inputAudioBalance: balance,
    });
  }
  setAudioSyncOffset(inputName: string, ms: number) {
    return this.request("SetInputAudioSyncOffset", {
      inputName,
      inputAudioSyncOffset: ms,
    });
  }
  setAudioMonitorType(inputName: string, monitorType: string) {
    return this.request("SetInputAudioMonitorType", {
      inputName,
      monitorType,
    });
  }
  setSceneItemEnabled(
    sceneName: string,
    sceneItemId: number,
    enabled: boolean
  ) {
    return this.request("SetSceneItemEnabled", {
      sceneName,
      sceneItemId,
      sceneItemEnabled: enabled,
    });
  }
  setSceneItemLocked(
    sceneName: string,
    sceneItemId: number,
    locked: boolean
  ) {
    return this.request("SetSceneItemLocked", {
      sceneName,
      sceneItemId,
      sceneItemLocked: locked,
    });
  }
  triggerMediaAction(inputName: string, action: string) {
    return this.request("TriggerMediaInputAction", {
      inputName,
      mediaAction: action,
    });
  }
  setMediaCursor(inputName: string, cursorMs: number) {
    return this.request("SetMediaInputCursor", {
      inputName,
      mediaCursor: cursorMs,
    });
  }
  triggerHotkey(name: string) {
    return this.request("TriggerHotkeyByName", { hotkeyName: name });
  }
  setCurrentProfile(name: string) {
    return this.request("SetCurrentProfile", { profileName: name });
  }
  setCurrentSceneCollection(name: string) {
    return this.request("SetCurrentSceneCollection", {
      sceneCollectionName: name,
    });
  }
  /** Forward a raw request — escape hatch for actions not wrapped above. */
  rawRequest(requestType: string, requestData?: Record<string, unknown>) {
    return this.request(requestType, requestData);
  }
  /** Manually request a scene's items — used by the UI when the user
   *  expands a scene we haven't fetched yet. */
  ensureSceneItems(sceneName: string) {
    if (this.snapshot?.sceneItemsByScene[sceneName]) return Promise.resolve();
    return this.fetchAndPublishSceneItems(sceneName);
  }
  /** Fetch a PNG screenshot of any source/scene as base64 — used to drive
   *  the live thumbnails in the OBS page. */
  async getSourceScreenshot(
    sourceName: string,
    width?: number,
    height?: number
  ): Promise<string> {
    const data = await this.request<{ imageData: string }>(
      "GetSourceScreenshot",
      {
        sourceName,
        imageFormat: "png",
        ...(width ? { imageWidth: width } : {}),
        ...(height ? { imageHeight: height } : {}),
      },
      SCREENSHOT_TIMEOUT_MS
    );
    return data.imageData;
  }
  setVolumeMetersEnabled(on: boolean) {
    this.subscriptions = on
      ? SUBSCRIPTIONS_WITH_METERS
      : DEFAULT_EVENT_SUBSCRIPTIONS;
    if (this.status !== "connected") return;
    // Mark the next Identified as a re-identify so onIdentified skips the
    // full snapshot rebuild (the data is already current). Guard it with a
    // watchdog: if OBS never answers, clear the flag so a later real connect
    // still rebuilds its snapshot.
    this.reidentifying = true;
    if (this.reidentifyTimer) clearTimeout(this.reidentifyTimer);
    this.reidentifyTimer = setTimeout(() => {
      this.reidentifyTimer = null;
      this.reidentifying = false;
    }, 3_000);
    this.send({
      op: OP_REIDENTIFY,
      d: { eventSubscriptions: this.subscriptions },
    });
  }

  // ── Studio Mode T-bar ───────────────────────────────────────────
  setTBarPosition(position: number, release = false) {
    return this.request("SetTBarPosition", {
      position: Math.max(0, Math.min(1, position)),
      release,
    });
  }

  // ── Per-scene transition override ───────────────────────────────
  getSceneTransitionOverride(sceneName: string) {
    return this.request<{
      transitionName: string | null;
      transitionDuration: number | null;
    }>("GetSceneTransitionOverride", { sceneName });
  }
  setSceneTransitionOverride(
    sceneName: string,
    transitionName: string | null,
    transitionDuration: number | null
  ) {
    return this.request("SetSceneTransitionOverride", {
      sceneName,
      transitionName,
      transitionDuration,
    });
  }

  // ── Record extras ───────────────────────────────────────────────
  getRecordDirectory() {
    return this.request<{ recordDirectory: string }>("GetRecordDirectory");
  }
  setRecordDirectory(recordDirectory: string) {
    return this.request("SetRecordDirectory", { recordDirectory });
  }
  splitRecordFile() {
    return this.request("SplitRecordFile");
  }
  createRecordChapter(chapterName?: string) {
    return this.request("CreateRecordChapter", chapterName ? { chapterName } : {});
  }

  // ── Stream extras ───────────────────────────────────────────────
  sendStreamCaption(text: string) {
    return this.request("SendStreamCaption", { captionText: text });
  }
  getStreamServiceSettings() {
    return this.request<{
      streamServiceType: string;
      streamServiceSettings: Record<string, unknown>;
    }>("GetStreamServiceSettings");
  }
  setStreamServiceSettings(
    streamServiceType: string,
    streamServiceSettings: Record<string, unknown>
  ) {
    return this.request("SetStreamServiceSettings", {
      streamServiceType,
      streamServiceSettings,
    });
  }

  // ── Outputs (custom: NDI, file, ...) ────────────────────────────
  getOutputList() {
    return this.request<{
      outputs: Array<{
        outputName: string;
        outputKind: string;
        outputWidth: number;
        outputHeight: number;
        outputActive: boolean;
        outputFlags: Record<string, boolean>;
      }>;
    }>("GetOutputList");
  }
  getOutputStatus(outputName: string) {
    return this.request("GetOutputStatus", { outputName });
  }
  startOutput(outputName: string) {
    return this.request("StartOutput", { outputName });
  }
  stopOutput(outputName: string) {
    return this.request("StopOutput", { outputName });
  }
  toggleOutput(outputName: string) {
    return this.request("ToggleOutput", { outputName });
  }
  getOutputSettings(outputName: string) {
    return this.request<{ outputSettings: Record<string, unknown> }>(
      "GetOutputSettings",
      { outputName }
    );
  }
  setOutputSettings(
    outputName: string,
    outputSettings: Record<string, unknown>
  ) {
    return this.request("SetOutputSettings", { outputName, outputSettings });
  }

  // ── Source activity probe ───────────────────────────────────────
  getSourceActive(sourceName: string) {
    return this.request<{
      videoActive: boolean;
      videoShowing: boolean;
    }>("GetSourceActive", { sourceName });
  }

  // ── Browser source refresh (and any other "click-button" prop) ──
  pressInputPropertiesButton(inputName: string, propertyName: string) {
    return this.request("PressInputPropertiesButton", {
      inputName,
      propertyName,
    });
  }
  refreshBrowserSource(inputName: string) {
    // Browser sources expose a "refreshnocache" button. Calling it
    // forces a hard reload of the page including ignoring caches.
    return this.pressInputPropertiesButton(inputName, "refreshnocache");
  }

  // ── Scene CRUD ──────────────────────────────────────────────────
  createScene(sceneName: string) {
    return this.request("CreateScene", { sceneName });
  }
  removeScene(sceneName: string) {
    return this.request("RemoveScene", { sceneName });
  }
  setSceneName(sceneName: string, newSceneName: string) {
    return this.request("SetSceneName", { sceneName, newSceneName });
  }

  // ── Scene-item CRUD / blend / reorder ───────────────────────────
  createSceneItem(sceneName: string, sourceName: string, enabled = true) {
    return this.request<{ sceneItemId: number }>("CreateSceneItem", {
      sceneName,
      sourceName,
      sceneItemEnabled: enabled,
    });
  }
  removeSceneItem(sceneName: string, sceneItemId: number) {
    return this.request("RemoveSceneItem", { sceneName, sceneItemId });
  }
  duplicateSceneItem(
    sceneName: string,
    sceneItemId: number,
    destinationSceneName?: string
  ) {
    return this.request("DuplicateSceneItem", {
      sceneName,
      sceneItemId,
      ...(destinationSceneName ? { destinationSceneName } : {}),
    });
  }
  setSceneItemIndex(
    sceneName: string,
    sceneItemId: number,
    sceneItemIndex: number
  ) {
    return this.request("SetSceneItemIndex", {
      sceneName,
      sceneItemId,
      sceneItemIndex,
    });
  }
  setSceneItemBlendMode(
    sceneName: string,
    sceneItemId: number,
    sceneItemBlendMode: string
  ) {
    return this.request("SetSceneItemBlendMode", {
      sceneName,
      sceneItemId,
      sceneItemBlendMode,
    });
  }
  setSceneItemTransform(
    sceneName: string,
    sceneItemId: number,
    sceneItemTransform: Record<string, unknown>
  ) {
    return this.request("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform,
    });
  }

  // ── Input CRUD + settings ───────────────────────────────────────
  createInput(
    sceneName: string,
    inputName: string,
    inputKind: string,
    inputSettings?: Record<string, unknown>,
    sceneItemEnabled = true
  ) {
    return this.request("CreateInput", {
      sceneName,
      inputName,
      inputKind,
      inputSettings,
      sceneItemEnabled,
    });
  }
  removeInput(inputName: string) {
    return this.request("RemoveInput", { inputName });
  }
  setInputName(inputName: string, newInputName: string) {
    return this.request("SetInputName", { inputName, newInputName });
  }
  getInputSettings(inputName: string) {
    return this.request<{
      inputKind: string;
      inputSettings: Record<string, unknown>;
    }>("GetInputSettings", { inputName });
  }
  setInputSettings(
    inputName: string,
    inputSettings: Record<string, unknown>,
    overlay = true
  ) {
    return this.request("SetInputSettings", {
      inputName,
      inputSettings,
      overlay,
    });
  }
  getInputKindList(unversioned = false) {
    return this.request<{ inputKinds: string[] }>("GetInputKindList", {
      unversioned,
    });
  }
  getSpecialInputs() {
    return this.request<{
      desktop1: string | null;
      desktop2: string | null;
      mic1: string | null;
      mic2: string | null;
      mic3: string | null;
      mic4: string | null;
    }>("GetSpecialInputs");
  }

  // ── Filter CRUD / settings ──────────────────────────────────────
  createSourceFilter(
    sourceName: string,
    filterName: string,
    filterKind: string,
    filterSettings?: Record<string, unknown>
  ) {
    return this.request("CreateSourceFilter", {
      sourceName,
      filterName,
      filterKind,
      filterSettings,
    });
  }
  removeSourceFilter(sourceName: string, filterName: string) {
    return this.request("RemoveSourceFilter", { sourceName, filterName });
  }
  setSourceFilterIndex(
    sourceName: string,
    filterName: string,
    filterIndex: number
  ) {
    return this.request("SetSourceFilterIndex", {
      sourceName,
      filterName,
      filterIndex,
    });
  }
  setSourceFilterSettings(
    sourceName: string,
    filterName: string,
    filterSettings: Record<string, unknown>,
    overlay = true
  ) {
    return this.request("SetSourceFilterSettings", {
      sourceName,
      filterName,
      filterSettings,
      overlay,
    });
  }
  setSourceFilterName(
    sourceName: string,
    filterName: string,
    newFilterName: string
  ) {
    return this.request("SetSourceFilterName", {
      sourceName,
      filterName,
      newFilterName,
    });
  }
  getSourceFilterKindList() {
    return this.request<{ filterKinds: string[] }>("GetSourceFilterKindList");
  }
  getSourceFilterDefaultSettings(filterKind: string) {
    return this.request<{ defaultFilterSettings: Record<string, unknown> }>(
      "GetSourceFilterDefaultSettings",
      { filterKind }
    );
  }

  // ── Replay extras ───────────────────────────────────────────────
  getLastReplayBufferReplay() {
    return this.request<{ savedReplayPath: string }>(
      "GetLastReplayBufferReplay"
    );
  }

  // ── Monitors / displays ─────────────────────────────────────────
  getMonitorList() {
    return this.request<{
      monitors: Array<{
        monitorIndex: number;
        monitorName: string;
        monitorWidth: number;
        monitorHeight: number;
        monitorPositionX: number;
        monitorPositionY: number;
      }>;
    }>("GetMonitorList");
  }

  // ── Profile params (advanced) ───────────────────────────────────
  getProfileParameter(parameterCategory: string, parameterName: string) {
    return this.request<{
      parameterValue: string;
      defaultParameterValue: string;
    }>("GetProfileParameter", { parameterCategory, parameterName });
  }
  setProfileParameter(
    parameterCategory: string,
    parameterName: string,
    parameterValue: string
  ) {
    return this.request("SetProfileParameter", {
      parameterCategory,
      parameterName,
      parameterValue,
    });
  }

  // ── Vendor (plugin) requests ────────────────────────────────────
  callVendor(
    vendorName: string,
    requestType: string,
    requestData?: Record<string, unknown>
  ) {
    return this.request("CallVendorRequest", {
      vendorName,
      requestType,
      requestData,
    });
  }

  // ── Broadcast custom event (cross-client signalling) ────────────
  broadcastCustomEvent(eventData: Record<string, unknown>) {
    return this.request("BroadcastCustomEvent", { eventData });
  }

  // ───────────────────────── Test connection ────────────────────────

  async testConnection(): Promise<
    | { ok: true; version: string; webSocketVersion: string }
    | { ok: false; error: string }
  > {
    // Use a temporary subscribe to keep the socket alive for the probe.
    const unsub = this.subscribe(() => {});
    try {
      const deadline = Date.now() + 4000;
      while (this.status !== "connected" && Date.now() < deadline) {
        if (this.status === "disconnected" && this.lastStatusEvent) {
          const ev = this.lastStatusEvent;
          if (ev.type === "status" && ev.error) {
            return { ok: false, error: ev.error };
          }
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (this.status !== "connected") {
        return { ok: false, error: "Timed out waiting for OBS" };
      }
      return {
        ok: true,
        version: this.obsVersion ?? "?",
        webSocketVersion: this.obsWebSocketVersion ?? "?",
      };
    } finally {
      unsub();
    }
  }

  // ───────────────────────── Request/reply ──────────────────────────

  private request<T = Record<string, unknown>>(
    requestType: string,
    requestData?: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (!this.ws || this.status === "disconnected") {
      return Promise.reject(new Error("OBS not connected"));
    }
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timeout: ${requestType}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (data) => resolve((data ?? {}) as T),
        reject,
        timer,
      });
      const envelope: RequestEnvelope = {
        op: OP_REQUEST,
        d: { requestType, requestId, requestData },
      };
      this.send(envelope);
    });
  }

  private onRequestResponse(payload: ResponsePayload) {
    const slot = this.pending.get(payload.requestId);
    if (!slot) return;
    clearTimeout(slot.timer);
    this.pending.delete(payload.requestId);
    if (payload.requestStatus.result) {
      slot.resolve(payload.responseData);
    } else {
      slot.reject(
        new Error(
          payload.requestStatus.comment ||
            `${payload.requestType} failed (code ${payload.requestStatus.code})`
        )
      );
    }
  }

  private send(envelope: unknown) {
    if (!this.ws) return;
    try {
      this.ws.send(JSON.stringify(envelope));
    } catch {
      /* connection died; close handler will fire */
    }
  }

  // ───────────────────────── Publishing ─────────────────────────────

  private publishStatus(status: ObsConnectionStatus, error?: string) {
    this.status = status;
    const event: ObsEvent = {
      type: "status",
      status,
      host: this.host,
      port: this.port,
      obsVersion: this.obsVersion,
      obsWebSocketVersion: this.obsWebSocketVersion,
      error,
    };
    this.lastStatusEvent = event;
    this.publish(event);
  }

  private publish(e: ObsEvent) {
    for (const sub of this.subscribers) {
      try {
        sub(e);
      } catch {
        /* a misbehaving subscriber should not break the broker */
      }
    }
  }
}

/**
 * Collapse OBS's "track1..track6 → boolean" map into a single 6-bit
 * bitmask. OBS itself uses bitmasks internally but the API exposes the
 * map shape — we normalize here so the UI never has to think about it.
 */
/** Coerce an OBS event field to a finite number, falling back when the
 *  field is missing/garbage so a malformed event never writes `NaN` into
 *  the snapshot (which then renders as `NaN` on faders). */
function safeNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bitmaskFromTracks(tracks: Record<string, boolean>): number {
  let m = 0;
  for (let i = 1; i <= 6; i++) {
    if (tracks[`${i}`] || tracks[`track${i}`]) m |= 1 << (i - 1);
  }
  return m;
}

