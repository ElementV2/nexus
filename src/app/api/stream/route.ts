import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import ffmpegStaticImport from "ffmpeg-static";
import { getPreferences } from "@/lib/db/preferences";

export const dynamic = "force-dynamic";

/**
 * FFmpeg binary path. The `ffmpeg-static` package exports the absolute
 * path of its bundled binary as the default export — we trust that
 * value and let NFT trace the .exe normally (since it's a static import
 * resolution, not a dynamic filesystem probe).
 *
 * Fallback to bare `"ffmpeg"` so the route still works in setups where
 * ffmpeg-static isn't installed (e.g. some lightweight dev sandboxes).
 */
const FFMPEG_BIN =
  (typeof ffmpegStaticImport === "string"
    ? ffmpegStaticImport
    : (ffmpegStaticImport as unknown as { default?: string })?.default) ||
  "ffmpeg";

// ---------------------------------------------------------------------------
// Singleton FFmpeg process – shared across all concurrent HTTP readers.
// FFmpeg connects to vMix's SRT listener (mode=caller), remuxes to MPEG-TS,
// and writes to stdout. Each HTTP client receives a copy of the live chunks.
// ---------------------------------------------------------------------------

interface Relay {
  proc: ChildProcess;
  key: string;
  listeners: Set<(chunk: Uint8Array) => void>;
  onEnd: Set<() => void>;
  killTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
  error: string | null;
}

let relay: Relay | null = null;

function killRelay() {
  if (!relay) return;
  relay.proc.kill("SIGTERM");
  relay.ended = true;
  for (const fn of relay.onEnd) fn();
  relay.listeners.clear();
  relay.onEnd.clear();
  if (relay.killTimer) clearTimeout(relay.killTimer);
  relay = null;
}

function scheduleKill() {
  if (!relay || relay.listeners.size > 0) return;
  relay.killTimer = setTimeout(() => {
    if (relay && relay.listeners.size === 0) killRelay();
  }, 30_000);
}

function ensureRelay(host: string, port: string): Relay {
  const key = `${host}:${port}`;

  if (relay && relay.key === key && !relay.ended) {
    if (relay.killTimer) {
      clearTimeout(relay.killTimer);
      relay.killTimer = null;
    }
    return relay;
  }

  if (relay) killRelay();

  const proc = spawn(
    FFMPEG_BIN,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      `srt://${host}:${port}?mode=caller`,
      "-c",
      "copy",
      "-f",
      "mpegts",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  const r: Relay = {
    proc,
    key,
    listeners: new Set(),
    onEnd: new Set(),
    killTimer: null,
    ended: false,
    error: null,
  };

  proc.stdout!.on("data", (buf: Buffer) => {
    const chunk = new Uint8Array(buf);
    for (const fn of r.listeners) fn(chunk);
  });

  proc.stderr!.on("data", (buf: Buffer) => {
    const msg = buf.toString().trim();
    if (msg) r.error = msg;
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    r.ended = true;
    r.error =
      err.code === "ENOENT"
        ? "FFmpeg not found."
        : `FFmpeg error: ${err.message}`;
    for (const fn of r.onEnd) fn();
    r.listeners.clear();
    r.onEnd.clear();
    if (relay === r) relay = null;
  });

  proc.on("exit", (code) => {
    r.ended = true;
    if (!r.error && code !== 0) {
      r.error = `FFmpeg exited with code ${code}`;
    }
    for (const fn of r.onEnd) fn();
    r.listeners.clear();
    r.onEnd.clear();
    if (relay === r) relay = null;
  });

  relay = r;
  return r;
}

// ---------------------------------------------------------------------------
// GET /api/stream — pulls vMix's SRT publisher (configured in preferences)
// and returns a never-ending MPEG-TS stream (video/mp2t).
// ---------------------------------------------------------------------------

export async function GET() {
  const { vmix_host: host, vmix_srt_port: srtPort } = getPreferences();
  const port = String(srtPort);

  if (isNaN(srtPort) || srtPort < 1 || srtPort > 65535) {
    return NextResponse.json({ error: "Invalid SRT port in preferences" }, { status: 400 });
  }

  const r = ensureRelay(host, port);

  // Give FFmpeg a moment to fail (e.g. ENOENT, connection refused)
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (r.ended) {
    return NextResponse.json(
      {
        error:
          r.error ||
          "FFmpeg process exited unexpectedly. Is FFmpeg installed with SRT support?",
      },
      { status: 502 }
    );
  }

  let removeFns: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const onData = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          removeFns?.();
        }
      };

      const onEnd = () => {
        try {
          controller.close();
        } catch {}
        removeFns?.();
      };

      removeFns = () => {
        r.listeners.delete(onData);
        r.onEnd.delete(onEnd);
        removeFns = null;
        scheduleKill();
      };

      r.listeners.add(onData);
      r.onEnd.add(onEnd);
    },
    cancel() {
      removeFns?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
