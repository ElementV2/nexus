import { describe, expect, it } from "vitest";

// Importing each kind module runs its `registerDeviceKind(...)` side
// effect, populating the registry the catalog reads from. Mirrors the
// set booted by src/lib/core/boot.ts.
import "@/lib/kinds/vmix";
import "@/lib/kinds/obs";
import "@/lib/kinds/ableton";
import "@/lib/kinds/x32";
import "@/lib/kinds/grandma3";
import "@/lib/kinds/grandma2";
import { listKinds } from "@/lib/core/registry";

const kinds = listKinds();

/**
 * Catalog integrity guard. The class of bug this catches: a preset whose
 * step points at an `actionId` that doesn't exist (typo, renamed action,
 * deleted action) — the button would silently do nothing on a surface.
 * Also pins action/preset id uniqueness so a duplicate can't shadow.
 */
describe("device kind catalog integrity", () => {
  it("registers all expected device kinds", () => {
    expect(kinds.map((k) => k.kind).sort()).toEqual([
      "ableton",
      "grandma2",
      "grandma3",
      "obs",
      "vmix",
      "x32",
    ]);
  });

  it("every preset step references an action that exists in its kind", () => {
    const problems: string[] = [];
    for (const k of kinds) {
      const actionIds = new Set((k.actions ?? []).map((a) => a.id));
      for (const p of k.presets ?? []) {
        for (const step of p.steps) {
          if (!actionIds.has(step.actionId)) {
            problems.push(`${k.kind}:${p.id} → missing action "${step.actionId}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("action ids and preset ids are unique within each kind", () => {
    for (const k of kinds) {
      const actionIds = (k.actions ?? []).map((a) => a.id);
      expect(new Set(actionIds).size, `${k.kind} actions`).toBe(actionIds.length);
      const presetIds = (k.presets ?? []).map((p) => p.id);
      expect(new Set(presetIds).size, `${k.kind} presets`).toBe(presetIds.length);
    }
  });

  it("unified browser tiles have unique globalIds per kind (presets + synthesized)", () => {
    // Mirrors the preset browser: tiles = curated presets + an auto-tile
    // for every action not covered by a preset step AND whose globalId no
    // preset already owns. A collision here is a React-key dup + an
    // omitted/duplicated tile (regression guard for `x32:main-mute`).
    for (const k of kinds) {
      const presetGlobalIds = new Set((k.presets ?? []).map((p) => `${k.kind}:${p.id}`));
      const covered = new Set<string>();
      for (const p of k.presets ?? []) {
        for (const s of p.steps) covered.add(`${k.kind}:${s.actionId}`);
      }
      const tileIds = [...presetGlobalIds];
      for (const a of k.actions ?? []) {
        const gid = `${k.kind}:${a.id}`;
        if (!covered.has(gid) && !presetGlobalIds.has(gid)) tileIds.push(gid);
      }
      expect(new Set(tileIds).size, `${k.kind} tile ids`).toBe(tileIds.length);
    }
  });

  it("every action's toCommand runs on its declared defaults without throwing", () => {
    for (const k of kinds) {
      for (const a of k.actions ?? []) {
        const opts: Record<string, unknown> = {};
        for (const o of a.options ?? []) {
          if (o.default !== undefined) opts[o.id] = o.default;
        }
        expect(
          () => a.toCommand(opts),
          `${k.kind}:${a.id} toCommand(defaults)`
        ).not.toThrow();
      }
    }
  });
});
