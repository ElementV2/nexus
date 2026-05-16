import { NextRequest, NextResponse } from "next/server";
import { saveScan, getScan } from "@/lib/db/network-scans";

export const dynamic = "force-dynamic";

// POST — store scan results, return ID
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.hosts)) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    const id = saveScan(body);
    return NextResponse.json({ id });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — retrieve scan results by ID
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const data = getScan(id);
  if (!data) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
