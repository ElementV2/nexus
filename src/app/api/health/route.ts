import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Cheap liveness probe for the browser's server-status heartbeat. No
 * `ensureBooted`, no device work — just proves the Next server is up and
 * answering, so the UI can show a "server down / reconnecting" overlay the
 * instant it stops responding (a crash, a restart, the launcher killing it).
 */
export function GET() {
  return NextResponse.json({ ok: true });
}
