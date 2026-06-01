import { describe, it, expect } from "vitest";
import {
  REDACTED_SECRET,
  redactConfigSecrets,
  restoreConfigSecrets,
  redactPreferences,
  DEFAULT_PREFERENCES,
} from "@/lib/db/preferences";

/**
 * Guards the OBS/grandMA2 password hardening: the real secret must never
 * leave the server (redacted to a sentinel), and must be transparently
 * restored on save when the operator didn't change the field. A
 * regression here would either LEAK the password or silently WIPE it on
 * an unrelated edit — both bad, neither caught by tsc.
 */

describe("redactConfigSecrets", () => {
  it("masks non-empty secret fields, keeps the rest", () => {
    expect(
      redactConfigSecrets({ host: "h", port: 4455, password: "hunter2" })
    ).toEqual({ host: "h", port: 4455, password: REDACTED_SECRET });
  });

  it("leaves an empty secret empty (so 'no password' ≠ 'hidden')", () => {
    expect(redactConfigSecrets({ password: "" })).toEqual({ password: "" });
  });

  it("matches password/secret/token case-insensitively", () => {
    const out = redactConfigSecrets({
      apiToken: "t",
      Secret: "s",
      PassWord: "p",
    }) as Record<string, unknown>;
    expect(out.apiToken).toBe(REDACTED_SECRET);
    expect(out.Secret).toBe(REDACTED_SECRET);
    expect(out.PassWord).toBe(REDACTED_SECRET);
  });

  it("passes non-objects through untouched", () => {
    expect(redactConfigSecrets(null)).toBe(null);
    expect(redactConfigSecrets("x")).toBe("x");
  });

  it("does not mutate its input", () => {
    const input = { password: "real" };
    redactConfigSecrets(input);
    expect(input.password).toBe("real");
  });
});

describe("restoreConfigSecrets", () => {
  it("restores a sentinel from the previously-stored value", () => {
    expect(
      restoreConfigSecrets(
        { host: "newhost", password: REDACTED_SECRET },
        { host: "old", password: "realpass" }
      )
    ).toEqual({ host: "newhost", password: "realpass" });
  });

  it("keeps a genuinely changed password", () => {
    expect(
      restoreConfigSecrets({ password: "brandnew" }, { password: "realpass" })
    ).toEqual({ password: "brandnew" });
  });

  it("collapses a sentinel to empty when there's no prior value (creation)", () => {
    expect(restoreConfigSecrets({ password: REDACTED_SECRET }, {})).toEqual({
      password: "",
    });
  });

  it("round-trips: redact → echo back → restore yields the original secret", () => {
    const stored = { host: "h", port: 4455, password: "s3cr3t" };
    const toClient = redactConfigSecrets(stored) as Record<string, unknown>;
    // Operator edits host only; the masked password rides back unchanged.
    const echoed = { ...toClient, host: "h2" };
    expect(restoreConfigSecrets(echoed, stored)).toEqual({
      host: "h2",
      port: 4455,
      password: "s3cr3t",
    });
  });
});

describe("redactPreferences", () => {
  it("masks per-connection secrets, leaves the rest", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      connections: [
        {
          id: "a",
          kind: "obs",
          label: "OBS",
          enabled: true,
          config: { host: "h", port: 4455, password: "p1" },
        },
        {
          id: "b",
          kind: "vmix",
          label: "vMix",
          enabled: true,
          config: { host: "v", port: 8088 },
        },
      ],
    };
    const out = redactPreferences(prefs);
    expect((out.connections[0].config as Record<string, unknown>).password).toBe(
      REDACTED_SECRET
    );
    expect((out.connections[0].config as Record<string, unknown>).host).toBe("h");
    expect(out.connections[1].config).toEqual({ host: "v", port: 8088 });
    // Original object untouched (we only redact a copy for the response).
    expect((prefs.connections[0].config as Record<string, unknown>).password).toBe(
      "p1"
    );
  });

  it("leaves a connection with no password untouched", () => {
    const out = redactPreferences({
      ...DEFAULT_PREFERENCES,
      connections: [
        { id: "a", kind: "vmix", label: "vMix", enabled: true, config: { host: "v" } },
      ],
    });
    expect(out.connections[0].config).toEqual({ host: "v" });
  });
});
