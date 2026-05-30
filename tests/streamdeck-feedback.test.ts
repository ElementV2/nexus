import { describe, expect, it } from "vitest";
import { evaluateFeedback } from "@/lib/streamdeck/feedback";
import type { DeckBinding } from "@/lib/db/streamdeck";

const RED = "#ff3b30"; // program / live
const GREEN = "#34c759"; // preview / on

/** Build a one-step vMix binding on connection "c1" with the given generated
 *  action id + options. */
function vmixKey(
  actionId: string,
  options: Record<string, unknown>
): DeckBinding {
  return {
    connectionId: "c1",
    preset: {
      globalId: `vmix:${actionId}`,
      kind: "vmix",
      id: actionId,
      label: actionId,
      steps: [{ actionId, options }],
    },
  };
}

const KINDS = { vmix: ["c1"] };
const fb = (b: DeckBinding, vars: Record<string, unknown>) =>
  evaluateFeedback(b, { c1: vars }, KINDS);

describe("vMix tally feedback — PROGRAM wins over PREVIEW (live priority)", () => {
  it("a cut/transition button is RED when its input is live, even if also on PVW", () => {
    expect(
      fb(vmixKey("sc-cut", { input: "2" }), { tally_active: 2, tally_preview: 2 })
        ?.bgcolor
    ).toBe(RED);
  });

  it("the preview button is GREEN when its input is only on preview", () => {
    expect(
      fb(vmixKey("sc-previewinput", { input: "2" }), {
        tally_active: 1,
        tally_preview: 2,
      })?.bgcolor
    ).toBe(GREEN);
  });

  it("a transition button (Fade) tallies like Cut", () => {
    expect(
      fb(vmixKey("sc-fade", { input: "3" }), { tally_active: 3 })?.bgcolor
    ).toBe(RED);
  });

  it("returns null when the input is neither on PGM nor PVW", () => {
    expect(
      fb(vmixKey("sc-cut", { input: "5" }), { tally_active: 1, tally_preview: 2 })
    ).toBeNull();
  });
});

describe("vMix overlay tally feedback (red live / green preview)", () => {
  it("RED when this overlay channel is live showing this input", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), { overlay_2: 7 })
        ?.bgcolor
    ).toBe(RED);
  });

  it("GREEN when the button's input is staged on preview", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), {
        overlay_2: 4,
        tally_preview: 7,
      })?.bgcolor
    ).toBe(GREEN);
  });

  it("null when the overlay is off and the input isn't on preview", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), {
        overlay_2: 4,
        tally_preview: 1,
      })
    ).toBeNull();
  });

  it("off/out buttons (no input) go RED whenever the channel is up", () => {
    expect(
      fb(vmixKey("sc-overlayinputoff", { ch: 3 }), { overlay_3: 9 })?.bgcolor
    ).toBe(RED);
    expect(
      fb(vmixKey("sc-overlayinputoff", { ch: 3 }), { overlay_3: 0 })
    ).toBeNull();
  });
});

describe("vMix audio bus on/off feedback", () => {
  it("fixed-bus button: green when the bus is on, dim when muted", () => {
    expect(fb(vmixKey("sc-busaaudioon", {}), { bus_a_on: true })?.bgcolor).toBe(
      GREEN
    );
    expect(fb(vmixKey("sc-busaaudio", {}), { bus_a_on: false })?.bgcolor).toBe(
      "#3a3a3c"
    );
  });

  it("master button reads bus_m_on", () => {
    expect(fb(vmixKey("sc-masteraudio", {}), { bus_m_on: true })?.bgcolor).toBe(
      GREEN
    );
  });

  it("BusX button resolves the bus from its Value option", () => {
    expect(
      fb(vmixKey("sc-busxaudioon", { value: "C" }), { bus_c_on: true })?.bgcolor
    ).toBe(GREEN);
  });
});

describe("vMix per-input mute feedback", () => {
  it("red MUTE when the input is muted, null otherwise", () => {
    expect(
      fb(vmixKey("sc-audio", { input: "4" }), { input_4_muted: true })?.bgcolor
    ).toBe(RED);
    expect(
      fb(vmixKey("sc-audio", { input: "4" }), { input_4_muted: false })
    ).toBeNull();
  });
});
