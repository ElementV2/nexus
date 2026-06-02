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

  it("colours tiles but NEVER red/green at rest (those are live-feedback only)", () => {
    const byPid = new Map(vmixShortcutPresets.map((p) => [p.id, p]));
    // Tally buttons sit on a neutral base so the red/green feedback shows.
    expect(byPid.get("sc-cut")?.bgcolor).toBe("#2c2c2e");
    expect(byPid.get("sc-previewinput")?.bgcolor).toBe("#2c2c2e");
    expect(byPid.get("sc-fade")?.bgcolor).toBe("#ff9500"); // orange (fade)
    // No generated tile may use the reserved feedback colours as its base.
    for (const p of vmixShortcutPresets) {
      expect(p.bgcolor, p.id).not.toBe("#ff3b30"); // feedback red
      expect(p.bgcolor, p.id).not.toBe("#34c759"); // feedback green
    }
  });
});

describe("family placeholders become one parameterized action", () => {
  it("int family (Overlay #) + input: OverlayInput{ch} → OverlayInput2", () => {
    const a = byId.get("sc-overlayinput")!;
    // The placeholder is an option picker, not 4 separate presets.
    const chOpt = a.options?.find((o) => o.id === "ch");
    expect(chOpt?.type).toBe("number");
    expect(chOpt).toMatchObject({ min: 1, max: 8 });
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

  it("defaults Mix to 0 (vMix's main/PGM mix), not 1", () => {
    const mixOpt = byId.get("sc-cut")?.options?.find((o) => o.id === "mix");
    expect(mixOpt).toMatchObject({ default: 0, min: 0 });
  });

  it("splits a composite Value into sub-fields and recomposes it", () => {
    // SetMultiViewOverlay's Value is "Index,Input" — should be two fields.
    const a = byId.get("sc-setmultiviewoverlay")!;
    const ids = (a.options ?? []).map((o) => o.id);
    expect(ids).toContain("value0"); // Index
    expect(ids).toContain("value1"); // Input (source)
    expect(ids).not.toContain("value"); // not a single free field
    expect(cmd("sc-setmultiviewoverlay", { input: "1", value0: "1", value1: "2" })).toEqual({
      Function: "SetMultiViewOverlay",
      Input: "1",
      Value: "1,2",
    });
  });

  it("turns a fixed-choice Value list into a dropdown", () => {
    // SetOutput2's "Value = Output, Preview, MultiView, …" is a defined
    // choice list → one Value dropdown, not a composite, not free text.
    const a = byId.get("sc-setoutput2")!;
    const valueOpt = a.options?.find((o) => o.id === "value");
    expect(valueOpt?.type).toBe("dropdown");
    expect(
      valueOpt?.type === "dropdown" ? valueOpt.choices.map((c) => c.id) : []
    ).toEqual(["Output", "Preview", "MultiView", "Replay", "Mix", "Input"]);
    expect((a.options ?? []).some((o) => o.id === "value0")).toBe(false);
    // Input/Mix fields are gated on the chosen routing target.
    expect(a.options?.find((o) => o.id === "input")?.showWhen).toEqual({
      option: "value",
      equals: "Input",
    });
    expect(a.options?.find((o) => o.id === "mix")?.showWhen).toEqual({
      option: "value",
      equals: "Mix",
    });
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

// Guards the vMix v29 catalog additions so they can't silently regress.
// Every NEW standalone function must surface as its own action button, and
// the families that GREW (replay channels C/D, stinger 1→8) must reach the
// new members through their option pickers.
describe("vMix v29 additions are present in the action list", () => {
  it("exposes each new standalone function as its own action button", () => {
    for (const id of [
      // OMT source select (new protocol + category)
      "sc-omtselectsourcebyindex",
      "sc-omtselectsourcebyname",
      // Quad replay mode
      "sc-replayquadmodeoff",
      "sc-replayquadmodeon",
      "sc-replaytogglequadmode",
      // Append-to-event-text
      "sc-replayappendlasteventtext",
      "sc-replayappendlasteventtextcamera",
      "sc-replayappendselectedeventtext",
      "sc-replayappendselectedeventtextcamera",
      // Named transitions the reference adds in v29
      "sc-wipereverse",
      "sc-slidereverse",
      "sc-verticalwipe",
      "sc-verticalwipereverse",
      "sc-verticalslide",
      "sc-verticalslidereverse",
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it("replay camera channels now reach C and D (was A/B only)", () => {
    // The chn placeholder is a dropdown on the single 'Replay Camera' action.
    const cam = vmixShortcutActions.find((a) =>
      a.options?.some((o) => o.id === "chn")
    );
    expect(cam, "an action with a 'chn' family option").toBeTruthy();
    const chn = cam!.options!.find((o) => o.id === "chn")!;
    const choices = chn.type === "dropdown" ? chn.choices.map((c) => c.id) : [];
    expect(choices).toEqual(["A", "B", "C", "D"]);
    expect(
      (cam!.toCommand({ chn: "D", cam: 8 }) as Record<string, unknown>).Function
    ).toBe("ReplayDCamera8");
  });

  it("stinger families extend to slot 8", () => {
    expect(cmd("sc-stinger", { slot: 8, input: "1" }).Function).toBe("Stinger8");
    expect(
      cmd("sc-setstingergtinput", { slot: 8, input: "1" }).Function
    ).toBe("SetStingerGTInput8");
    const slot = byId.get("sc-stinger")?.options?.find((o) => o.id === "slot");
    expect(slot).toMatchObject({ min: 1, max: 8 });
  });

  it("BtoA timecode casing matches the official reference", () => {
    expect(byId.has("sc-replaysetchannelbtoatimecode")).toBe(true);
  });
});
