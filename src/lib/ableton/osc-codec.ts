/**
 * Minimal OSC 1.0 encoder / decoder. Supports the four argument types
 * AbletonOSC actually emits: int32 (i), float32 (f), string (s), blob (b).
 *
 * Wire format reminder:
 *   message  = address + typetags + args
 *   address  = OSC-string (null-terminated, zero-padded to multiple of 4)
 *   typetags = OSC-string starting with ","
 *   int32    = 4 bytes, big-endian
 *   float32  = 4 bytes, big-endian IEEE-754
 *   string   = bytes + null + zero-pad to multiple of 4
 *   blob     = int32 size + bytes + zero-pad to multiple of 4
 *
 * Bundles ("#bundle") aren't emitted by us, but the decoder accepts them
 * so we can correctly parse replies that AbletonOSC chooses to bundle.
 */

export type OscArg = number | string | Uint8Array | boolean | null;

export interface OscMessage {
  address: string;
  args: OscArg[];
}

const pad4 = (n: number) => (n + 3) & ~3;

// ─────────────────────── ENCODE ─────────────────────────────────

function encodeString(s: string): Uint8Array {
  // OSC strings are ASCII + null + zero-pad to multiple of 4. Non-ASCII
  // characters in clip names are encoded as UTF-8 — AbletonOSC handles
  // both directions in Python via `.encode()`, so this matches.
  const bytes = new TextEncoder().encode(s);
  const total = pad4(bytes.length + 1);
  const buf = new Uint8Array(total);
  buf.set(bytes, 0);
  return buf;
}

function encodeInt32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, n | 0, false);
  return buf;
}

function encodeFloat32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setFloat32(0, n, false);
  return buf;
}

function encodeBlob(b: Uint8Array): Uint8Array {
  const total = 4 + pad4(b.length);
  const buf = new Uint8Array(total);
  new DataView(buf.buffer).setInt32(0, b.length, false);
  buf.set(b, 4);
  return buf;
}

/** Concat helper that allocates exactly once. */
function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Encode a single OSC message. The type tag for each arg is inferred:
 *   number → int32 if `Number.isInteger`, else float32
 *   string → string
 *   Uint8Array → blob
 *   boolean → 'T'/'F' (no payload — OSC 1.1 spec, supported by AbletonOSC)
 *
 * If you need to force a specific numeric type, wrap in `{ type: 'f', value }`.
 */
export function encodeMessage(msg: OscMessage): Uint8Array {
  const tags = [","];
  const argBufs: Uint8Array[] = [];

  for (const arg of msg.args) {
    if (typeof arg === "number") {
      if (Number.isInteger(arg)) {
        tags.push("i");
        argBufs.push(encodeInt32(arg));
      } else {
        tags.push("f");
        argBufs.push(encodeFloat32(arg));
      }
    } else if (typeof arg === "string") {
      tags.push("s");
      argBufs.push(encodeString(arg));
    } else if (arg instanceof Uint8Array) {
      tags.push("b");
      argBufs.push(encodeBlob(arg));
    } else if (typeof arg === "boolean") {
      tags.push(arg ? "T" : "F");
      // no payload
    } else if (arg === null) {
      tags.push("N");
      // no payload
    } else {
      // Silently dropping unsupported types would emit a packet whose
      // type-tag count mismatches the payload — AbletonOSC then errors
      // and we'd have no idea why. Fail loud at the call site instead.
      throw new Error(
        `encodeMessage: unsupported argument type ${typeof arg} for ${msg.address}`
      );
    }
  }

  return concat([encodeString(msg.address), encodeString(tags.join("")), ...argBufs]);
}

// ─────────────────────── DECODE ─────────────────────────────────

class Reader {
  view: DataView;
  off = 0;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  rem() {
    return this.buf.length - this.off;
  }
  readInt32(): number {
    const v = this.view.getInt32(this.off, false);
    this.off += 4;
    return v;
  }
  readFloat32(): number {
    const v = this.view.getFloat32(this.off, false);
    this.off += 4;
    return v;
  }
  readDouble(): number {
    const v = this.view.getFloat64(this.off, false);
    this.off += 8;
    return v;
  }
  readString(): string {
    // Scan for null terminator, decode the slice up to it, advance to
    // the next 4-byte boundary. If we run off the end of the packet
    // without seeing a null, the input is malformed — throw so the
    // outer try/catch in decodePacket bails the whole packet.
    const start = this.off;
    let end = start;
    while (end < this.buf.length && this.buf[end] !== 0) end++;
    if (end >= this.buf.length) {
      throw new Error("OSC string without null terminator");
    }
    const s = new TextDecoder().decode(this.buf.subarray(start, end));
    const len = end - start + 1;
    const next = start + pad4(len);
    if (next > this.buf.length) {
      throw new Error("OSC string padding extends past buffer");
    }
    this.off = next;
    return s;
  }
  readBlob(): Uint8Array {
    const len = this.readInt32();
    if (len < 0 || len > this.rem()) {
      throw new Error("OSC blob length out of range");
    }
    const data = this.buf.subarray(this.off, this.off + len);
    this.off += pad4(len);
    return data;
  }
}

/** Maximum bundle nesting we'll decode before bailing — guards against
 *  pathological / malicious peers that send self-referential or deeply
 *  nested bundles. Plenty for any legitimate use. */
const MAX_BUNDLE_DEPTH = 4;

/**
 * Decode a UDP packet into one or more messages. Bundles are flattened.
 * Returns an empty array on malformed input rather than throwing — a
 * single bad packet shouldn't crash the broker.
 */
export function decodePacket(buf: Uint8Array): OscMessage[] {
  try {
    const r = new Reader(buf);
    return decodeFromReader(r, 0);
  } catch {
    return [];
  }
}

function decodeFromReader(r: Reader, depth: number): OscMessage[] {
  if (r.buf[r.off] === 0x23 /* # */) {
    if (depth >= MAX_BUNDLE_DEPTH) return [];
    // "#bundle"
    const tag = r.readString();
    if (tag !== "#bundle") return [];
    r.readDouble(); // timetag — ignored, we don't schedule
    const out: OscMessage[] = [];
    while (r.rem() >= 4) {
      const size = r.readInt32();
      if (size <= 0 || size > r.rem()) break;
      const inner = new Reader(r.buf.subarray(r.off, r.off + size));
      r.off += size;
      out.push(...decodeFromReader(inner, depth + 1));
    }
    return out;
  }

  // Single message
  const address = r.readString();
  if (!address.startsWith("/")) return [];

  let tags = "";
  if (r.rem() > 0 && r.buf[r.off] === 0x2c /* , */) {
    tags = r.readString().slice(1);
  }

  const args: OscArg[] = [];
  for (const t of tags) {
    switch (t) {
      case "i":
        args.push(r.readInt32());
        break;
      case "f":
        args.push(r.readFloat32());
        break;
      case "d":
        args.push(r.readDouble());
        break;
      case "s":
      case "S":
        args.push(r.readString());
        break;
      case "b":
        args.push(r.readBlob());
        break;
      case "T":
        args.push(true);
        break;
      case "F":
        args.push(false);
        break;
      case "N":
        args.push(null);
        break;
      case "I":
        args.push(Infinity);
        break;
      default:
        // Unknown tag — bail rather than misalign the rest of the args.
        return [{ address, args }];
    }
  }

  return [{ address, args }];
}
