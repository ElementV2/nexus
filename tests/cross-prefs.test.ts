import { describe, expect, it } from "vitest";
import { localAddresses, normalizeServerUrl } from "../nexus-cross/src/prefs";

/**
 * normalizeServerUrl turns whatever an operator types in the Nexus Cross
 * window into a base URL undici can build requests from: it adds a scheme
 * when missing, defaults the port to 9088, and reduces to the bare origin.
 */
describe("normalizeServerUrl", () => {
  it("keeps empty / whitespace input empty (HID-only mode)", () => {
    expect(normalizeServerUrl("")).toBe("");
    expect(normalizeServerUrl("   ")).toBe("");
    // @ts-expect-error — guards against undefined slipping through
    expect(normalizeServerUrl(undefined)).toBe("");
  });

  it("adds http:// and the default :9088 to a bare IP", () => {
    expect(normalizeServerUrl("192.168.1.17")).toBe("http://192.168.1.17:9088");
  });

  it("respects an explicit port", () => {
    expect(normalizeServerUrl("192.168.1.17:8080")).toBe(
      "http://192.168.1.17:8080"
    );
  });

  it("keeps an explicit scheme and lowercases it", () => {
    expect(normalizeServerUrl("HTTP://10.0.0.10")).toBe("http://10.0.0.10:9088");
  });

  it("defaults the port for a portless host but respects an explicit one", () => {
    // No explicit port → Nexus's default 9088, even under https.
    expect(normalizeServerUrl("https://nexus.local")).toBe(
      "https://nexus.local:9088"
    );
    // Explicit :443 is honoured; the origin drops the default-https port
    // but the request still targets 443 (the reverse-proxy use-case).
    expect(normalizeServerUrl("https://nexus.local:443")).toBe(
      "https://nexus.local"
    );
    // Explicit non-default port is preserved verbatim.
    expect(normalizeServerUrl("https://nexus.local:8443")).toBe(
      "https://nexus.local:8443"
    );
  });

  it("strips path, query and trailing slashes down to the origin", () => {
    expect(normalizeServerUrl("http://10.0.0.10:9088/")).toBe(
      "http://10.0.0.10:9088"
    );
    expect(normalizeServerUrl("http://10.0.0.10:9088/api/x?y=1")).toBe(
      "http://10.0.0.10:9088"
    );
  });

  it("falls back to the with-scheme string when the URL cannot be parsed", () => {
    // Spaces make this unparseable; we return it rather than throwing so
    // the failure surfaces at fetch time with a clear message.
    expect(normalizeServerUrl("not a host")).toBe("http://not a host");
  });
});

/**
 * localAddresses lists every IPv4 that routes back to this machine — what
 * the satellite probes for a local Nexus server. Loopback is always
 * present; the interface IPs are environment-dependent (not asserted).
 */
describe("localAddresses", () => {
  it("always includes loopback and returns unique IPv4 strings", () => {
    const addrs = localAddresses();
    expect(addrs).toContain("127.0.0.1");
    expect(new Set(addrs).size).toBe(addrs.length);
    for (const a of addrs) expect(a).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });
});
