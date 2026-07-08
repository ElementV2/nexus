import { describe, expect, it } from "vitest";
import {
  equivalentAngles,
  rankShots,
  reactionPool,
  SILENCE_DB,
  type Shot,
} from "@/lib/auto-switch/director";

// Shots are id-based (vMix input GUIDs in production — plain strings here;
// the director never sees input numbers, so renumbering can't affect it).
const shot = (id: string, mics: string[]): Shot => ({ id, mics });

/** Helpers: mics currently talking + per-mic level + which mics are "recent". */
const talking = (...mics: string[]) => new Set(mics);
const levels = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));
const recent =
  (...mics: string[]) =>
  (mic: string) =>
    mics.includes(mic);

describe("auto-switch director ranking", () => {
  // Regression: the 2026-07 prod freeze. Three cameras, ALL multi-mic (group
  // 1-4 + two 2-shots), one person talking. The old hard majority filter
  // eliminated every candidate and the mix never switched.
  it("still cuts when every camera carries several mics (no solo cams)", () => {
    const shots = [
      shot("group", ["m1", "m2", "m3", "m4"]),
      shot("duoAB", ["m1", "m2"]),
      shot("duoCD", ["m3", "m4"]),
    ];
    const ranked = rankShots(shots, talking("m1"), levels({ m1: -20 }), recent("m1"));
    expect(ranked.length).toBeGreaterThan(0);
    // Tightest camera framing the talker wins (2 mics beats 4).
    expect(ranked[0].shot.id).toBe("duoAB");
    expect(ranked[0].maj).toBe(false); // fallback shot, not a majority one
  });

  it("prefers the solo over a 2-shot when only one person talks (majority)", () => {
    const shots = [shot("solo1", ["m1"]), shot("duo", ["m1", "m2"])];
    const ranked = rankShots(shots, talking("m1"), levels({ m1: -20 }), recent("m1"));
    expect(ranked[0].shot.id).toBe("solo1"); // maj 1/1 beats maj 1/2
  });

  it("promotes the 2-shot when both of its people talk", () => {
    const shots = [shot("solo1", ["m1"]), shot("solo2", ["m2"]), shot("duo", ["m1", "m2"])];
    const ranked = rankShots(
      shots,
      talking("m1", "m2"),
      levels({ m1: -20, m2: -22 }),
      recent("m1", "m2")
    );
    expect(ranked[0].shot.id).toBe("duo"); // cov 2 beats cov 1
  });

  it("applies strict majority: 2 recent of 4 does NOT qualify, 2 of 2 does", () => {
    const shots = [shot("group", ["m1", "m2", "m3", "m4"]), shot("duo", ["m1", "m2"])];
    // Mics 1+2 recent, mic 1 talking: both shots frame the talker (cov 1) but
    // only the 2-shot has a majority in the conversation.
    const ranked = rankShots(shots, talking("m1"), levels({ m1: -20 }), recent("m1", "m2"));
    expect(ranked[0].shot.id).toBe("duo");
    expect(ranked[0].maj).toBe(true);
    expect(ranked[1].shot.id).toBe("group");
    expect(ranked[1].maj).toBe(false);
  });

  it("excludes shots framing no current talker", () => {
    const shots = [shot("solo1", ["m1"]), shot("solo2", ["m2"])];
    const ranked = rankShots(shots, talking("m1"), levels({ m1: -20 }), recent("m1"));
    expect(ranked.map((r) => r.shot.id)).toEqual(["solo1"]);
  });

  it("breaks coverage ties by loudness", () => {
    const shots = [shot("solo1", ["m1"]), shot("solo2", ["m2"])];
    const ranked = rankShots(
      shots,
      talking("m1", "m2"),
      levels({ m1: -30, m2: -18 }),
      recent("m1", "m2")
    );
    expect(ranked[0].shot.id).toBe("solo2");
  });

  it("treats a shot with an unknown mic level as silent, not NaN", () => {
    const ranked = rankShots([shot("solo1", ["m1"])], talking("m1"), levels({}), recent("m1"));
    expect(ranked[0].lvl).toBe(SILENCE_DB);
  });

  it("never returns a pure-visual shot (empty mic list)", () => {
    const shots = [shot("solo1", ["m1"]), shot("visual", [])];
    const ranked = rankShots(shots, talking("m1"), levels({ m1: -20 }), recent("m1"));
    expect(ranked.map((r) => r.shot.id)).toEqual(["solo1"]);
  });
});

describe("monologue reaction pool", () => {
  it("prefers scenes WIDER than the current shot that frame the speaker", () => {
    const shots = [
      shot("solo1", ["m1"]),
      shot("duo", ["m1", "m2"]),
      shot("group", ["m1", "m2", "m3", "m4"]),
    ];
    // Speaker on their solo (width 1): both multi-mic scenes qualify.
    expect(reactionPool(shots, "solo1", "m1", 1).sort()).toEqual(["duo", "group"]);
    // Speaker already on the 2-shot (width 2): only the group is wider.
    expect(reactionPool(shots, "duo", "m1", 2)).toEqual(["group"]);
  });

  it("falls back to another angle of the speaker when nothing is wider", () => {
    const shots = [shot("front", ["m1"]), shot("side", ["m1"])]; // two angles, same person
    expect(reactionPool(shots, "front", "m1", 1)).toEqual(["side"]);
  });

  it("returns empty when no other shot frames the speaker", () => {
    const shots = [shot("solo1", ["m1"]), shot("solo2", ["m2"])];
    expect(reactionPool(shots, "solo1", "m1", 1)).toEqual([]);
  });

  it("works in the no-solo-cams prod layout (2-shot → group reaction)", () => {
    const shots = [
      shot("group", ["m1", "m2", "m3", "m4"]),
      shot("duoAB", ["m1", "m2"]),
      shot("duoCD", ["m3", "m4"]),
    ];
    // Monologue on mic 1 held on the 2-shot: reaction = the group cam.
    expect(reactionPool(shots, "duoAB", "m1", 2)).toEqual(["group"]);
  });
});

describe("equivalent angles", () => {
  // Regression: two shots with the SAME mic set (e.g. a scene list view and a
  // telestrator view of the same two people) rank as a perfect tie, so the
  // stable sort always favoured the config-first one and the other never
  // aired. `equivalentAngles` powers both the stay-guard and the rotation.
  it("finds shots framing exactly the same mics (order-insensitive)", () => {
    const shots = [
      shot("list", ["m2", "m6"]),
      shot("telestrator", ["m6", "m2"]),
      shot("solo2", ["m2"]),
    ];
    expect(equivalentAngles(shots, "list")).toEqual(["telestrator"]);
    expect(equivalentAngles(shots, "telestrator")).toEqual(["list"]);
  });

  it("ignores subsets, supersets, and disjoint sets", () => {
    const shots = [
      shot("duo", ["m1", "m2"]),
      shot("solo1", ["m1"]), // subset
      shot("trio", ["m1", "m2", "m3"]), // superset
      shot("other", ["m3", "m4"]), // disjoint
    ];
    expect(equivalentAngles(shots, "duo")).toEqual([]);
  });

  it("returns empty for an unknown id and excludes the shot itself", () => {
    const shots = [shot("a", ["m1"]), shot("b", ["m1"])];
    expect(equivalentAngles(shots, "zz")).toEqual([]);
    expect(equivalentAngles(shots, "a")).toEqual(["b"]);
  });
});
