import { describe, expect, it } from "vitest";
import {
  vmixShortcutActions,
  vmixShortcutPresets,
} from "@/lib/kinds/vmix-shortcut-actions";
import { VMIX_SHORTCUTS } from "@/lib/vmix/shortcuts";

const byId = new Map(vmixShortcutActions.map((a) => [a.id, a]));
const cmd = (id: string, options: Record<string, unknown>) =>
  byId.get(id)!.toCommand(options) as Record<string, unknown>;

describe("vMix shortcut generation — coverage", () => {
  it("produces one action AND one preset per shortcut (scraped + named transitions)", () => {
    expect(vmixShortcutActions.length).toBe(vmixShortcutPresets.length);
    // Every scraped entry, plus the manually-added named transitions
    // (Cut/Fade/Wipe/…) the reference omits.
    expect(vmixShortcutActions.length).toBeGreaterThan(VMIX_SHORTCUTS.length);
  });

  it("includes the named transitions the scrape omits (Cut, Fade, …)", () => {
    for (const id of ["sc-cut", "sc-fade", "sc-wipe", "sc-merge", "sc-zoom"]) {
      expect(byId.has(id), id).toBe(true);
    }
    expect(cmd("sc-cut", { input: "2", mix: 1 })).toEqual({
      Function: "Cut",
      Input: "2",
      Mix: 1,
    });
  });

  it("ids are unique", () => {
    expect(new Set(vmixShortcutActions.map((a) => a.id)).size).toBe(
      vmixShortcutActions.length
    );
  });

  it("every preset references an action that exists", () => {
    for (const p of vmixShortcutPresets) {
      for (const step of p.steps) {
        expect(byId.has(step.actionId)).toBe(true);
      }
    }
  });

  it("every generated preset has a colour (no plain tiles)", () => {
    for (const p of vmixShortcutPresets) {
      expect(p.bgcolor, p.id).toBeTruthy();
      expect(p.fgcolor, p.id).toBeTruthy();
    }
  });

  it("carries curated colours onto the matching generated tiles", () => {
    const byPid = new Map(vmixShortcutPresets.map((p) => [p.id, p]));
    expect(byPid.get("sc-cut")?.bgcolor).toBe("#ff3b30"); // red (PGM/cut)
    expect(byPid.get("sc-previewinput")?.bgcolor).toBe("#34c759"); // green (PVW)
    expect(byPid.get("sc-fade")?.bgcolor).toBe("#ff9500"); // orange (fade)
  });
});

describe("family placeholders become one parameterized action", () => {
  it("int family (Overlay #) + input: OverlayInput{ch} → OverlayInput2", () => {
    const a = byId.get("sc-overlayinput")!;
    // The placeholder is an option picker, not 4 separate presets.
    const chOpt = a.options?.find((o) => o.id === "ch");
    expect(chOpt?.type).toBe("number");
    expect(chOpt).toMatchObject({ min: 1, max: 4 });
    expect(a.options?.some((o) => o.id === "input")).toBe(true);

    expect(cmd("sc-overlayinput", { ch: 2, input: "5", mix: 1 })).toEqual({
      Function: "OverlayInput2",
      Input: "5",
      Mix: 1,
    });
  });

  it("enum family (Bus) + value: SetBus{bus}Volume → SetBusCVolume", () => {
    const a = byId.get("sc-setbusvolume")!;
    const busOpt = a.options?.find((o) => o.id === "bus");
    expect(busOpt?.type).toBe("dropdown");
    expect(cmd("sc-setbusvolume", { bus: "C", value: 50 })).toEqual({
      Function: "SetBusCVolume",
      Value: 50,
    });
  });

  it("defaults the placeholder when unset (first enum / min int)", () => {
    expect(cmd("sc-setbusvolume", { value: 0 }).Function).toBe("SetBusAVolume");
    expect(cmd("sc-overlayinput", {}).Function).toBe("OverlayInput1");
  });

  it("maps the documented params to vMix query keys; omits empties", () => {
    expect(cmd("sc-audio", { input: "3" })).toEqual({
      Function: "Audio",
      Input: "3",
    });
    // Empty/undefined params are dropped, not sent as blanks.
    expect(cmd("sc-audio", { input: "" })).toEqual({ Function: "Audio" });
  });
});
