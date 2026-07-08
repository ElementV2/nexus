import { EventEmitter } from "node:events";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { createLogger } from "@/lib/core/logger";
import { connectionManager } from "@/lib/core/connection-manager";
import { peekPreferences } from "@/lib/db/preferences";
import { getAutoSwitchConfig, setAutoSwitchConfig } from "@/lib/db/auto-switch";
import { meterToDb } from "@/lib/utils/audio";
import type { VmixInput, VmixState } from "@/lib/vmix/types";
import {
  equivalentAngles,
  rankShots,
  reactionPool,
  SILENCE_DB,
  type Shot,
} from "./director";
import {
  defaultConfig,
  refId,
  type AutoCamera,
  type AutoInputRef,
  type AutoSourceStatus,
  type AutoSwitchConfig,
  type AutoSwitchState,
} from "./types";

const log = createLogger("auto-switch");

/** Decision cadence. 100 ms is well under the meter refresh (~150 ms) and the
 *  shortest dwell, so the head never lags an audio change by more than a tick
 *  while staying cheap (10 evaluations/sec, no per-source timers). */
const TICK_MS = 100;
/** Envelope follower coefficients (per tick). Fast attack catches a talker
 *  starting; slow release rides over the dips between words so the gate's
 *  hang time does the real work. */
const ATTACK = 0.6;
const RELEASE = 0.25;
/** If a commanded switch isn't reflected by vMix within this window, allow a
 *  resend (covers a dropped FUNCTION) — otherwise we'd never retry. */
const COMMAND_REARM_MS = 1500;
/** SSE pacing: the engine DECIDES every 100 ms but only PUSHES to the UI on a
 *  discrete change (reason / program / who's talking) or this heartbeat. Keeps
 *  the client off a 10 fps re-render treadmill — the dots/labels only change a
 *  couple of times a second in practice. */
const MIN_EMIT_MS = 500;
/** A person counts as "in the conversation" for this long after they last
 *  spoke. A scene is only shown when a MAJORITY of the people it frames are
 *  within this window (see the validity rule) — so a group never appears just
 *  because it contains the one active mic; enough of the others must have
 *  spoken recently too. */
const RECENT_ACTIVE_MS = 20_000;
/** A lone speaker talking CONTINUOUSLY for this long is a "monologue" — the
 *  only situation where we add an occasional REACTION cut for life. */
const SUSTAINED_TALK_MS = 10_000;
/** Spacing between monologue reaction cuts (randomized in this range). It's a
 *  long cooldown ON PURPOSE — a reaction is an accent, not a rotation, so the
 *  shot never bounces scene↔solo in a loop. */
const VARIETY_COOLDOWN_MIN_MS = 18_000;
const VARIETY_COOLDOWN_MAX_MS = 32_000;

/** True when an input's audio is actually audible on program: it carries
 *  audio, isn't muted, and is routed to the Master bus. Anything else (muted,
 *  monitor-only on bus A/B, no audio) is treated as silent — the auto-mix must
 *  never follow a mic that the audience can't hear. */
function isOnAir(inp: VmixInput | undefined): inp is VmixInput {
  if (!inp || !inp.hasAudio || inp.muted) return false;
  const busses = inp.audioBusses
    ? inp.audioBusses.split(",").map((b) => b.trim())
    : [];
  // Empty/unknown routing → assume Master (vMix's default) rather than
  // wrongly excluding a normally-routed input.
  return busses.length === 0 || busses.includes("M");
}

interface SourceTrack {
  /** Smoothed level, dB. */
  env: number;
  aboveSince: number | null;
  belowSince: number | null;
  speaking: boolean;
  /** When the current uninterrupted talking streak began (null when silent).
   *  Survives the short gaps between words via the release hang. */
  speakingSince: number | null;
}

/**
 * Server-side auto-réalisation engine. A single interval (only while enabled)
 * reads the DEFAULT vMix's per-input audio meters, turns each mapped source
 * into a clean "is talking" signal (envelope + hysteresis gate + activation
 * hold = cough/transient reject + release hang = ride word gaps), then plays
 * director: PURE FOLLOW of the conversation — one talker → their solo, two →
 * the camera that frames both (a "wide"/group is just a camera with several
 * mics), with a dwell so a freshly-cut shot can't flicker, and an occasional
 * reaction cut during a long monologue.
 *
 * Mirrors the timeline engine's lifecycle (HMR singleton, one clock, runs with
 * the browser closed, state pushed over SSE). It does NOT inherit the
 * timeline's per-clip connection routing: by design this drives ONLY the
 * default vMix, exactly like the Live page it lives on.
 */
class AutoSwitchEngineImpl extends EventEmitter {
  #config: AutoSwitchConfig | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;

  // Per audio-source tracking (keyed by the mic's stable ref id — the vMix
  // input GUID, or the number-derived legacy fallback; see `refId`).
  #sources = new Map<string, SourceTrack>();
  /** Wall time each mic was last talking, for the "recently active" window. */
  #lastSpokeAt = new Map<string, number>();
  #lastSources: AutoSourceStatus[] = [];

  // Program tracking. `lastSeenProgram` is what vMix reports; `expectedProgram`
  // is what WE last commanded — a divergence means a human (or external) switch.
  #lastSeenProgram: number | null = null;
  #expectedProgram: number | null = null;
  #programSince = 0;
  #commandedAt = 0;

  #overrideUntil = 0;
  /** Earliest time a monologue reaction cut may fire again (cooldown), so a
   *  long monologue gets an occasional accent without ever looping. */
  #nextVarietyAt = 0;
  /** While > now, a monologue reaction shot is being held before returning to
   *  the speaker. */
  #reactionUntil = 0;

  #connected = false;
  #reason = "—";

  // SSE pacing.
  #lastEmitAt = 0;
  #lastSig = "";

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /** Load persisted config and start ticking if enabled. Idempotent — safe to
   *  call from boot and from the API routes. */
  init(): void {
    if (this.#config === null) this.#config = getAutoSwitchConfig();
    this.#apply();
  }

  getConfig(): AutoSwitchConfig {
    if (this.#config === null) this.#config = getAutoSwitchConfig();
    return this.#config;
  }

  /** Persist + apply a full config (sanitized internally). Returns the clean
   *  result. */
  setConfig(config: unknown): AutoSwitchConfig {
    this.#config = setAutoSwitchConfig(config);
    this.#apply();
    this.#forceEmit();
    return this.#config;
  }

  setEnabled(enabled: boolean): AutoSwitchConfig {
    return this.setConfig({ ...this.getConfig(), enabled });
  }

  /** Start/stop the clock to match `enabled`. While already running, a config
   *  change needs NO reset here — the tick reads `#config` live, so editing
   *  cameras/tuning mid-show doesn't glitch the head or reset the dwell. We
   *  only seed baselines on the stopped→running edge. */
  #apply(): void {
    const cfg = this.getConfig();
    if (cfg.enabled && !this.#timer) {
      this.#nextVarietyAt = 0;
      this.#reactionUntil = 0;
      // Treat whatever is currently on program as the accepted baseline so
      // flipping the switch on never reads as a "manual override".
      this.#expectedProgram = null;
      this.#lastSeenProgram = null;
      this.#overrideUntil = 0;
      this.#timer = setInterval(() => this.#tick(), TICK_MS);
      log.info("auto-réa enabled");
    } else if (!cfg.enabled && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
      this.#sources.clear();
      this.#lastSpokeAt.clear();
      this.#lastSources = [];
      this.#reason = "—";
      this.#connected = false;
      log.info("auto-réa disabled");
    }
  }

  subscribe(cb: (state: AutoSwitchState) => void): () => void {
    this.on("state", cb);
    return () => this.off("state", cb);
  }

  // ───────────────────────── state ─────────────────────────

  getState(): AutoSwitchState {
    const cfg = this.getConfig();
    const now = Date.now();
    return {
      enabled: cfg.enabled,
      running: cfg.enabled && this.#connected,
      connected: this.#connected,
      reason: this.#reason,
      programInput: this.#lastSeenProgram,
      msOnCurrent: this.#connected ? Math.max(0, now - this.#programSince) : 0,
      nextVarietyInMs:
        cfg.enabled && this.#connected
          ? Math.max(0, this.#nextVarietyAt - now)
          : null,
      overrideForMs: this.#overrideUntil > now ? this.#overrideUntil - now : null,
      sources: this.#lastSources,
    };
  }

  // ───────────────────────── internals ─────────────────────────

  /** Resolve the default vMix broker the same way the Live page does:
   *  the operator-chosen default if it's live, else the first vMix. */
  #defaultVmix(): { getSnapshot(): unknown; send(c: unknown): Promise<unknown> } | null {
    const conns = connectionManager.listByKind("vmix");
    if (conns.length === 0) return null;
    const defId = peekPreferences().defaultConnections?.vmix;
    const chosen = (defId && conns.find((c) => c.id === defId)) || conns[0];
    return chosen ? chosen.broker : null;
  }

  /** Randomized cooldown between two monologue reaction cuts. */
  #varietyCooldown(): number {
    return (
      VARIETY_COOLDOWN_MIN_MS +
      Math.random() * (VARIETY_COOLDOWN_MAX_MS - VARIETY_COOLDOWN_MIN_MS)
    );
  }

  #tick(): void {
    const cfg = this.#config;
    if (!cfg || !cfg.enabled) return;
    const now = Date.now();

    const broker = this.#defaultVmix();
    const snap = (broker?.getSnapshot() ?? null) as VmixState | null;
    this.#connected = !!snap;
    if (!snap) {
      this.#reason = "vMix déconnecté";
      this.#maybeEmit(now);
      return;
    }

    // ── program tracking + manual-override detection ──
    const program = snap.activeInput || null;
    if (program !== this.#lastSeenProgram) {
      // A change to something WE didn't command = an operator (or external) cut
      // — a deck key, a tablet, a hand on the T-bar, another operator…
      const external =
        this.#lastSeenProgram !== null && program !== this.#expectedProgram;
      this.#lastSeenProgram = program;
      this.#programSince = now;
      this.#expectedProgram = program;
      if (external) {
        // A manual cut cancels any pending monologue reaction hold.
        this.#reactionUntil = 0;
        if (cfg.manualHold) {
          // Full pause: turn the auto-mix OFF until the operator relaunches it
          // (clicks AUTO). No timer.
          log.info("manual switch → auto-réa held (relaunch to resume)");
          this.setEnabled(false);
          return;
        }
        if (cfg.manualOverrideMs > 0) {
          // Stand down for a bit so we never fight the human, then resume.
          this.#overrideUntil = now + cfg.manualOverrideMs;
        }
      }
    }
    const msOnCam = now - this.#programSince;

    // ── resolve config refs against the live inputs ──
    // The GUID (`key`) is canonical: a ref whose key exists follows its input
    // wherever vMix renumbers it (inputs added/removed mid-show shift every
    // number). A key that's GONE means the input was deleted — never fall back
    // to the stale number, it may now point at an unrelated input. The number
    // path only serves legacy refs saved before GUIDs, until `#backfillKeys`
    // adopts their GUID below.
    const byNumber = new Map(snap.inputs.map((i) => [i.number, i]));
    const byKey = new Map(snap.inputs.map((i) => [i.key, i]));
    const resolve = (ref: AutoInputRef): VmixInput | undefined =>
      ref.key ? byKey.get(ref.key) : byNumber.get(ref.input);

    // One-time migration: adopt GUIDs for number-only legacy refs.
    const cameras = (this.#backfillKeys(byNumber) ?? cfg).cameras;
    const cams = cameras.filter((c) => c.enabled);
    const d = cfg.detection;

    // ── per-MIC detection ──
    // Detection is keyed by MIC ref id, not camera: a mic that feeds several
    // cameras (e.g. an individual cam AND a group shot) must be counted ONCE,
    // otherwise every overlap inflates the "speaker count" and pins the mix on
    // the wide shot. `micTalking` is the set of distinct mics live on air
    // right now; `micLevel` is each mic's smoothed dB.
    const micRefs = new Map<string, AutoInputRef>();
    for (const cam of cams) for (const m of cam.mics) micRefs.set(refId(m), m);

    const micTalking = new Set<string>();
    const micLevel = new Map<string, number>();
    for (const [mic, ref] of micRefs) {
      const inp = resolve(ref);
      // Only count audio actually ON AIR — vMix's meter keeps moving when muted
      // / off the Master bus. `isOnAir` = has audio, not muted, routed to M.
      const raw = isOnAir(inp) ? Math.max(inp.meterF1, inp.meterF2) : 0;
      const db = raw > 0 ? meterToDb(raw) : SILENCE_DB;
      let s = this.#sources.get(mic);
      if (!s) {
        s = { env: db, aboveSince: null, belowSince: null, speaking: false, speakingSince: null };
        this.#sources.set(mic, s);
      }
      s.env += (db > s.env ? ATTACK : RELEASE) * (db - s.env);
      if (s.env >= d.openDb) {
        s.belowSince = null;
        if (s.aboveSince === null) s.aboveSince = now;
        if (!s.speaking && now - s.aboveSince >= d.activationHoldMs) {
          s.speaking = true;
          s.speakingSince = now;
        }
      } else if (s.env <= d.closeDb) {
        s.aboveSince = null;
        if (s.belowSince === null) s.belowSince = now;
        if (s.speaking && now - s.belowSince >= d.releaseHangMs) {
          s.speaking = false;
          s.speakingSince = null;
        }
      }
      micLevel.set(mic, s.env);
      if (s.speaking) {
        micTalking.add(mic);
        this.#lastSpokeAt.set(mic, now);
      }
    }
    // Drop tracking for mics no longer referenced by any camera.
    for (const k of [...this.#sources.keys()]) if (!micRefs.has(k)) this.#sources.delete(k);
    for (const k of [...this.#lastSpokeAt.keys()]) if (!micRefs.has(k)) this.#lastSpokeAt.delete(k);

    // ── resolved shots: the cameras we can actually cut to right now ──
    // A camera whose input no longer exists is NOT a candidate; mics that no
    // longer resolve are dropped from the shot so width/majority stay honest
    // (a deleted mic input = that person is gone from the frame's count).
    const shots: Shot[] = [];
    const shotInfo = new Map<string, { cam: AutoCamera; inp: VmixInput }>();
    for (const cam of cams) {
      const inp = resolve(cam);
      if (!inp) continue;
      const id = refId(cam);
      shotInfo.set(id, { cam, inp });
      shots.push({ id, mics: cam.mics.filter((m) => resolve(m)).map(refId) });
    }

    // Per-camera readout for the UI (a cam "talks" if any of its mics talk).
    // Lists ALL enabled cams — including unresolved ones — so the modal can
    // flag a camera whose input disappeared instead of silently hiding it.
    this.#lastSources = cams.map((cam) => {
      const inp = shotInfo.get(refId(cam))?.inp;
      const env = cam.mics.reduce(
        (m, ref) => Math.max(m, micLevel.get(refId(ref)) ?? SILENCE_DB),
        SILENCE_DB
      );
      return {
        camId: refId(cam),
        camInput: inp?.number ?? cam.input,
        label: inp?.title ?? cam.label ?? `Input ${cam.input}`,
        db: env,
        level: Math.max(0, Math.min(1, (env + 60) / 60)),
        speaking: cam.mics.some((ref) => micTalking.has(refId(ref))),
      };
    });

    // Nothing to direct — say WHY instead of a misleading "silence".
    if (cams.length === 0) {
      this.#reason = "aucune caméra";
      this.#maybeEmit(now);
      return;
    }
    if (shots.length === 0) {
      this.#reason = "caméras introuvables dans vMix";
      this.#maybeEmit(now);
      return;
    }

    // ── manual-override pause: track audio but don't drive ──
    if (now < this.#overrideUntil) {
      this.#reason = "manuel";
      this.#maybeEmit(now);
      return;
    }

    // ── monologue reaction hold: keep the reaction shot up for its full
    // duration before returning to the speaker (don't switch away yet). ──
    if (now < this.#reactionUntil) {
      this.#reason = "réaction";
      this.#maybeEmit(now);
      return;
    }

    // ── director decision ──
    // The program is reported as a NUMBER (consistent within one snapshot);
    // map it back to the configured shot it corresponds to, if any.
    const programShotId =
      program !== null
        ? ([...shotInfo].find(([, v]) => v.inp.number === program)?.[0] ?? null)
        : null;
    /** Display name of a resolved shot — the operator sees INPUT NAMES, never
     *  bare numbers (numbers shift when vMix renumbers). */
    const shotName = (id: string): string => {
      const v = shotInfo.get(id);
      return v ? v.inp.shortTitle || v.inp.title : "?";
    };

    let targetId = programShotId;
    let reason = "—";
    // Set when the lone active talker is mid-monologue — surfaced in the
    // status line so the operator sees the extended hold kick in.
    let monologue = false;
    // Set when THIS tick commits a monologue reaction cut.
    let reactionCut = false;
    // Set when THIS tick commits a rotation to an equivalent angle.
    let angleCut = false;

    // A switch we already issued is "settling" until vMix reflects it. While
    // in flight, do NOT command anything — not even a different target:
    // re-targeting mid-fade double-commands vMix, and when the FIRST switch
    // then lands it no longer matches `expectedProgram`, so it would read as
    // an "external" cut and wrongly trigger the manual-override stand-down
    // (or a full stop in manual-hold mode). After the rearm window the gate
    // opens again, which doubles as the retry for a dropped command.
    const rearmMs = Math.max(COMMAND_REARM_MS, cfg.transition.durationMs + 800);
    const inFlight =
      this.#expectedProgram !== null &&
      program !== this.#expectedProgram &&
      now - this.#commandedAt < rearmMs;
    const settled = program === this.#expectedProgram;

    if (micTalking.size === 0) {
      // Silence — there is no dedicated wide shot; just hold the last frame.
      reason = "silence";
    } else {
      // Rank the shots framing a live talker (see director.ts): majority-
      // recent shots first (preference, NOT a hard filter — a setup where every
      // camera carries several mics must still cut), then coverage, loudness,
      // specificity (tightest first).
      const isRecent = (mic: string) =>
        now - (this.#lastSpokeAt.get(mic) ?? -Infinity) <= RECENT_ACTIVE_MS;
      const ranked = rankShots(shots, micTalking, micLevel, isRecent);

      const best = ranked[0];
      const curEntry =
        programShotId !== null
          ? ranked.find((r) => r.shot.id === programShotId)
          : undefined;

      if (!best) {
        // No camera frames any talker — keep the current shot.
        reason = "—";
      } else {
        // PURE FOLLOW: go to the best (tightest) shot of whoever is talking RIGHT
        // NOW. One person → their solo, as fast as the dwell allows. Two people
        // → the 2-shot/group. The dwell (minOnCam, enforced below) gives a
        // freshly-cut shot a minimum on-air time, so a 2-shot that just "arrived"
        // isn't a flicker — but the moment it's a lone speaker again we drop to
        // their solo. No artificial rotation, so no scene↔solo loops.
        targetId = best.shot.id;

        // Interchangeable ANGLES: when the current shot frames EXACTLY the
        // same mics as the best (e.g. a scene and its telestrator view — a
        // perfect ranking tie, where the stable sort would otherwise always
        // favour whichever comes first in the config), STAY. Never burn a cut
        // for an equivalent frame; airtime for the other angle comes from the
        // rotation below.
        if (
          programShotId !== null &&
          curEntry &&
          targetId !== programShotId &&
          equivalentAngles(shots, targetId).includes(programShotId)
        ) {
          targetId = programShotId;
        }

        // The ONE exception (always on): a genuine monologue. Exactly one mic
        // has been talking nonstop ≥SUSTAINED_TALK_MS while we hold its best
        // shot → drop in a brief REACTION cut now and then: a WIDER scene that
        // frames the speaker WITH others, even if those others aren't talking
        // (it's a listening/reaction shot, so recency is NOT required here).
        // Keyed on the lone TALKING mic — not on the current shot being a solo
        // — so setups where every camera carries several mics still breathe.
        // Cooldown-gated, so it's an accent, never a loop.
        if (
          programShotId !== null &&
          curEntry &&
          targetId === programShotId &&
          micTalking.size === 1
        ) {
          const loneMic = micTalking.values().next().value as string;
          const streakSince = this.#sources.get(loneMic)?.speakingSince ?? null;
          monologue = streakSince !== null && now - streakSince >= SUSTAINED_TALK_MS;
          // Only commit a reaction once settled + dwell satisfied — otherwise
          // the switch below is blocked and we'd burn the cooldown without
          // cutting.
          if (
            monologue &&
            settled &&
            msOnCam >= cfg.timing.minOnCamMs &&
            now >= this.#nextVarietyAt
          ) {
            const pool = reactionPool(
              shots,
              programShotId,
              loneMic,
              curEntry.shot.mics.length
            );
            if (pool.length > 0) {
              targetId = pool[Math.floor(Math.random() * pool.length)];
              this.#nextVarietyAt = now + this.#varietyCooldown();
              this.#reactionUntil = now + cfg.timing.reactionHoldMs;
              reactionCut = true;
            }
          }
        }

        // ANGLE rotation: while holding a shot that has equivalent angles
        // (exact same mic set — e.g. List vs Telestrator views of the same
        // people), occasionally swap to one of them on the shared variety
        // cooldown so every angle gets airtime instead of the config-first one
        // hogging it. A PERMANENT cut (no return hold) — the frames are
        // interchangeable, so the new angle simply becomes the held shot.
        // Reactions take priority on the cooldown when both are eligible.
        if (
          !reactionCut &&
          programShotId !== null &&
          targetId === programShotId &&
          settled &&
          msOnCam >= cfg.timing.minOnCamMs &&
          now >= this.#nextVarietyAt
        ) {
          const angles = equivalentAngles(shots, programShotId);
          if (angles.length > 0) {
            targetId = angles[Math.floor(Math.random() * angles.length)];
            this.#nextVarietyAt = now + this.#varietyCooldown();
            angleCut = true;
          }
        }

        if (reactionCut) {
          reason = `réaction · ${shotName(targetId!)}`;
        } else if (angleCut) {
          reason = `angle · ${shotName(targetId!)}`;
        } else {
          const t = ranked.find((r) => r.shot.id === targetId);
          reason =
            t && t.cov >= 2
              ? `groupe ×${t.cov} · ${shotName(targetId!)}`
              : shotName(targetId!);
          if (monologue && targetId === programShotId) reason += " · monologue";
        }
      }
    }

    // ── enforce dwell + switch ──
    // `inFlight` (computed above) blocks EVERY command while our last switch
    // is still settling — same-target resends AND mid-fade re-targets alike.
    const targetInfo = targetId !== null ? shotInfo.get(targetId) : undefined;
    if (targetInfo && targetInfo.inp.number !== program && !inFlight) {
      if (msOnCam >= cfg.timing.minOnCamMs) {
        // Address the input by its GUID (from the live snapshot) — immune to a
        // renumbering that lands between this snapshot and the command.
        this.#switchTo(broker!, targetInfo.inp.key);
        this.#expectedProgram = targetInfo.inp.number;
        this.#commandedAt = now;
      } else {
        reason += " · dwell";
      }
    }

    this.#reason = reason;
    this.#maybeEmit(now);
  }

  #switchTo(
    broker: { send(c: unknown): Promise<unknown> },
    input: string
  ): void {
    const t = this.getConfig().transition;
    const cmd =
      t.type === "Cut"
        ? { Function: "Cut", Input: input }
        : { Function: t.type, Input: input, Duration: String(t.durationMs) };
    void Promise.resolve(broker.send(cmd)).catch((e) =>
      log.warn(`switch to input ${input} failed: ${e instanceof Error ? e.message : e}`)
    );
  }

  /** One-time migration for configs saved before GUID refs: adopt the GUID
   *  (and cache the title) of the input each number-only ref points at RIGHT
   *  NOW, then persist. From then on the mapping survives vMix renumbering
   *  inputs. No-op once every ref carries a key. */
  #backfillKeys(byNumber: Map<number, VmixInput>): AutoSwitchConfig | null {
    const cfg = this.#config;
    if (!cfg || !cfg.cameras.some((c) => !c.key || c.mics.some((m) => !m.key))) {
      return null;
    }
    let changed = false;
    const fill = (ref: AutoInputRef): AutoInputRef => {
      if (ref.key) return ref;
      const inp = byNumber.get(ref.input);
      if (!inp) return ref;
      changed = true;
      return { ...ref, key: inp.key, label: ref.label ?? inp.title };
    };
    const cameras = cfg.cameras.map((c) => {
      const camRef = fill(c);
      const mics = c.mics.map(fill);
      if (camRef === c && mics.every((m, i) => m === c.mics[i])) return c;
      return { ...c, key: camRef.key, label: camRef.label, mics };
    });
    if (!changed) return null;
    log.info("adopted input GUIDs for legacy camera/mic refs");
    this.#config = setAutoSwitchConfig({ ...cfg, cameras });
    return this.#config;
  }

  /** Push immediately (config saves / toggles — the user wants instant echo). */
  #forceEmit(): void {
    const st = this.getState();
    this.#lastSig = this.#signature(st);
    this.#lastEmitAt = Date.now();
    this.emit("state", st);
  }

  /** Push only when the discrete state changed or the heartbeat elapsed — keeps
   *  the client off a 10 fps re-render loop driven by the decision tick. */
  #maybeEmit(now: number): void {
    const st = this.getState();
    const sig = this.#signature(st);
    if (sig !== this.#lastSig || now - this.#lastEmitAt >= MIN_EMIT_MS) {
      this.#lastSig = sig;
      this.#lastEmitAt = now;
      this.emit("state", st);
    }
  }

  /** Identity of the bits the UI actually renders (everything except the
   *  continuously-changing countdown), so an unchanged frame is dropped. */
  #signature(st: AutoSwitchState): string {
    return (
      `${st.running}|${st.connected}|${st.reason}|${st.programInput}|` +
      `${st.overrideForMs !== null}|${st.sources.map((s) => (s.speaking ? "1" : "0")).join("")}`
    );
  }

  dispose(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.removeAllListeners();
    this.#sources.clear();
  }
}

export const autoSwitchEngine = hmrSingleton(
  "auto-switch-engine-v1",
  AutoSwitchEngineImpl
);
export type AutoSwitchEngine = AutoSwitchEngineImpl;

// Re-export so routes/components import config helpers from one place.
export { defaultConfig };
