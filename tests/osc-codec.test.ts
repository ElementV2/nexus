import { describe, expect, it } from "vitest";
import {
  decodePacket,
  encodeMessage,
  type OscArg,
} from "@/lib/ableton/osc-codec";

/** Encode a message then decode it back, returning the first message. */
function roundTrip(address: string, args: OscArg[]) {
  const buf = encodeMessage({ address, args });
  // Every OSC chunk must be 4-byte aligned on the wire.
  expect(buf.length % 4).toBe(0);
  const msgs = decodePacket(buf);
  expect(msgs).toHaveLength(1);
  return msgs[0];
}

describe("OSC codec round-trip", () => {
  it("preserves the address with no args", () => {
    const m = roundTrip("/live/song/start_playing", []);
    expect(m.address).toBe("/live/song/start_playing");
    expect(m.args).toEqual([]);
  });

  it("encodes integers as int32", () => {
    const m = roundTrip("/track", [0, 1, -1, 2147483647, -2147483648]);
    expect(m.args).toEqual([0, 1, -1, 2147483647, -2147483648]);
  });

  it("encodes non-integers as float32 (within float precision)", () => {
    const m = roundTrip("/tempo", [120.5]);
    expect(m.args[0]).toBeCloseTo(120.5, 3);
  });

  it("preserves ASCII and UTF-8 strings", () => {
    const m = roundTrip("/clip/name", ["Intro", "Café ☕"]);
    expect(m.args).toEqual(["Intro", "Café ☕"]);
  });

  it("round-trips booleans (T/F, no payload) and null (N)", () => {
    const m = roundTrip("/state", [true, false, null]);
    expect(m.args).toEqual([true, false, null]);
  });

  it("round-trips blobs byte-for-byte", () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    const m = roundTrip("/blob", [blob]);
    expect(Array.from(m.args[0] as Uint8Array)).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves mixed arg ordering", () => {
    const m = roundTrip("/mix", ["name", 7, 3.5, true]);
    expect(m.args[0]).toBe("name");
    expect(m.args[1]).toBe(7);
    expect(m.args[2]).toBeCloseTo(3.5, 3);
    expect(m.args[3]).toBe(true);
  });
});

describe("OSC encode guards", () => {
  it("throws on an unsupported argument type rather than misaligning tags", () => {
    expect(() =>
      // @ts-expect-error — deliberately passing an unsupported type
      encodeMessage({ address: "/x", args: [{ nope: true }] })
    ).toThrow(/unsupported argument type/);
  });
});

describe("OSC decode robustness", () => {
  it("returns [] for an empty buffer", () => {
    expect(decodePacket(new Uint8Array(0))).toEqual([]);
  });

  it("returns [] for a string without a null terminator (malformed)", () => {
    // 4 non-zero bytes: no terminator anywhere → readString throws → [].
    expect(decodePacket(new Uint8Array([0x2f, 0x61, 0x62, 0x63]))).toEqual([]);
  });

  it("returns [] when the address does not start with '/'", () => {
    // "abc\0" is a valid OSC-string but not a valid address.
    const buf = encodeMessage({ address: "/ok", args: [] });
    // Corrupt the leading '/' (0x2f) into 'x' (0x78).
    buf[0] = 0x78;
    expect(decodePacket(buf)).toEqual([]);
  });

  it("flattens a #bundle into its inner messages", () => {
    // Build a bundle by hand: "#bundle\0" + 8-byte timetag + sized element.
    const inner = encodeMessage({ address: "/inner", args: [42] });
    const header = encodeMessage({ address: "#bundle", args: [] }); // reuse string encoder
    // header encodes "#bundle" + ",\0\0\0" typetags (4 bytes) — we only
    // want the "#bundle\0" string (8 bytes), so slice it off.
    const tag = header.subarray(0, 8);
    const timetag = new Uint8Array(8); // immediate
    const size = new Uint8Array(4);
    new DataView(size.buffer).setInt32(0, inner.length, false);
    const packet = new Uint8Array(
      tag.length + timetag.length + size.length + inner.length
    );
    let off = 0;
    for (const part of [tag, timetag, size, inner]) {
      packet.set(part, off);
      off += part.length;
    }
    const msgs = decodePacket(packet);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].address).toBe("/inner");
    expect(msgs[0].args).toEqual([42]);
  });
});
