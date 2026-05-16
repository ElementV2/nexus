import { NextRequest, NextResponse } from "next/server";
import { deleteOverlay } from "@/lib/db/overlays";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  deleteOverlay(id);
  return NextResponse.json({ ok: true });
}
