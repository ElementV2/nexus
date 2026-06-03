import { fileMtimeMs, readJson, writeJson } from "./index";
import type { DeckStep } from "./streamdeck";

/**
 * Persisted "Live Show" timelines (scenarios). Stored in a dedicated
 * file so the main preferences blob stays small — a show with dozens of
 * cues across several tracks is several KB of JSON, and an operator may
 * keep many shows.
 *
 * A scenario is an absolute-time timeline: every clip carries an
 * `offsetMs` (its position on the ruler) and a `step` — the SAME
 * {@link DeckStep} a deck button fires, so the whole action catalog,
 * per-step connection pinning and cross-kind routing are reused verbatim
 * by the playback engine (`lib/timeline/engine.ts` → `runSteps`).
 *
 * WAIT markers live at scenario level (not per-track) because they pause
 * the GLOBAL playhead until the operator presses GO. Storage only — the
 * engine owns the live playhead; nothing here writes runtime position.
 */

const FILE = "timeline.json";

/**
 * A "cue" placed on a track at an absolute time — the timeline equivalent of
 * a Stream Deck button. It holds an ORDERED LIST of actions (`steps`, same
 * shape as a deck binding's steps) fired together when the playhead crosses
 * `offsetMs`. So a multi-action deck shortcut maps to ONE clip, not several.
 */
export interface TimelineClip {
  /** Stable id (free-form). */
  id: string;
  /** Absolute position on the timeline, in milliseconds from t=0. */
  offsetMs: number;
  /** Optional display overrides for the clip tile (else derived from the
   *  first action). */
  label?: string;
  color?: string;
  /** Button-level connection pin (like a deck binding): a step without its
   *  own pin inherits this. */
  connectionId?: string;
  /** The actions fired (in order) when the playhead crosses `offsetMs` —
   *  same semantics as a deck button's steps (incl. internal delays). */
  steps: DeckStep[];
}

/** A horizontal lane of clips. Tracks fire in parallel — two clips at the
 *  same `offsetMs` on different tracks run together. */
export interface Track {
  id: string;
  label: string;
  /** Kept sorted by `offsetMs` (the engine re-sorts defensively anyway). */
  clips: TimelineClip[];
}

/**
 * A GO point. When the playhead reaches `offsetMs` and the engine is not
 * in "skip waits" mode, playback clamps here and waits until the operator
 * presses GO (`engine.go()`), then resumes.
 */
export interface WaitMarker {
  id: string;
  offsetMs: number;
  label?: string;
}

export interface Scenario {
  /** Stable id. Free-form ("default", "show-…"). */
  id: string;
  label: string;
  /** Total length in ms. Auto-grows when a clip/wait is placed beyond it;
   *  the playhead stops the scenario when it passes this. */
  durationMs: number;
  tracks: Track[];
  /** GO points, scenario-global. Kept sorted by `offsetMs`. */
  waits: WaitMarker[];
}

export interface TimelineStore {
  scenarios: Scenario[];
}

/** Sensible empty show: one minute, a single track, no cues. */
const DEFAULT_STORE: TimelineStore = {
  scenarios: [
    {
      id: "default",
      label: "My Show",
      durationMs: 60_000,
      tracks: [{ id: "track-1", label: "Track 1", clips: [] }],
      waits: [],
    },
  ],
};

/**
 * Coerce a persisted/posted clip into the multi-step shape. Migrates the
 * legacy single-`step` clips (pre-multi-action) to `steps: [step]`. Returns
 * null for a clip with no usable actions so it's dropped.
 */
function normalizeClip(raw: unknown): TimelineClip | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as TimelineClip & { step?: DeckStep };
  const steps: DeckStep[] = Array.isArray(c.steps)
    ? c.steps.filter((s): s is DeckStep => !!s && typeof s === "object" && !!s.actionId)
    : c.step && typeof c.step === "object"
      ? [c.step]
      : [];
  if (steps.length === 0) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id : `clip-${c.offsetMs}`,
    offsetMs: Math.max(0, Number(c.offsetMs) || 0),
    label: typeof c.label === "string" ? c.label : undefined,
    color: typeof c.color === "string" ? c.color : undefined,
    connectionId: typeof c.connectionId === "string" ? c.connectionId : undefined,
    steps,
  };
}

/**
 * Coerce a persisted/posted scenario into a well-formed object: drop
 * malformed clips/tracks, sort clips + waits by time, and ensure
 * `durationMs` covers the furthest cue. Defensive so an old store or a
 * hand-edited file never crashes the engine.
 */
export function normalizeScenario(raw: Scenario): Scenario {
  const id = typeof raw.id === "string" && raw.id ? raw.id : "default";
  const label =
    typeof raw.label === "string" && raw.label.trim() ? raw.label : id;

  const tracks: Track[] = (Array.isArray(raw.tracks) ? raw.tracks : []).map(
    (t, i) => {
      const clips: TimelineClip[] = (Array.isArray(t?.clips) ? t.clips : [])
        .map((c) => normalizeClip(c))
        .filter((c): c is TimelineClip => c !== null)
        .sort((a, b) => a.offsetMs - b.offsetMs);
      return {
        id: typeof t?.id === "string" && t.id ? t.id : `track-${i + 1}`,
        label:
          typeof t?.label === "string" && t.label.trim()
            ? t.label
            : `Track ${i + 1}`,
        clips,
      };
    }
  );
  // Always keep at least one track so the editor has somewhere to drop.
  if (tracks.length === 0) {
    tracks.push({ id: "track-1", label: "Track 1", clips: [] });
  }

  const waits: WaitMarker[] = (Array.isArray(raw.waits) ? raw.waits : [])
    .filter((w): w is WaitMarker => !!w && typeof w === "object")
    .map((w) => ({
      id: typeof w.id === "string" && w.id ? w.id : `wait-${w.offsetMs}`,
      offsetMs: Math.max(0, Number(w.offsetMs) || 0),
      label: typeof w.label === "string" ? w.label : undefined,
    }))
    .sort((a, b) => a.offsetMs - b.offsetMs);

  // Furthest cue defines the minimum sensible length.
  const furthest = Math.max(
    0,
    ...tracks.flatMap((t) => t.clips.map((c) => c.offsetMs)),
    ...waits.map((w) => w.offsetMs)
  );
  const durationMs = Math.max(1_000, Number(raw.durationMs) || 0, furthest);

  return { id, label, durationMs, tracks, waits };
}

// mtime-gated cache, mirroring streamdeck.ts: the engine reads the store
// on every `play` and the API on every save. A write bumps the file mtime
// so the cache self-invalidates and external launcher edits are picked up.
let storeCache: { mtime: number | null; value: TimelineStore } | null = null;

function computeTimelineStore(): TimelineStore {
  const mtime = fileMtimeMs(FILE);
  if (storeCache && storeCache.mtime === mtime) {
    return storeCache.value;
  }
  const raw = readJson<Partial<TimelineStore>>(FILE, {});
  const value: TimelineStore =
    !raw.scenarios ||
    !Array.isArray(raw.scenarios) ||
    raw.scenarios.length === 0
      ? DEFAULT_STORE
      : { scenarios: (raw.scenarios as Scenario[]).map(normalizeScenario) };
  storeCache = { mtime, value };
  return value;
}

/** Public read: deep clone so callers can mutate freely. */
export function getTimelineStore(): TimelineStore {
  return structuredClone(computeTimelineStore());
}

/** Hot-path read: cached store WITHOUT cloning. MUST be read-only. */
export function peekTimelineStore(): Readonly<TimelineStore> {
  return computeTimelineStore();
}

export function setTimelineStore(next: TimelineStore): TimelineStore {
  writeJson(FILE, next);
  // Prime the cache with the just-written value + fresh mtime so an
  // immediate read-back hits cache.
  storeCache = { mtime: fileMtimeMs(FILE), value: next };
  return next;
}

export function getScenario(id: string): Scenario | undefined {
  return getTimelineStore().scenarios.find((s) => s.id === id);
}

/** Read-only scenario lookup for the engine hot path (no clone). */
export function peekScenario(id: string): Readonly<Scenario> | undefined {
  return peekTimelineStore().scenarios.find((s) => s.id === id);
}

export function upsertScenario(scenario: Scenario): TimelineStore {
  const norm = normalizeScenario(scenario);
  const cur = getTimelineStore();
  const idx = cur.scenarios.findIndex((s) => s.id === norm.id);
  const scenarios =
    idx >= 0
      ? cur.scenarios.map((s, i) => (i === idx ? norm : s))
      : [...cur.scenarios, norm];
  return setTimelineStore({ scenarios });
}

export function removeScenario(id: string): TimelineStore {
  const cur = getTimelineStore();
  return setTimelineStore({
    scenarios: cur.scenarios.filter((s) => s.id !== id),
  });
}
