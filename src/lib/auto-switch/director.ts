/** dB floor true silence is mapped to (meterToDb(0) is -Infinity). */
export const SILENCE_DB = -100;

/**
 * A resolved, cuttable shot: a configured camera whose vMix input exists RIGHT
 * NOW. `id` is the camera's stable ref id (input GUID, or the number-derived
 * legacy fallback — see `refId` in types.ts); `mics` are the stable ids of the
 * mics it frames that currently resolve. Working on ids rather than input
 * numbers keeps every decision immune to vMix renumbering inputs mid-show.
 */
export interface Shot {
  id: string;
  mics: string[];
}

export interface RankedShot {
  shot: Shot;
  /** How many currently-talking mics this shot frames. */
  cov: number;
  /** Loudest of its talking mics (dB). */
  lvl: number;
  /** A strict majority of the people it frames spoke recently. */
  maj: boolean;
}

/**
 * Pure director ranking — the heart of the auto-mix decision, extracted from
 * the engine so it can be unit-tested against real-world camera layouts
 * without timers/singletons.
 *
 * Candidates are the shots framing at least one CURRENT talker, ordered by:
 *  1. majority-recent first — strictly more than half of the shot's mics spoke
 *     within the recent window (2/3 yes, 2/4 no, 1/1 yes), so a multi-mic
 *     scene never beats a tighter shot just because it CONTAINS the active
 *     mic; enough of the others must be part of the live conversation.
 *     This is a PREFERENCE, not a hard filter: when NO shot qualifies
 *     (e.g. every camera carries several mics and one person talks), we still
 *     rank the framing shots instead of going dark — freezing the mix is
 *     always worse than an imperfect shot.
 *  2. coverage — how many current talkers the shot shows;
 *  3. loudness — level of its loudest talking mic;
 *  4. specificity — tightest first (fewest mics = fewest silent people).
 */
export function rankShots(
  shots: readonly Shot[],
  micTalking: ReadonlySet<string>,
  micLevel: ReadonlyMap<string, number>,
  isRecent: (mic: string) => boolean
): RankedShot[] {
  return shots
    .map((shot) => {
      let cov = 0;
      let lvl = SILENCE_DB;
      for (const m of shot.mics) {
        if (!micTalking.has(m)) continue;
        cov++;
        lvl = Math.max(lvl, micLevel.get(m) ?? SILENCE_DB);
      }
      const recent = shot.mics.filter(isRecent).length;
      return { shot, cov, lvl, maj: recent * 2 > shot.mics.length };
    })
    .filter((r) => r.cov > 0)
    .sort(
      (a, b) =>
        Number(b.maj) - Number(a.maj) ||
        b.cov - a.cov ||
        b.lvl - a.lvl ||
        a.shot.mics.length - b.shot.mics.length
    );
}

/**
 * Candidate shot ids for a monologue REACTION cut: other shots that frame the
 * lone speaker, preferring scenes WIDER than the current shot (the speaker
 * with MORE people — a real listening/reaction shot) and falling back to any
 * other angle of the speaker. Works whether the current shot is a solo or
 * already a small multi-mic scene — a setup may have no solo cameras at all.
 * Empty when nothing else frames the speaker (single-camera setups).
 */
export function reactionPool(
  shots: readonly Shot[],
  programId: string,
  loneMic: string,
  currentWidth: number
): string[] {
  const framing = shots.filter(
    (s) => s.id !== programId && s.mics.includes(loneMic)
  );
  const wider = framing.filter((s) => s.mics.length > currentWidth);
  return (wider.length ? wider : framing).map((s) => s.id);
}

/**
 * Shots framing EXACTLY the same mics as `id` — interchangeable ANGLES of the
 * same scene (e.g. a scene list view and a telestrator view of the same two
 * people). They rank as perfect ties, so without this concept the stable sort
 * would always pick whichever comes first in the config and the other angle
 * would never air. The engine uses this both ways: to STAY on the current
 * shot when the "best" is merely an equivalent angle (no wasted cut), and to
 * ROTATE between angles on the variety cooldown so each one gets airtime.
 */
export function equivalentAngles(
  shots: readonly Shot[],
  id: string
): string[] {
  const me = shots.find((s) => s.id === id);
  if (!me) return [];
  const set = new Set(me.mics);
  return shots
    .filter(
      (s) =>
        s.id !== id &&
        s.mics.length === set.size &&
        s.mics.every((m) => set.has(m))
    )
    .map((s) => s.id);
}
