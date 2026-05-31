import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodeMessage } from "@/lib/ableton/osc-codec";
import type { OscUdpSpec } from "@/lib/osc/udp-broker";

/**
 * Unit tests for the shared OSC-over-UDP broker (used by X32 + grandMA3).
 * Stubs `node:dgram` with a controllable fake socket and drives the
 * heartbeat/stale state machine with fake timers — the trickiest
 * previously-untested logic, and the one that drives the connection
 * status operators rely on.
 */

const h = vi.hoisted(() => {
  class FakeSocket {
    handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    closed = false;
    on(ev: string, cb: (...a: unknown[]) => void) {
      (this.handlers[ev] ??= []).push(cb);
      return this;
    }
    bind() {
      /* emulate async bind success */
      queueMicrotask(() => this.emit("listening"));
    }
    send(
      _buf: unknown,
      _port: unknown,
      _host: unknown,
      cb?: (e: Error | null) => void
    ) {
      if (typeof cb === "function") cb(null);
    }
    close() {
      this.closed = true;
    }
    emit(ev: string, ...args: unknown[]) {
      (this.handlers[ev] ?? []).forEach((fn) => fn(...args));
    }
  }
  const sockets: FakeSocket[] = [];
  return { FakeSocket, sockets };
});

vi.mock("node:dgram", () => ({
  createSocket: () => {
    const s = new h.FakeSocket();
    h.sockets.push(s);
    return s;
  },
}));

const { OscUdpBroker } = await import("@/lib/osc/udp-broker");

const REPLY = encodeMessage({ address: "/info", args: [] });

const x32Spec: OscUdpSpec = {
  tag: "test-x32",
  ping: { messages: [{ address: "/info", args: [] }], intervalMs: 5_000 },
  staleMs: 11_000,
  socketRetryMs: 2_000,
  testMode: "info",
};

const maSpec: OscUdpSpec = {
  tag: "test-ma",
  ping: { messages: [{ address: "/cmd", args: [] }], intervalMs: 3_000 },
  connectedOnOpen: true,
  testMode: "ping",
};

beforeEach(() => {
  h.sockets.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OscUdpBroker status state machine", () => {
  it("is offline before any subscriber", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 9000 }, x32Spec);
    expect(b.getStatus()).toBe("offline");
    expect(h.sockets.length).toBe(0);
  });

  it("goes connecting on subscribe, connected on first inbound packet", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 9000 }, x32Spec);
    b.subscribe(() => {});
    expect(h.sockets.length).toBe(1);
    expect(b.getStatus()).toBe("connecting");

    h.sockets[0].emit("message", REPLY);
    expect(b.getStatus()).toBe("connected");
    b.dispose();
  });

  it("connectedOnOpen specs (grandMA) report connected immediately", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 8000 }, maSpec);
    b.subscribe(() => {});
    expect(b.getStatus()).toBe("connected");
    b.dispose();
  });

  it("flips back to connecting when no reply arrives within staleMs", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 9000 }, x32Spec);
    b.subscribe(() => {});
    h.sockets[0].emit("message", REPLY);
    expect(b.getStatus()).toBe("connected");

    // No further packets; the stale check runs on each ping tick (5s), so
    // the first tick where >staleMs(11s) has elapsed is at 15s → advance
    // past it.
    vi.advanceTimersByTime(16_000);
    expect(b.getStatus()).toBe("connecting");
    b.dispose();
  });

  it("recovers from a socket error by rebuilding the socket (regression: stuck-dead-socket)", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 9000 }, x32Spec);
    b.subscribe(() => {});
    h.sockets[0].emit("message", REPLY);
    expect(b.getStatus()).toBe("connected");

    const before = h.sockets.length;
    h.sockets[before - 1].emit("error", new Error("EIO"));
    // Error must drop "connected" AND let the socket be rebuilt.
    expect(b.getStatus()).toBe("connecting");

    // The socketRetry timer (2s) fires → ensureSocket builds a NEW socket
    // (the old one was nulled). Before the fix it stayed stuck on the dead
    // socket and never created another.
    vi.advanceTimersByTime(2_100);
    expect(h.sockets.length).toBe(before + 1);
    b.dispose();
  });

  it("dispose closes the socket and returns to offline", () => {
    const b = new OscUdpBroker({ host: "1.2.3.4", port: 9000 }, x32Spec);
    b.subscribe(() => {});
    const sock = h.sockets[0];
    b.dispose();
    expect(b.getStatus()).toBe("offline");
    expect(sock.closed).toBe(true);
  });
});
