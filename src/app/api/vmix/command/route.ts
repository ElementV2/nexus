import { NextRequest, NextResponse } from "next/server";
import { getPreferences } from "@/lib/db/preferences";
import { COMMAND_FETCH_TIMEOUT_MS } from "@/lib/vmix/constants";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    Function: fn,
    Input,
    Value,
    Mix,
    Duration,
    SelectedIndex,
    SelectedName,
  } = body as Record<string, unknown>;

  if (!fn) {
    return NextResponse.json({ error: "Missing Function" }, { status: 400 });
  }

  const { vmix_host: host, vmix_port: port } = getPreferences();

  const params = new URLSearchParams({ Function: String(fn) });
  if (Input !== undefined) params.set("Input", String(Input));
  if (Value !== undefined) params.set("Value", String(Value));
  if (Mix !== undefined) params.set("Mix", String(Mix));
  if (Duration !== undefined) params.set("Duration", String(Duration));
  if (SelectedIndex !== undefined) params.set("SelectedIndex", String(SelectedIndex));
  if (SelectedName !== undefined) params.set("SelectedName", String(SelectedName));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      COMMAND_FETCH_TIMEOUT_MS
    );

    const res = await fetch(
      `http://${host}:${port}/api/?${params.toString()}`,
      {
        signal: controller.signal,
        cache: "no-store",
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `vMix returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Command failed: ${message}` },
      { status: 502 }
    );
  }
}
