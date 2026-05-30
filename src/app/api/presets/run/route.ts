import { NextRequest, NextResponse } from "next/server";
import { runPreset } from "@/lib/core/catalog";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Fire a preset by its global id (`<kind>:<id>`). Runs every step
 * sequentially and stops at the first failure — the response carries
 * per-step results so the UI can pinpoint which step broke.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  let body: { globalId?: unknown; connectionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.globalId !== "string" || !body.globalId) {
    return NextResponse.json({ error: "globalId required" }, { status: 400 });
  }
  const cid =
    typeof body.connectionId === "string" ? body.connectionId : undefined;
  const result = await runPreset(body.globalId, cid);
  const anyFailed = result.results.some((r) => !r.ok);
  return NextResponse.json(result, { status: anyFailed ? 502 : 200 });
}
