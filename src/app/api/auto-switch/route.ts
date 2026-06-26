import { NextRequest, NextResponse } from "next/server";
import { ensureBooted } from "@/lib/core/boot";
import { autoSwitchEngine } from "@/lib/auto-switch/engine";
import { applyPreset } from "@/lib/auto-switch/types";

export const dynamic = "force-dynamic";

/** Current config + live engine state. */
export async function GET() {
  ensureBooted();
  autoSwitchEngine.init();
  return NextResponse.json({
    ok: true,
    config: autoSwitchEngine.getConfig(),
    state: autoSwitchEngine.getState(),
  });
}

/**
 * Save the full config. Body is an `AutoSwitchConfig` (sanitized server-side).
 * The engine persists it, then starts/stops/retunes to match.
 */
export async function PUT(req: NextRequest) {
  ensureBooted();
  autoSwitchEngine.init();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a config object" }, { status: 400 });
  }
  // The settings modal must never flip the on/off state — only the AUTO toggle
  // (POST enable/disable) owns `enabled`. Preserving it here also closes a race
  // where a stale `enabled` in a debounced save could re-enable a just-toggled-
  // off engine.
  const merged = { ...(body as Record<string, unknown>), enabled: autoSwitchEngine.getConfig().enabled };
  const config = autoSwitchEngine.setConfig(merged);
  return NextResponse.json({ ok: true, config, state: autoSwitchEngine.getState() });
}

/**
 * Quick actions. Body: `{ action: "enable" | "disable" | "toggle" | "preset",
 * preset? }`. `enable`/`disable`/`toggle` flip the on-air switch; `preset`
 * applies a tuning bundle to the saved config.
 */
export async function POST(req: NextRequest) {
  ensureBooted();
  autoSwitchEngine.init();
  let body: { action?: string; preset?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  switch (body.action) {
    case "enable":
      autoSwitchEngine.setEnabled(true);
      break;
    case "disable":
      autoSwitchEngine.setEnabled(false);
      break;
    case "toggle":
      autoSwitchEngine.setEnabled(!autoSwitchEngine.getConfig().enabled);
      break;
    case "preset": {
      const p = body.preset;
      if (p !== "calm" && p !== "standard" && p !== "reactive" && p !== "custom") {
        return NextResponse.json({ error: `Unknown preset "${p}"` }, { status: 400 });
      }
      autoSwitchEngine.setConfig(applyPreset(autoSwitchEngine.getConfig(), p));
      break;
    }
    default:
      return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    config: autoSwitchEngine.getConfig(),
    state: autoSwitchEngine.getState(),
  });
}
