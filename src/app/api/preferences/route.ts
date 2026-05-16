import { NextRequest, NextResponse } from "next/server";
import { getPreferences, setPreferences } from "@/lib/db/preferences";
import { abletonBroker } from "@/lib/ableton/osc-broker";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPreferences());
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const updated = setPreferences(body);
  // Push host/port changes into the AbletonOSC broker so the user gets
  // immediate feedback after saving — no need to wait for the 5 s poll.
  abletonBroker.refreshConfig();
  return NextResponse.json(updated);
}
