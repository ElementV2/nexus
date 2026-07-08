import { describe, expect, it } from "vitest";
import { sanitizeConfig } from "@/lib/db/auto-switch";
import { defaultConfig } from "@/lib/auto-switch/types";

const K1 = "a1b2c3d4-0000-0000-0000-000000000001";
const K2 = "a1b2c3d4-0000-0000-0000-000000000002";

describe("auto-switch config sanitize", () => {
  it("returns the default (disabled) config for junk input", () => {
    expect(sanitizeConfig(null)).toEqual(defaultConfig());
    expect(sanitizeConfig(undefined)).toEqual(defaultConfig());
    expect(sanitizeConfig("nope")).toEqual(defaultConfig());
    expect(sanitizeConfig(42)).toEqual(defaultConfig());
    expect(sanitizeConfig({}).enabled).toBe(false);
  });

  it("migrates the oldest single `audioInput` number to a keyless mic ref", () => {
    const c = sanitizeConfig({ cameras: [{ input: 3, audioInput: 7 }] });
    expect(c.cameras).toEqual([
      {
        key: "",
        input: 3,
        label: undefined,
        mics: [{ key: "", input: 7, label: undefined }],
        enabled: true,
      },
    ]);
  });

  it("migrates the legacy `audioInputs` number array to mic refs (deduped)", () => {
    const c = sanitizeConfig({ cameras: [{ input: 2, audioInputs: [4, 4, 5] }] });
    expect(c.cameras[0].mics).toEqual([
      { key: "", input: 4, label: undefined },
      { key: "", input: 5, label: undefined },
    ]);
  });

  it("defaults a camera's mic to itself when no mic field is given", () => {
    const c = sanitizeConfig({ cameras: [{ key: K1, input: 5, label: "Cam" }] });
    expect(c.cameras[0].mics).toEqual([{ key: K1, input: 5, label: "Cam" }]);
  });

  it("keeps an explicitly emptied mic list (a pure visual camera)", () => {
    expect(sanitizeConfig({ cameras: [{ input: 5, mics: [] }] }).cameras[0].mics).toEqual([]);
    // Legacy empty list too.
    expect(
      sanitizeConfig({ cameras: [{ input: 5, audioInputs: [] }] }).cameras[0].mics
    ).toEqual([]);
  });

  it("dedups mics within a camera and cameras by their stable id", () => {
    const c = sanitizeConfig({
      cameras: [
        { key: K1, input: 2, mics: [{ key: K2, input: 4 }, { key: K2, input: 9 }] },
        { key: K1, input: 7 }, // same GUID → duplicate camera, dropped
        { input: 2 }, // keyless → id n2, NOT a duplicate of the K1 camera
      ],
    });
    expect(c.cameras).toHaveLength(2);
    expect(c.cameras[0].mics).toEqual([{ key: K2, input: 4, label: undefined }]);
    expect(c.cameras[1]).toMatchObject({ key: "", input: 2 });
  });

  it("skips malformed camera entries (non-object / no key and no valid input)", () => {
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

  it("accepts a valid full v2 config round-trip unchanged", () => {
    const valid = sanitizeConfig({
      enabled: true,
      preset: "reactive",
      transition: { type: "Merge", durationMs: 250 },
      cameras: [
        {
          key: K1,
          input: 1,
          label: "Wide",
          mics: [
            { key: K1, input: 1, label: "Wide" },
            { key: K2, input: 2, label: "Mic B" },
          ],
          enabled: false,
        },
      ],
      manualHold: true,
    });
    expect(valid.enabled).toBe(true);
    expect(valid.preset).toBe("reactive");
    expect(valid.transition).toEqual({ type: "Merge", durationMs: 250 });
    expect(valid.cameras[0]).toEqual({
      key: K1,
      input: 1,
      label: "Wide",
      mics: [
        { key: K1, input: 1, label: "Wide" },
        { key: K2, input: 2, label: "Mic B" },
      ],
      enabled: false,
    });
    expect(valid.manualHold).toBe(true);
    // sanitize is idempotent
    expect(sanitizeConfig(valid)).toEqual(valid);
  });
});
