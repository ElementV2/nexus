import { describe, expect, it } from "vitest";
import {
  applyLayoutUpsert,
  normalizeLayout,
  type DeckLayout,
} from "@/lib/db/streamdeck";

function layout(id: string, deviceSerials: string[] = []): DeckLayout {
  return { id, model: "xl", label: id, deviceSerials, bindings: {} };
}

describe("normalizeLayout — pairing migration", () => {
  it("migrates a legacy single deviceSerial into deviceSerials[]", () => {
    const legacy = {
      id: "a",
      model: "xl",
      label: "a",
      deviceSerial: "S1",
      bindings: {},
    } as unknown as DeckLayout;
    const n = normalizeLayout(legacy);
    expect(n.deviceSerials).toEqual(["S1"]);
    expect((n as { deviceSerial?: string }).deviceSerial).toBeUndefined();
  });

  it("dedupes and drops empty serials", () => {
    expect(
      normalizeLayout(layout("a", ["S1", "S1", "", "S2"])).deviceSerials
    ).toEqual(["S1", "S2"]);
  });

  it("defaults to an empty array when unpaired", () => {
    const n = normalizeLayout({
      id: "a",
      model: "xl",
      label: "a",
      bindings: {},
    } as unknown as DeckLayout);
    expect(n.deviceSerials).toEqual([]);
  });
});

describe("applyLayoutUpsert — a layout drives many decks, a deck shows one page", () => {
  it("appends a brand-new layout", () => {
    const next = applyLayoutUpsert([layout("a")], layout("b"));
    expect(next.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing layout in place (same order)", () => {
    const next = applyLayoutUpsert([layout("a"), layout("b")], {
      ...layout("a"),
      label: "renamed",
    });
    expect(next.map((l) => l.id)).toEqual(["a", "b"]);
    expect(next[0].label).toBe("renamed");
  });

  it("lets ONE layout hold MANY serials (load to 3 decks)", () => {
    const next = applyLayoutUpsert([layout("a")], layout("a", ["S1", "S2", "S3"]));
    expect(next[0].deviceSerials).toEqual(["S1", "S2", "S3"]);
  });

  it("steals each claimed serial from any OTHER layout (the bug fix)", () => {
    // Page A drives S1+S2; loading B onto S2 must move only S2.
    const start = [layout("A", ["S1", "S2"]), layout("B")];
    const next = applyLayoutUpsert(start, layout("B", ["S2"]));
    const a = next.find((l) => l.id === "A")!;
    const b = next.find((l) => l.id === "B")!;
    expect(b.deviceSerials).toEqual(["S2"]);
    expect(a.deviceSerials).toEqual(["S1"]); // S2 stolen, S1 kept
  });

  it("leaves layouts paired to OTHER decks untouched", () => {
    const start = [layout("A", ["S1"]), layout("B", ["S2"])];
    const next = applyLayoutUpsert(start, layout("C", ["S3"]));
    expect(next.find((l) => l.id === "A")!.deviceSerials).toEqual(["S1"]);
    expect(next.find((l) => l.id === "B")!.deviceSerials).toEqual(["S2"]);
  });

  it("does not steal anything when the upserted layout has no serials", () => {
    const start = [layout("A", ["S1"])];
    const next = applyLayoutUpsert(start, { ...layout("B"), label: "x" });
    expect(next.find((l) => l.id === "A")!.deviceSerials).toEqual(["S1"]);
  });
});
