import { NextRequest, NextResponse } from "next/server";
import { getOverlayByName } from "@/lib/db/overlays";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const overlay = getOverlayByName(decoded);
  if (!overlay) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(overlay);
}
