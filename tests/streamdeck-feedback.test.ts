import { describe, expect, it } from "vitest";
import { evaluateFeedback } from "@/lib/streamdeck/feedback";
import type { DeckBinding } from "@/lib/db/streamdeck";

const RED = "#ff3b30"; // program / live
const GREEN = "#34c759"; // preview / on
const GUID = "8db8d2e1-1a2b-3c4d-5e6f-001122334455"; // a vMix input key

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

describe("multi-step feedback (audit B4)", () => {
  it("shows tally for the relevant action even when it isn't step[0]", () => {
    const binding: DeckBinding = {
      connectionId: "c1",
      preset: {
        globalId: "vmix:combo",
        kind: "vmix",
        id: "combo",
        label: "combo",
        // step[0] has no tally; the cut (tally-relevant) is step[1].
        steps: [
          { actionId: "sc-fadetoblack", options: {} },
          { actionId: "sc-cut", options: { input: "2" } },
        ],
      },
    };
    expect(fb(binding, { tally_active: 2 })?.bgcolor).toBe(RED);
  });

  it("returns null when no step's action yields a feedback override", () => {
    const binding: DeckBinding = {
      connectionId: "c1",
      preset: {
        globalId: "vmix:combo2",
        kind: "vmix",
        id: "combo2",
        label: "combo2",
        steps: [{ actionId: "sc-cut", options: { input: "9" } }],
      },
    };
    expect(fb(binding, { tally_active: 2, tally_preview: 1 })).toBeNull();
  });
});

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

  it("matches a KEY-pinned binding (rename + reorder safe) against the tally key", () => {
    // Binding stores the input KEY (GUID); vMix reports active by number + key.
    expect(
      fb(vmixKey("sc-cut", { input: GUID }), {
        tally_active: 3,
        tally_active_key: GUID,
      })?.bgcolor
    ).toBe(RED);
    expect(
      fb(vmixKey("sc-previewinput", { input: GUID }), {
        tally_preview: 3,
        tally_preview_key: GUID,
      })?.bgcolor
    ).toBe(GREEN);
  });
});

describe("vMix disconnected feedback (bound input gone)", () => {
  it("dims a key-pinned button when its input key is absent from vMix", () => {
    const ov = fb(vmixKey("sc-cut", { input: GUID }), {
      input_keys: "other-1,other-2",
      tally_active: 1,
    });
    expect(ov?.bgcolor).toBe("#1c1c1e");
  });

  it("does NOT flag when the key is present, or for legacy number bindings", () => {
    expect(
      fb(vmixKey("sc-cut", { input: GUID }), { input_keys: `x,${GUID}`, tally_active: 1 })
    ).toBeNull(); // present but not live → no override (not disconnected)
    expect(
      fb(vmixKey("sc-cut", { input: "2" }), { input_keys: "a,b", tally_active: 9 })
    ).toBeNull(); // legacy number binding is never "disconnected"
  });
});

describe("vMix overlay tally feedback (red live / green preview)", () => {
  it("RED when this overlay channel is live showing this input", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), { overlay_2: 7 })
        ?.bgcolor
    ).toBe(RED);
  });

  it("GREEN when this overlay channel is previewing this input", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), {
        overlay_2: 0,
        overlay_2_pvw: 7,
      })?.bgcolor
    ).toBe(GREEN);
  });

  it("PreviewOverlayInput button reads the same preview tally", () => {
    expect(
      fb(vmixKey("sc-previewoverlayinput", { ch: 1, input: "5" }), {
        overlay_1_pvw: 5,
      })?.bgcolor
    ).toBe(GREEN);
  });

  it("null when the overlay channel is empty for this input", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: "7" }), {
        overlay_2: 4,
        overlay_2_pvw: 0,
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
  it("red when the input is muted, null otherwise (by number)", () => {
    expect(
      fb(vmixKey("sc-audio", { input: "4" }), { input_4_muted: true })?.bgcolor
    ).toBe(RED);
    expect(
      fb(vmixKey("sc-audio", { input: "4" }), { input_4_muted: false })
    ).toBeNull();
  });

  it("resolves a KEY-pinned mute binding to the right input", () => {
    expect(
      fb(vmixKey("sc-audio", { input: GUID }), {
        input_keys: GUID,
        input_5_key: GUID,
        input_5_muted: true,
      })?.bgcolor
    ).toBe(RED);
  });
});

describe("vMix overlay feedback by input key", () => {
  it("RED when the overlay channel is live with the keyed input", () => {
    expect(
      fb(vmixKey("sc-overlayinput", { ch: 2, input: GUID }), {
        input_keys: GUID,
        overlay_2: 6,
        overlay_2_key: GUID,
      })?.bgcolor
    ).toBe(RED);
  });
});

// ─────────────────────────── X32 mute feedback ────────────────────────

/** One-step X32 binding on connection "x1". */
function x32Key(
  actionId: string,
  options: Record<string, unknown> = {}
): DeckBinding {
  return {
    connectionId: "x1",
    preset: {
      globalId: `x32:${actionId}`,
      kind: "x32",
      id: actionId,
      label: actionId,
      steps: [{ actionId, options }],
    },
  };
}

const x32fb = (b: DeckBinding, vars: Record<string, unknown>) =>
  evaluateFeedback(b, { x1: vars }, { x32: ["x1"] });

describe("X32 mute feedback — RED when the target is muted", () => {
  it("channel mute lights red when ch_on is false (muted), null when audible", () => {
    expect(x32fb(x32Key("ch-mute", { channel: 5 }), { ch_5_on: false })?.bgcolor).toBe(RED);
    expect(x32fb(x32Key("ch-mute", { channel: 5 }), { ch_5_on: true })).toBeNull();
  });

  it("the mute TOGGLE reflects the same live state", () => {
    expect(
      x32fb(x32Key("ch-mute-toggle", { channel: 1 }), { ch_1_on: false })?.bgcolor
    ).toBe(RED);
  });

  it("main + DCA + bus mutes resolve their own state var", () => {
    expect(x32fb(x32Key("main-mute-toggle"), { main_on: false })?.bgcolor).toBe(RED);
    expect(x32fb(x32Key("dca-3-mute"), { dca_3_on: false })?.bgcolor).toBe(RED);
    expect(x32fb(x32Key("bus-mute", { bus: 2 }), { bus_2_on: true })).toBeNull();
  });

  it("a mute group lights red only when the group is ACTIVE (muting)", () => {
    expect(x32fb(x32Key("mute-group-set", { group: 4 }), { mutegroup_4: true })?.bgcolor).toBe(RED);
    expect(x32fb(x32Key("mute-group-set", { group: 4 }), { mutegroup_4: false })).toBeNull();
  });

  it("dims every X32 key when the console is disconnected", () => {
    const r = x32fb(x32Key("ch-mute", { channel: 1 }), { connected: false });
    expect(r?.badge?.color).toBe(RED);
  });
});
