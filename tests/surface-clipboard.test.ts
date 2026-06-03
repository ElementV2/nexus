import { describe, it, expect } from "vitest";
import {
  bindingToClips,
  clipToBinding,
} from "@/lib/clipboard/surface-clipboard";
import type { DeckBinding } from "@/lib/db/streamdeck";
import type { TimelineClip } from "@/lib/db/timeline";

/**
 * Cross-surface clipboard conversions. A clip and a deck button share the
 * same model (a list of actions), so a multi-action button maps to ONE
 * multi-action clip — and back — without splitting.
 */

describe("bindingToClips (deck button → ONE show clip)", () => {
  const binding: DeckBinding = {
    connectionId: "c1",
    preset: {
      globalId: "vmix:combo",
      kind: "vmix",
      id: "combo",
      label: "Combo",
      bgcolor: "#112233",
      steps: [
        { actionId: "vmix:sc-cut", options: { input: "2" } },
        { actionId: "internal:delay", kind: "internal", options: { ms: 500 } },
        { actionId: "vmix:sc-fade", options: { input: "3" }, connectionId: "c2" },
      ],
    },
  };

  it("makes a single clip holding ALL the button's actions (no splitting)", () => {
    const clips = bindingToClips(binding, 1000);
    expect(clips).toHaveLength(1);
    const clip = clips[0];
    expect(clip.offsetMs).toBe(1000);
    expect(clip.steps).toHaveLength(3); // delay stays as an in-clip step
    expect(clip.steps.map((s) => s.actionId)).toEqual([
      "vmix:sc-cut",
      "internal:delay",
      "vmix:sc-fade",
    ]);
  });

  it("carries the button face + connection onto the clip", () => {
    const clip = bindingToClips(binding, 0)[0];
    expect(clip.label).toBe("Combo");
    expect(clip.color).toBe("#112233");
    expect(clip.connectionId).toBe("c1");
  });

  it("resolves a BARE step id to a full global id via the button kind", () => {
    const bareButton: DeckBinding = {
      connectionId: "c1",
      preset: {
        globalId: "vmix:x",
        kind: "vmix",
        id: "x",
        label: "X",
        steps: [{ actionId: "sc-cut", options: { input: "2" } }],
      },
    };
    const clip = bindingToClips(bareButton, 0)[0];
    expect(clip.steps[0].actionId).toBe("vmix:sc-cut");
    expect(clip.steps[0].kind).toBe("vmix");
  });
});

describe("clipToBinding (show clip → deck button)", () => {
  it("carries the clip's whole action list into the button", () => {
    const clip: TimelineClip = {
      id: "clip-1",
      offsetMs: 2000,
      label: "Combo",
      color: "#112233",
      connectionId: "c1",
      steps: [
        { actionId: "vmix:sc-cut", kind: "vmix", options: { input: "2" } },
        { actionId: "vmix:sc-fade", kind: "vmix", options: { input: "3" } },
      ],
    };
    const b = clipToBinding(clip);
    expect(b.preset.kind).toBe("vmix");
    expect(b.preset.label).toBe("Combo");
    expect(b.preset.bgcolor).toBe("#112233");
    expect(b.connectionId).toBe("c1");
    expect(b.preset.steps).toHaveLength(2);
    expect(b.preset.steps.map((s) => s.actionId)).toEqual([
      "vmix:sc-cut",
      "vmix:sc-fade",
    ]);
  });

  it("uses the catalog face + action id when the clip has no override", () => {
    const clip: TimelineClip = {
      id: "clip-2",
      offsetMs: 0,
      steps: [{ actionId: "obs:set-scene", kind: "obs", options: {} }],
    };
    expect(clipToBinding(clip).preset.label).toBe("set-scene");
    expect(
      clipToBinding(clip, { label: "Set scene", bgcolor: "#0a84ff" }).preset
        .label
    ).toBe("Set scene");
  });
});