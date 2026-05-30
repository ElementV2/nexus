import { describe, expect, it } from "vitest";
import { evaluateFeedback } from "@/lib/streamdeck/feedback";
import type { DeckBinding } from "@/lib/db/streamdeck";

const RED = "#ff3b30"; // program / live
const GREEN = "#34c759"; // preview

/** Build a one-step vMix binding on connection "c1" for `action` + input. */
function vmixKey(action: string, input: number): DeckBinding {
  return {
    connectionId: "c1",
    preset: {
      globalId: `vmix:${action}`,
      kind: "vmix",
      id: action,
      label: action,
      steps: [{ actionId: action, options: { input } }],
    },
  };
}

const KINDS = { vmix: ["c1"] };
const evalv = (b: DeckBinding, vars: Record<string, unknown>) =>
  evaluateFeedback(b, { c1: vars }, KINDS);

describe("tally feedback — PROGRAM wins over PREVIEW (live priority)", () => {
  it("preview button stays RED when its input is live (on PGM), even if also on PVW", () => {
    // The exact reported bug: input 2 is on program AND queued on preview.
    const fb = evalv(vmixKey("preview-input", 2), {
      tally_active: 2,
      tally_preview: 2,
    });
    expect(fb?.bgcolor).toBe(RED);
  });

  it("preview button is GREEN when its input is only on preview", () => {
    const fb = evalv(vmixKey("preview-input", 2), {
      tally_active: 1,
      tally_preview: 2,
    });
    expect(fb?.bgcolor).toBe(GREEN);
  });

  it("cut/pgm button is RED when its input is live", () => {
    const fb = evalv(vmixKey("cut", 3), { tally_active: 3, tally_preview: 1 });
    expect(fb?.bgcolor).toBe(RED);
  });

  it("returns null when the input is neither on PGM nor PVW", () => {
    expect(evalv(vmixKey("preview-input", 5), {
      tally_active: 1,
      tally_preview: 2,
    })).toBeNull();
  });
});
