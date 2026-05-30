import { createSocket, type Socket } from "node:dgram";
import { decodePacket, encodeMessage, type OscArg } from "./osc-codec";
// Namespace import: lets us call `cmd.fireClip(...)` etc. without the
// `as cmdFireClip` alias dance that was required to avoid collisions
// with the broker's own method names (fireClip / stopTrack / play ...).
import * as cmd from "./commands";
import type {
  AbletonEvent,
  AbletonSnapshot,
  AbletonTrack,
  AbletonScene,
  AbletonClipSlot,
  AbletonTransport,
} from "./types";

/**
 * Per-instance AbletonOSC broker. ONE per configured Ableton connection
 * — each owns its own UDP socket + state.
 *
 *   • Subscriber model — SSE handlers `subscribe()` to receive snapshot
 *     and incremental events.
 *   • Push-driven — we ask Ableton ONCE for a snapshot then rely on
 *     `start_listen/*` so meters/state changes arrive without polling.
 *   • Self-healing — `/live/test` ping every PING_MS; if no reply within
 *     STALE_MS we mark disconnected and keep pinging; on first reply we
 *     re-fetch the snapshot and re-subscribe.
 */

export interface AbletonBrokerConfig {
  host: string;
  sendPort: number;
  recvPort: number;
}

type Subscriber = (e: AbletonEvent) => void;

const PING_MS = 2_000;
const STALE_MS = 5_000;
/** Tracks per track_data call. Keeps packets under typical UDP MTU. */
const TRACK_DATA_CHUNK = 6;
/** How often we resync current_song_time while playing. Cheap (1 msg). */
const SONGTIME_RESYNC_MS = 1_500;
/**
 * Grace period after the last subscriber leaves before we tear down the
 * socket. testConnection() subscribes a noop and immediately unsubs;
 * without this the socket would be rebuilt from scratch on every test,
 * losing any in-flight pending request and forcing a full snapshot
 * refetch on the next connection.
 */
const STOP_GRACE_MS = 3_000;

export class AbletonBroker {
  private subscribers = new Set<Subscriber>();
  private socket: Socket | null = null;

  private host: string;
  private sendPort: number;
  private recvPort: number;

  constructor(config: AbletonBrokerConfig) {
    this.host = config.host;
    this.sendPort = config.sendPort;
    this.recvPort = config.recvPort;
  }

  private connected = false;
  private lastReplyTs = 0;
  private snapshot: AbletonSnapshot | null = null;
  private version: string | undefined;
  private lastStatusEvent: AbletonEvent | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private songTimeTimer: ReturnType<typeof setInterval> | null = null;
  /** Deferred-stop handle. See STOP_GRACE_MS — gives consecutive
   *  testConnection() calls a chance to reuse the warm socket. */
  private stopGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Exponential backoff state for socket bind failures (EADDRINUSE). */
  private bindBackoffMs = 1_000;
  private nextBindAttemptTs = 0;
  private snapshotInFlight = false;
  private listening = new Set<number>();
  /** Per-track index of the clip whose `playing_position` we're listening
   *  to. Lets us cleanly unsub when the playing slot changes. */
  private positionListening = new Map<number, number>();

  /** Per-address one-shot resolvers used during the initial snapshot. */
  private pending = new Map<string, Array<(args: OscArg[]) => void>>();

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    // If we were in the grace window waiting to shut down, cancel —
    // a new subscriber arriving means we want to keep the socket.
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
    // New subscriber: replay the latest status + snapshot so the UI can
    // render immediately without a round-trip.
    if (this.lastStatusEvent) cb(this.lastStatusEvent);
    if (this.snapshot) cb({ type: "snapshot", snapshot: this.snapshot });
    if (this.subscribers.size === 1 && !this.pingTimer) this.start();
    return () => this.unsubscribe(cb);
  }

  private unsubscribe(cb: Subscriber) {
    this.subscribers.delete(cb);
    if (this.subscribers.size === 0) {
      // Defer the actual teardown — quick re-subscriptions (back-to-back
      // testConnection calls, route remounts) will land before the timer
      // fires and cancel it.
      if (this.stopGraceTimer) clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = setTimeout(() => {
        this.stopGraceTimer = null;
        if (this.subscribers.size === 0) this.stop();
      }, STOP_GRACE_MS);
    }
  }

  /** Send a command from a route handler. Returns false if not connected. */
  sendRaw(address: string, args: OscArg[] = []): boolean {
    if (!this.socket) this.openSocket();
    if (!this.socket) return false;
    try {
      const buf = encodeMessage({ address, args });
      this.socket.send(buf, this.sendPort, this.host);
      return true;
    } catch {
      return false;
    }
  }

  fireClip(track: number, scene: number) {
    const m = cmd.fireClip(track, scene);
    return this.sendRaw(m.address, m.args);
  }

  stopTrack(track: number) {
    const m = cmd.stopTrack(track);
    return this.sendRaw(m.address, m.args);
  }

  stopAll() {
    const m = cmd.stopAllClips();
    return this.sendRaw(m.address, m.args);
  }

  // ─── V2 transport commands ───────────────────────────────────

  play() {
    const m = cmd.playTransport();
    return this.sendRaw(m.address, m.args);
  }
  stopSong() {
    const m = cmd.stopTransport();
    return this.sendRaw(m.address, m.args);
  }
  continueSong() {
    const m = cmd.continueTransport();
    return this.sendRaw(m.address, m.args);
  }
  tap() {
    const m = cmd.tapTempo();
    return this.sendRaw(m.address, m.args);
  }
  setTempo(bpm: number) {
    const m = cmd.setTempo(bpm);
    return this.sendRaw(m.address, m.args);
  }
  toggleMetronome(on: boolean) {
    const m = cmd.setMetronome(on);
    return this.sendRaw(m.address, m.args);
  }

  /** Apply a new config and rebind on the new recv port if host/ports
   *  changed. Called by the registry on reconcile (per-instance). */
  updateConfig(config: AbletonBrokerConfig) {
    const changed =
      config.host !== this.host ||
      config.sendPort !== this.sendPort ||
      config.recvPort !== this.recvPort;
    this.host = config.host;
    this.sendPort = config.sendPort;
    this.recvPort = config.recvPort;
    if (changed && this.socket) {
      // Unsubscribe cleanly from the OLD host before tearing down the
      // socket so we don't leave it spraying listener replies at us.
      this.sendUnsubscribeAll();
      this.closeSocket();
      this.openSocket();
      this.connected = false;
      this.snapshot = null;
      this.listening.clear();
      this.positionListening.clear();
      this.publishStatus("connecting");
    }
  }

  /**
   * Current connection state. Public read of the otherwise-internal
   * `connected` flag so the device-registry adapter can report health
   * without subscribing to events.
   */
  getStatus(): "connected" | "disconnected" {
    return this.connected ? "connected" : "disconnected";
  }

  /**
   * Force a fresh `track_data` + scene-name fetch. AbletonOSC doesn't
   * push notifications when clips are added/removed or when track/scene
   * counts change, so the cached snapshot drifts as soon as the user
   * edits the Live session. The UI calls this from a manual button and
   * on tab focus to re-sync.
   *
   * Re-clears the per-track listening bookkeeping inside `fetchSnapshot`,
   * which re-issues `start_listen` for the new track count — so adding
   * tracks doesn't leave them silently unlistened.
   */
  refreshSnapshot() {
    if (!this.connected) return false;
    // `snapshotInFlight` inside fetchSnapshot guards against parallel
    // calls (focus event + button mash). Cheap to fire-and-forget;
    // failures publish a disconnect status and the next ping recovers.
    this.fetchSnapshot().catch(() => {
      /* publishStatus already reflects the failure */
    });
    return true;
  }

  /**
   * One-shot probe for the "Test connection" button. AbletonOSC always
   * replies to port 11001 (it ignores the source port), so we can't use
   * a separate socket — we route the test through the broker itself.
   * A no-op subscription keeps the broker alive for the duration of the
   * test, even if there are no real SSE subscribers yet.
   */
  async testConnection(
    timeoutMs = 1500
  ): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
    const unsub = this.subscribe(() => {});
    try {
      const args = await this.request(
        cmd.getVersion(),
        "/live/application/get/version",
        timeoutMs
      );
      const version = args.map((a) => String(a)).join(".");
      return { ok: true, version };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Timed out",
      };
    } finally {
      unsub();
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  private start() {
    this.openSocket();
    this.pingTimer = setInterval(() => this.tickPing(), PING_MS);
    // While playing, fetch current_song_time so the UI can resync. Keeps
    // the position counter accurate after tempo changes or scrubbing.
    this.songTimeTimer = setInterval(() => {
      if (this.connected && this.snapshot?.transport?.isPlaying) {
        const m = cmd.getCurrentSongTime();
        this.sendRaw(m.address, m.args);
      }
    }, SONGTIME_RESYNC_MS);
    this.publishStatus("connecting");
    // Kick off an immediate ping/snapshot rather than waiting PING_MS.
    this.tickPing();
  }

  /**
   * Public dispose hook for hot-reload cleanup. Stops timers, unsubs
   * from AbletonOSC, closes the socket. Same effect as the internal
   * `stop()` that fires when the last SSE subscriber leaves.
   */
  dispose() {
    this.stop();
  }

  private stop() {
    if (this.stopGraceTimer) {
      clearTimeout(this.stopGraceTimer);
      this.stopGraceTimer = null;
    }
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.songTimeTimer) clearInterval(this.songTimeTimer);
    this.pingTimer = null;
    this.songTimeTimer = null;
    // Politely tell AbletonOSC we're going away. Without this it keeps
    // every `start_listen` registered and spams packets to a port we
    // no longer hold — across many dev hot-reloads the Python side
    // accumulates dozens of dead listeners and wastes CPU.
    this.sendUnsubscribeAll();
    this.closeSocket();
    this.connected = false;
    this.lastReplyTs = 0;
    this.snapshot = null;
    this.version = undefined;
    this.lastStatusEvent = null;
    this.listening.clear();
    this.positionListening.clear();
    this.pending.clear();
  }

  /**
   * Best-effort `stop_listen/*` blast for every active subscription
   * before we tear down the socket. Errors are swallowed: if the
   * socket is already dead there's nothing useful to surface.
   */
  private sendUnsubscribeAll() {
    if (!this.socket) return;
    try {
      // Transport listeners — only present once the snapshot succeeded,
      // but unconditionally unsub is safe (AbletonOSC ignores unknowns).
      const ms = [cmd.unlistenTempo(), cmd.unlistenIsPlaying(), cmd.unlistenMetronome()];
      for (const m of ms) {
        try {
          this.socket.send(encodeMessage(m), this.sendPort, this.host);
        } catch {
          /* socket closing */
        }
      }
      // Per-track playing_slot_index listeners.
      for (const t of this.listening) {
        try {
          const m = cmd.unlistenPlayingSlot(t);
          this.socket.send(encodeMessage(m), this.sendPort, this.host);
        } catch {
          /* socket closing */
        }
      }
      // Per-track playing_position listeners (only the clip currently
      // playing on each track is subscribed).
      for (const [t, clip] of this.positionListening) {
        try {
          const m = cmd.unlistenClipPosition(t, clip);
          this.socket.send(encodeMessage(m), this.sendPort, this.host);
        } catch {
          /* socket closing */
        }
      }
    } catch {
      /* never throw from disconnect cleanup */
    }
  }

  private openSocket() {
    if (this.socket) return;
    // EADDRINUSE happens when another Nexus instance (or Ableton
    // itself, locally) already holds the recv port. Retrying every 2 s
    // forever floods the log and burns CPU; back off exponentially
    // 1 s → 30 s, reset on success.
    if (Date.now() < this.nextBindAttemptTs) return;
    try {
      const sock = createSocket("udp4");
      sock.on("message", (buf) => this.onPacket(buf));
      sock.on("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        const friendly =
          code === "EADDRINUSE"
            ? `Port ${this.recvPort} is busy — another Nexus or AbletonOSC running?`
            : err.message;
        this.bindBackoffMs = Math.min(30_000, this.bindBackoffMs * 2);
        this.nextBindAttemptTs = Date.now() + this.bindBackoffMs;
        this.publishStatus("disconnected", friendly);
        this.closeSocket();
      });
      sock.on("listening", () => {
        // Successful bind — reset backoff so the next failure starts
        // from the short delay again.
        this.bindBackoffMs = 1_000;
        this.nextBindAttemptTs = 0;
      });
      sock.bind(this.recvPort);
      this.socket = sock;
    } catch (err) {
      this.bindBackoffMs = Math.min(30_000, this.bindBackoffMs * 2);
      this.nextBindAttemptTs = Date.now() + this.bindBackoffMs;
      this.publishStatus(
        "disconnected",
        err instanceof Error ? err.message : "socket bind failed"
      );
    }
  }

  private closeSocket() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  // ─── Ping / connection tracking ──────────────────────────────

  private tickPing() {
    if (!this.socket) {
      this.openSocket();
      if (!this.socket) return;
    }
    // Ping with both /live/test and version — gives us connection AND
    // version info in one round trip.
    this.sendRaw("/live/test");
    if (!this.version) {
      const m = cmd.getVersion();
      this.sendRaw(m.address, m.args);
    }

    // Time-out detection: if we haven't heard back in STALE_MS, flip to
    // disconnected. The remote may have crashed mid-listen, so we
    // best-effort unsub before nuking our local state — if Ableton
    // comes back at the same address it won't have ghost listeners.
    if (this.connected && Date.now() - this.lastReplyTs > STALE_MS) {
      this.sendUnsubscribeAll();
      this.connected = false;
      this.snapshot = null;
      this.listening.clear();
      this.positionListening.clear();
      this.publishStatus("disconnected", "No reply from AbletonOSC");
    }
  }

  // ─── Inbound packet routing ──────────────────────────────────

  private onPacket(buf: Buffer) {
    const msgs = decodePacket(new Uint8Array(buf));
    if (msgs.length === 0) return;

    this.lastReplyTs = Date.now();

    // First reply (or first after disconnect) → we're back. Kick off
    // snapshot fetch + subscriptions.
    if (!this.connected) {
      this.connected = true;
      this.publishStatus("connected");
      this.fetchSnapshot().catch(() => {
        /* publishStatus will pick up the failure */
      });
    }

    for (const m of msgs) {
      // Resolve any pending one-shot waiter for this address (FIFO).
      const q = this.pending.get(m.address);
      if (q && q.length > 0) {
        const fn = q.shift()!;
        if (q.length === 0) this.pending.delete(m.address);
        try {
          fn(m.args);
        } catch {
          /* swallow — one bad resolver shouldn't break the broker */
        }
      }

      // Push-style listener: playing slot updates.
      if (m.address === "/live/track/get/playing_slot_index" && m.args.length >= 2) {
        const trackIndex = Number(m.args[0]);
        const slot = Number(m.args[1]);
        if (Number.isFinite(trackIndex) && Number.isFinite(slot)) {
          if (this.snapshot && this.snapshot.tracks[trackIndex]) {
            this.snapshot.tracks[trackIndex].playingSlotIndex = slot;
          }
          this.publish({
            type: "playing-slot",
            trackIndex,
            playingSlotIndex: slot,
          });
          this.syncPositionListener(trackIndex, slot);
        }
      }

      // Transport listeners (tempo, is_playing, metronome).
      if (m.address === "/live/song/get/tempo" && m.args.length > 0) {
        this.updateTransport({ tempo: Number(m.args[0]) });
      }
      if (m.address === "/live/song/get/is_playing" && m.args.length > 0) {
        this.updateTransport({ isPlaying: Boolean(Number(m.args[0])) });
      }
      if (m.address === "/live/song/get/metronome" && m.args.length > 0) {
        this.updateTransport({ metronome: Boolean(Number(m.args[0])) });
      }
      if (
        m.address === "/live/song/get/current_song_time" &&
        m.args.length > 0
      ) {
        this.updateTransport({
          songBeat: Number(m.args[0]),
          lastUpdateTs: Date.now(),
        });
      }

      // Per-clip playing position push. AbletonOSC sends back to
      // /live/clip/get/playing_position with args (track, clip, position).
      if (
        m.address === "/live/clip/get/playing_position" &&
        m.args.length >= 3
      ) {
        const trackIndex = Number(m.args[0]);
        const clipIndex = Number(m.args[1]);
        const position = Number(m.args[2]);
        if (
          Number.isFinite(trackIndex) &&
          Number.isFinite(clipIndex) &&
          Number.isFinite(position)
        ) {
          this.publish({
            type: "clip-position",
            trackIndex,
            clipIndex,
            position,
            ts: Date.now(),
          });
        }
      }

      // Version reply (without a pending waiter, e.g. piggybacked ping).
      if (m.address === "/live/application/get/version" && m.args.length > 0) {
        const v = m.args.map((a) => String(a)).join(".");
        if (v !== this.version) {
          this.version = v;
          this.publishStatus("connected");
        }
      }
    }
  }

  /**
   * Mutate transport state in the cached snapshot and broadcast a delta
   * patch over SSE. Each call only sends the keys that actually changed
   * so clients don't re-render on no-op pushes.
   */
  private updateTransport(patch: Partial<AbletonTransport>) {
    if (!this.snapshot) return;
    const tr = this.snapshot.transport as unknown as Record<string, unknown>;
    const real: Record<string, unknown> = {};
    let changed = false;
    for (const k of Object.keys(patch) as (keyof AbletonTransport)[]) {
      const v = patch[k];
      if (v !== undefined && tr[k] !== v) {
        tr[k] = v;
        real[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    this.publish({
      type: "transport",
      patch: real as Partial<AbletonTransport>,
      ts: Date.now(),
    });
  }

  /**
   * Keep the playing_position subscription pointed at the clip currently
   * playing on a given track. Called whenever playing_slot_index changes.
   * Sends an unlisten for the previous clip (if any) and a listen for
   * the new one (if any). A "-1" slot means nothing's playing — we just
   * unsubscribe and we're done.
   */
  private syncPositionListener(trackIndex: number, newSlot: number) {
    const oldSlot = this.positionListening.get(trackIndex);
    if (oldSlot !== undefined && oldSlot !== newSlot) {
      const m = cmd.unlistenClipPosition(trackIndex, oldSlot);
      this.sendRaw(m.address, m.args);
      this.positionListening.delete(trackIndex);
    }
    if (newSlot >= 0 && this.positionListening.get(trackIndex) !== newSlot) {
      const m = cmd.listenClipPosition(trackIndex, newSlot);
      this.sendRaw(m.address, m.args);
      this.positionListening.set(trackIndex, newSlot);
    }
  }

  // ─── One-shot request/reply helper ───────────────────────────

  private request(
    sent: { address: string; args: OscArg[] },
    replyAddress: string,
    timeoutMs = 2000
  ): Promise<OscArg[]> {
    return new Promise((resolve, reject) => {
      const queue = this.pending.get(replyAddress) ?? [];
      const timer = setTimeout(() => {
        const q = this.pending.get(replyAddress);
        if (q) {
          const i = q.indexOf(resolver);
          if (i >= 0) q.splice(i, 1);
          if (q.length === 0) this.pending.delete(replyAddress);
        }
        reject(new Error(`Timeout waiting for ${replyAddress}`));
      }, timeoutMs);
      const resolver = (args: OscArg[]) => {
        clearTimeout(timer);
        resolve(args);
      };
      queue.push(resolver);
      this.pending.set(replyAddress, queue);
      this.sendRaw(sent.address, sent.args);
    });
  }

  // ─── Snapshot bulk fetch ─────────────────────────────────────

  private async fetchSnapshot() {
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    // Clear known-listener bookkeeping at the top of every (re)fetch.
    // Without this, if Ableton restarted between two snapshot attempts
    // (its listeners are gone) but our `listening` set still has the
    // track ids from a prior session, the subscription loop at the
    // bottom would `continue` past them and we'd never get push
    // updates again. Cheap to send the start_listen blast on every
    // reconnect; the listeners we want.
    this.listening.clear();
    this.positionListening.clear();
    try {
      const numTracksArgs = await this.request(cmd.getNumTracks(), "/live/song/get/num_tracks");
      const numScenesArgs = await this.request(cmd.getNumScenes(), "/live/song/get/num_scenes");
      const numTracks = Number(numTracksArgs[0] ?? 0);
      const numScenes = Number(numScenesArgs[0] ?? 0);

      // Scene names — fired in parallel, then matched by index from
      // the reply payload itself rather than by request order. The
      // shared FIFO `pending` queue at this address pops resolvers in
      // arrival order; if AbletonOSC returns replies out of order
      // (it does under load) the "i-th request's resolver gets the
      // i-th reply's args" assumption is wrong. We trust `args[0]`
      // (Ableton's scene_index) and `scenes.sort()` below puts them
      // in order. The closure index `i` is only used to drive the
      // request loop.
      const scenePromises: Promise<AbletonScene>[] = [];
      for (let i = 0; i < numScenes; i++) {
        scenePromises.push(
          this.request(cmd.getSceneName(i), "/live/scene/get/name").then(
            (args) => ({
              // Reply is (scene_index, name) — trust the reply's index
              // so out-of-order replies still land in the right slot.
              index: Number.isFinite(Number(args[0])) ? Number(args[0]) : i,
              name: String(args[1] ?? ""),
            })
          )
        );
      }

      // Track + clip data in chunks. Each chunk returns a flat track-major
      // list per track:
      //   [track.name, clip.name×S, clip.color×S, clip.length×S]
      const tracks: AbletonTrack[] = [];
      for (let start = 0; start < numTracks; start += TRACK_DATA_CHUNK) {
        const end = Math.min(numTracks, start + TRACK_DATA_CHUNK);
        const args = await this.request(
          cmd.getTrackData(start, end, [
            "track.name",
            "clip.name",
            "clip.color",
            "clip.length",
          ]),
          "/live/song/get/track_data",
          4000
        );
        const perTrack = 1 + numScenes * 3;
        for (let t = start; t < end; t++) {
          const base = (t - start) * perTrack;
          const name = String(args[base] ?? `Track ${t + 1}`);
          const slots: AbletonClipSlot[] = [];
          for (let s = 0; s < numScenes; s++) {
            const rawName = args[base + 1 + s];
            const rawColor = args[base + 1 + numScenes + s];
            const rawLength = args[base + 1 + numScenes * 2 + s];
            if (rawName === null || rawName === undefined) {
              slots.push({ hasClip: false });
            } else {
              slots.push({
                hasClip: true,
                clip: {
                  name: String(rawName),
                  color: Number(rawColor ?? 0),
                  length: Number(rawLength ?? 0),
                },
              });
            }
          }
          tracks.push({
            index: t,
            name,
            playingSlotIndex: -1,
            slots,
          });
        }
      }

      // Transport state — fired in parallel; replies multiplex via the
      // FIFO pending queues. AbletonOSC returns scalars at the same
      // address as the request.
      const [tempoArgs, isPlayingArgs, metronomeArgs, sigNumArgs, sigDenArgs, songTimeArgs] =
        await Promise.all([
          this.request(cmd.getTempo(), "/live/song/get/tempo").catch(() => [120]),
          this.request(cmd.getIsPlaying(), "/live/song/get/is_playing").catch(() => [0]),
          this.request(cmd.getMetronome(), "/live/song/get/metronome").catch(() => [0]),
          this.request(cmd.getSigNum(), "/live/song/get/signature_numerator").catch(() => [4]),
          this.request(cmd.getSigDen(), "/live/song/get/signature_denominator").catch(() => [4]),
          this.request(cmd.getCurrentSongTime(), "/live/song/get/current_song_time").catch(() => [0]),
        ]);
      const transport: AbletonTransport = {
        tempo: Number(tempoArgs[0] ?? 120),
        isPlaying: Boolean(Number(isPlayingArgs[0] ?? 0)),
        metronome: Boolean(Number(metronomeArgs[0] ?? 0)),
        sigNum: Number(sigNumArgs[0] ?? 4),
        sigDen: Number(sigDenArgs[0] ?? 4),
        songBeat: Number(songTimeArgs[0] ?? 0),
        lastUpdateTs: Date.now(),
      };

      const scenes = await Promise.all(scenePromises).catch(() => {
        // Scene-name failures shouldn't sink the whole snapshot — fall
        // back to numbered placeholders.
        return Array.from({ length: numScenes }, (_, i) => ({
          index: i,
          name: `Scene ${i + 1}`,
        }));
      });

      // Sort by index in case Promise.all returned out of order (it
      // shouldn't, but defensive).
      scenes.sort((a, b) => a.index - b.index);

      this.snapshot = {
        numTracks,
        numScenes,
        tracks,
        scenes,
        transport,
        version: this.version,
      };
      this.publish({ type: "snapshot", snapshot: this.snapshot });

      // Subscribe to playing_slot_index per track. Track-level listeners
      // are cheap and let us animate the playing clip without polling.
      for (let t = 0; t < numTracks; t++) {
        if (!this.listening.has(t)) {
          const m = cmd.listenPlayingSlot(t);
          this.sendRaw(m.address, m.args);
          this.listening.add(t);
        }
      }

      // Transport listeners — sparse (tempo / play state / metronome
      // changes are user-driven, no flood risk).
      const tempoSub = cmd.listenTempo();
      const playSub = cmd.listenIsPlaying();
      const metSub = cmd.listenMetronome();
      this.sendRaw(tempoSub.address, tempoSub.args);
      this.sendRaw(playSub.address, playSub.args);
      this.sendRaw(metSub.address, metSub.args);
    } catch (err) {
      // If the snapshot fails (e.g. Ableton paused mid-fetch), flip back
      // to disconnected so the next /live/test reply re-triggers the
      // fetch. Without this we'd be stuck "connected" with no data.
      this.connected = false;
      this.publishStatus(
        "disconnected",
        err instanceof Error ? `Snapshot failed: ${err.message}` : "Snapshot failed"
      );
    } finally {
      this.snapshotInFlight = false;
    }
  }

  // ─── Publishing ──────────────────────────────────────────────

  private publishStatus(
    status: "connected" | "disconnected" | "connecting",
    error?: string
  ) {
    const event: AbletonEvent = {
      type: "status",
      status,
      host: this.host,
      port: this.sendPort,
      version: this.version,
      error,
    };
    this.lastStatusEvent = event;
    this.publish(event);
  }

  private publish(e: AbletonEvent) {
    for (const sub of this.subscribers) {
      try {
        sub(e);
      } catch {
        /* a misbehaving subscriber should not break the broker */
      }
    }
  }
}

