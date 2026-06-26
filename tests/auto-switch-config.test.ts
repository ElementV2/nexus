import { describe, expect, it } from "vitest";
import { sanitizeConfig } from "@/lib/db/auto-switch";
import { defaultConfig } from "@/lib/auto-switch/types";

describe("auto-switch config sanitize", () => {
  it("returns the default (disabled) config for junk input", () => {
    expect(sanitizeConfig(null)).toEqual(defaultConfig());
    expect(sanitizeConfig(undefined)).toEqual(defaultConfig());
    expect(sanitizeConfig("nope")).toEqual(defaultConfig());
    expect(sanitizeConfig(42)).toEqual(defaultConfig());
    expect(sanitizeConfig({}).enabled).toBe(false);
  });

  it("migrates the legacy single `audioInput` to an array", () => {
    const c = sanitizeConfig({ cameras: [{ input: 3, audioInput: 7 }] });
    expect(c.cameras).toEqual([{ input: 3, audioInputs: [7], enabled: true, label: undefined }]);
  });

  it("defaults a camera's mic to its own input when no audio field is given", () => {
    const c = sanitizeConfig({ cameras: [{ input: 5 }] });
    expect(c.cameras[0].audioInputs).toEqual([5]);
  });

  it("keeps an explicitly emptied mic list (a pure visual camera)", () => {
    const c = sanitizeConfig({ cameras: [{ input: 5, audioInputs: [] }] });
    expect(c.cameras[0].audioInputs).toEqual([]);
  });

  it("dedups mics within a camera and dedups cameras by input", () => {
    const c = sanitizeConfig({
      cameras: [
        { input: 2, audioInputs: [4, 4, 5] },
        { input: 2, audioInputs: [9] }, // duplicate camera input → dropped
      ],
    });
    expect(c.cameras).toHaveLength(1);
    expect(c.cameras[0].audioInputs).toEqual([4, 5]);
  });

  it("skips malformed camera entries (non-object / missing-or-bad input)", () => {
    const c = sanitizeConfig({
      cameras: [null, 7, { foo: 1 }, { input: 0 }, { input: -3 }, { input: 6 }],
    });
    expect(c.cameras.map((cam) => cam.input)).toEqual([6]);
  });

  it("clamps out-of-range numbers and rejects NaN", () => {
    const c = sanitizeConfig({
      timing: { minOnCamMs: 9_999_999, reactionHoldMs: -100 },
      transition: { durationMs: "abc" },
      manualOverrideMs: 999_999,
    });
    expect(c.timing.minOnCamMs).toBe(120_000); // clamped to max
    expect(c.timing.reactionHoldMs).toBe(0); // clamped to min
    expect(c.transition.durationMs).toBe(defaultConfig().transition.durationMs); // NaN → default
    expect(c.manualOverrideMs).toBe(60_000); // clamped to max
  });

  it("falls back to defaults for an unknown transition type or preset", () => {
    const c = sanitizeConfig({ transition: { type: "Bogus" }, preset: "wat" });
    expect(c.transition.type).toBe(defaultConfig().transition.type);
    expect(c.preset).toBe(defaultConfig().preset);
  });

  it("accepts a valid full config round-trip unchanged", () => {
    const valid = sanitizeConfig({
      enabled: true,
      preset: "reactive",
      transition: { type: "Merge", durationMs: 250 },
      cameras: [{ input: 1, audioInputs: [1, 2], enabled: false, label: "Wide" }],
      manualHold: true,
    });
    expect(valid.enabled).toBe(true);
    expect(valid.preset).toBe("reactive");
    expect(valid.transition).toEqual({ type: "Merge", durationMs: 250 });
    expect(valid.cameras[0]).toEqual({ input: 1, audioInputs: [1, 2], enabled: false, label: "Wide" });
    expect(valid.manualHold).toBe(true);
    // sanitize is idempotent
    expect(sanitizeConfig(valid)).toEqual(valid);
  });
});
