import { NextRequest, NextResponse } from "next/server";
import {
  listOverlays,
  upsertOverlay,
  upsertManyOverlays,
} from "@/lib/db/overlays";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ overlays: listOverlays() });
}

// Body: a single OverlayConfig or { overlays: OverlayConfig[] } for batch upsert.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body && typeof body === "object" && Array.isArray((body as { overlays?: unknown[] }).overlays)) {
    upsertManyOverlays((body as { overlays: never[] }).overlays);
    return NextResponse.json({ ok: true });
  }
  if (body && typeof body === "object" && "id" in body) {
    upsertOverlay(body as never);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Expected an overlay or { overlays }" }, { status: 400 });
}
