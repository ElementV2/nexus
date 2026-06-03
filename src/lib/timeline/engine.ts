import { EventEmitter } from "node:events";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { createLogger } from "@/lib/core/logger";
import { runSteps } from "@/lib/core/catalog";
import { getScenario, type Scenario, type TimelineClip } from "@/lib/db/timeline";

const log = createLogger("timeline");

/** How often the playhead advances. 50 ms ≈ 20 fps — smooth enough for a
 *  visible playhead and fine-grained enough that cue timing is within a
 *  frame of the authored offset. Single interval, started ONLY while
 *  playing (no idle CPU), mirroring Companion's one-clock design but at a
 *  finer resolution than its 1 s trigger tick. */
const TICK_MS = 50;

export type TransportState = "idle" | "playing" | "waiting" | "paused";

export interface TimelineEngineState {
  scenarioId: string | null;
  state: TransportState;
  playheadMs: number;
  durationMs: number;
  skipWaits: boolean;
  /** When `state === 'waiting'`, the offset the playhead is parked at. */
  waitingAtMs: number | null;
}

/**
 * Server-side playback engine for "Live Show" timelines.
 *
 * One scenario plays at a time. A single interval advances the playhead
 * and fires each clip's action (via `runSteps`, the same path a deck press
 * uses) when the head crosses its `offsetMs`. WAIT markers clamp the head
 * and park in `waiting` until `go()` (or `skipWaits`) releases them.
 *
 * Design notes (poll-and-compare, from the Companion trigger analysis):
 *   • The head is the source of truth; clips/waits are matched by offset
 *     each tick, so there are no per-clip timers to drift or leak.
 *   • `firedClipIds` / `consumedWaitIds` carry the invariant "everything at
 *     offset ≤ playhead has already happened", which makes pause/seek/go
 *     trivial: `seek(ms)` just rebuilds those sets from `ms`.
 *   • Browser sends play/pause/seek/go; it never runs the clock. So a show
 *     keeps playing with the tab closed, and every viewer sees one head.
 */
class TimelineEngineImpl extends EventEmitter {
  /** Snapshot of the scenario taken at `play()` — edits to the store while
   *  a show runs don't mutate the running copy mid-flight. */
  #scenario: Scenario | null = null;
  #state: TransportState = "idle";
  #playheadMs = 0;
  #skipWaits = false;
  #waitingAtMs: number | null = null;

  /** Clips whose action has already fired at the current head position.
   *  Cleared/rebuilt on stop and seek so a backward seek re-arms them. */
  #firedClipIds = new Set<string>();
  /** Waits already released (passed or GO-ed). */
  #consumedWaitIds = new Set<string>();

  #timer: ReturnType<typeof setInterval> | null = null;
  /** Wall time of the last tick, to advance the head by real elapsed ms
   *  (a busy event loop may delay the interval beyond TICK_MS). */
  #lastTickAt = 0;

  constructor() {
    super();
    // Each SSE client adds a 'state' listener; an operator may have the
    // timeline open in several tabs/satellites. Don't cap them.
    this.setMaxListeners(0);
  }

  // ───────────────────────── transport ─────────────────────────

  /** Load a scenario and start playing from t=0. */
  play(scenarioId: string, opts?: { skipWaits?: boolean }): TimelineEngineState {
    const scenario = getScenario(scenarioId);
    if (!scenario) {
      log.warn(`play: no scenario "${scenarioId}"`);
      this.#emit();
      return this.getState();
    }
    this.#scenario = scenario;
    this.#playheadMs = 0;
    this.#firedClipIds.clear();
    this.#consumedWaitIds.clear();
    this.#waitingAtMs = null;
    if (opts?.skipWaits !== undefined) this.#skipWaits = !!opts.skipWaits;
    this.#state = "playing";
    log.info(
      `play "${scenario.label}" (${scenario.durationMs}ms${this.#skipWaits ? ", skip waits" : ""})`
    );
    this.#startTimer();
    this.#emit();
    return this.getState();
  }

  /** Freeze the head where it is. */
  pause(): TimelineEngineState {
    if (this.#state === "playing" || this.#state === "waiting") {
      this.#stopTimer();
      this.#state = "paused";
      this.#emit();
    }
    return this.getState();
  }

  /** Resume a paused (or cued) show from the current playhead. Reloads the
   *  scenario first so edits made while paused/cued — new WAIT markers, clips,
   *  retimes — take effect (the head/arming is re-derived from the position). */
  resume(): TimelineEngineState {
    if (this.#state === "paused" && this.#scenario) {
      const fresh = getScenario(this.#scenario.id);
      if (fresh) {
        this.#scenario = fresh;
        this.#playheadMs = Math.min(this.#playheadMs, fresh.durationMs);
        this.#rebuildArmingFrom(this.#playheadMs);
      }
      this.#state = "playing";
      this.#startTimer();
      this.#emit();
    }
    return this.getState();
  }

  /** Stop and rewind to the start. */
  stop(): TimelineEngineState {
    this.#stopTimer();
    this.#state = "idle";
    this.#playheadMs = 0;
    this.#waitingAtMs = null;
    this.#firedClipIds.clear();
    this.#consumedWaitIds.clear();
    this.#emit();
    return this.getState();
  }

  /**
   * Jump the head to `ms`. Rebuilds the fired/consumed sets from the new
   * position: everything at offset ≤ ms counts as already-happened (so
   * seeking forward SKIPS those clips rather than firing them, and seeking
   * back RE-ARMS them). Keeps the current play/pause state.
   */
  seek(ms: number, scenarioId?: string): TimelineEngineState {
    // Cue a not-yet-loaded scenario so the operator can position the head
    // BEFORE pressing Play (scrubbing while idle). Loads it paused.
    if (scenarioId && (!this.#scenario || this.#scenario.id !== scenarioId)) {
      const sc = getScenario(scenarioId);
      if (!sc) return this.getState();
      this.#scenario = sc;
      this.#stopTimer();
      this.#state = "paused";
      this.#waitingAtMs = null;
    }
    if (!this.#scenario) return this.getState();
    const clamped = Math.max(0, Math.min(this.#scenario.durationMs, Number(ms) || 0));
    this.#playheadMs = clamped;
    this.#rebuildArmingFrom(clamped);
    // Idle/finished or parked at a wait → seeking moves to a paused (cued)
    // state. A playing head keeps playing from the new position.
    if (this.#state === "waiting" || this.#state === "idle") {
      this.#state = "paused";
      this.#stopTimer();
    }
    this.#waitingAtMs = null;
    this.#lastTickAt = Date.now();
    this.#emit();
    return this.getState();
  }

  /** Release the current WAIT and continue. */
  go(): TimelineEngineState {
    if (this.#state !== "waiting" || !this.#scenario) return this.getState();
    // Consume every unconsumed wait at the parked offset, then run on.
    for (const w of this.#scenario.waits) {
      if (w.offsetMs === this.#playheadMs) this.#consumedWaitIds.add(w.id);
    }
    this.#waitingAtMs = null;
    this.#state = "playing";
    this.#startTimer();
    this.#emit();
    return this.getState();
  }

  /** Toggle "skip waits". Turning it on while parked at a WAIT releases it. */
  setSkipWaits(skip: boolean): TimelineEngineState {
    this.#skipWaits = !!skip;
    if (this.#skipWaits && this.#state === "waiting") {
      return this.go();
    }
    this.#emit();
    return this.getState();
  }

  getState(): TimelineEngineState {
    return {
      scenarioId: this.#scenario?.id ?? null,
      state: this.#state,
      playheadMs: this.#playheadMs,
      durationMs: this.#scenario?.durationMs ?? 0,
      skipWaits: this.#skipWaits,
      waitingAtMs: this.#waitingAtMs,
    };
  }

  /** Subscribe to state/playhead changes (used by the transport SSE).
   *  Returns an unsubscribe fn. */
  subscribe(cb: (state: TimelineEngineState) => void): () => void {
    this.on("state", cb);
    return () => this.off("state", cb);
  }

  // ───────────────────────── internals ─────────────────────────

  #startTimer(): void {
    this.#stopTimer();
    this.#lastTickAt = Date.now();
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
  }

  #stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Mark every clip/wait at offset ≤ `ms` as already-happened, and
   *  re-arm those after it. Keeps the "≤ head = done" invariant. */
  #rebuildArmingFrom(ms: number): void {
    if (!this.#scenario) return;
    this.#firedClipIds.clear();
    this.#consumedWaitIds.clear();
    for (const t of this.#scenario.tracks) {
      for (const c of t.clips) {
        if (c.offsetMs <= ms) this.#firedClipIds.add(c.id);
      }
    }
    for (const w of this.#scenario.waits) {
      if (w.offsetMs <= ms) this.#consumedWaitIds.add(w.id);
    }
  }

  #tick(): void {
    if (this.#state !== "playing" || !this.#scenario) return;

    const now = Date.now();
    const delta = Math.max(0, now - this.#lastTickAt);
    this.#lastTickAt = now;

    const prevMs = this.#playheadMs;
    const newMs = prevMs + delta;

    // First unconsumed WAIT strictly ahead of the head and within reach.
    let blockingWait: { id: string; offsetMs: number } | null = null;
    if (!this.#skipWaits) {
      for (const w of this.#scenario.waits) {
        if (
          !this.#consumedWaitIds.has(w.id) &&
          w.offsetMs > prevMs &&
          w.offsetMs <= newMs &&
          (blockingWait === null || w.offsetMs < blockingWait.offsetMs)
        ) {
          blockingWait = w;
        }
      }
    }

    const reachedMs = blockingWait ? blockingWait.offsetMs : newMs;

    // Fire every armed clip the head crossed (≤ reachedMs). Fire-and-forget
    // like Companion's setImmediate — the per-step 1.5 s timeout in runSteps
    // keeps one dead device from stalling the show.
    for (const track of this.#scenario.tracks) {
      for (const clip of track.clips) {
        if (clip.offsetMs <= reachedMs && !this.#firedClipIds.has(clip.id)) {
          this.#firedClipIds.add(clip.id);
          this.#fireClip(clip);
        }
      }
    }

    if (blockingWait) {
      // Park at the wait until GO. (Not consumed yet — go() consumes it.)
      this.#playheadMs = blockingWait.offsetMs;
      this.#waitingAtMs = blockingWait.offsetMs;
      this.#state = "waiting";
      this.#stopTimer();
      log.info(`wait at ${blockingWait.offsetMs}ms — press GO`);
      this.#emit();
      return;
    }

    this.#playheadMs = newMs;

    if (newMs >= this.#scenario.durationMs) {
      // Reached the end — park at the end, idle, ready for the next play().
      this.#playheadMs = this.#scenario.durationMs;
      this.#state = "idle";
      this.#stopTimer();
      log.info(`finished "${this.#scenario.label}"`);
    }

    this.#emit();
  }

  #fireClip(clip: TimelineClip): void {
    const first = clip.steps[0];
    const label = clip.label ?? first?.actionId ?? "clip";
    const kind =
      first?.kind ??
      (first?.actionId.includes(":")
        ? first.actionId.slice(0, first.actionId.indexOf(":"))
        : "");
    // Fire the clip's whole action list, exactly like a deck press
    // (press-dispatcher → runSteps, allowDefault=FALSE). A step resolves its
    // own pin, then the clip-level pin; an action with NO valid target does
    // nothing — same "None = inert" rule as the deck, so the inspector's
    // "None" never silently fires at some default instance. Drops/pastes pin
    // a concrete connection, so the normal case always has a target.
    void runSteps(clip.steps, kind, clip.connectionId, false)
      .then(({ results }) => {
        const bad = results.find((r) => !r.ok);
        if (bad) log.warn(`clip "${label}" failed: ${bad.error}`);
      })
      .catch((e) => log.warn(`clip "${label}" threw: ${e}`));
  }

  #emit(): void {
    this.emit("state", this.getState());
  }

  dispose(): void {
    this.#stopTimer();
    this.removeAllListeners();
  }
}

export const timelineEngine = hmrSingleton("timeline-engine-v1", TimelineEngineImpl);
export type TimelineEngine = TimelineEngineImpl;
