import { NextRequest, NextResponse } from "next/server";
import { getPreferences } from "@/lib/db/preferences";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 1500;

/**
 * One-shot connection probe for the vMix host. Mirrors
 * /api/ableton/test in shape: short timeout, returns version on
 * success. The body may override the saved host/port so the user can
 * validate values before saving them.
 */
export async function POST(request: NextRequest) {
  let body: { host?: string; port?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is OK */
  }

  const prefs = getPreferences();
  const host = (body.host ?? prefs.vmix_host).trim();
  const port = body.port ?? prefs.vmix_port;

  if (!host) {
    return NextResponse.json(
      { ok: false, error: "Host is empty" },
      { status: 200 }
    );
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`http://${host}:${port}/api/`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `HTTP ${res.status}`,
      });
    }
    const xml = await res.text();
    // Cheap parse — we only need version + edition for the readout.
    const version = xml.match(/<version>([^<]+)<\/version>/i)?.[1]?.trim();
    const edition = xml.match(/<edition>([^<]+)<\/edition>/i)?.[1]?.trim();
    if (!version) {
      return NextResponse.json({
        ok: false,
        error: "Reply didn't look like vMix XML",
      });
    }
    return NextResponse.json({ ok: true, version, edition });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return NextResponse.json({
      ok: false,
      error: msg.includes("aborted") ? "Timed out" : msg,
    });
  }
}
