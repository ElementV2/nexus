import { NextRequest, NextResponse } from "next/server";
import { abletonBroker } from "@/lib/ableton/osc-broker";

export const dynamic = "force-dynamic";

type CommandBody =
  | { action: "fire-clip"; track: number; scene: number }
  | { action: "stop-track"; track: number }
  | { action: "stop-all" }
  | { action: "play" }
  | { action: "stop" }
  | { action: "continue" }
  | { action: "tap-tempo" }
  | { action: "set-tempo"; bpm: number }
  | { action: "set-metronome"; on: boolean }
  | { action: "refresh-snapshot" }
  | {
      action: "raw";
      address: string;
      args?: (number | string | boolean | null)[];
    };

export async function POST(request: NextRequest) {
  let body: CommandBody;
  try {
    body = (await request.json()) as CommandBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let ok = false;
  switch (body.action) {
    case "fire-clip":
      ok = abletonBroker.fireClip(body.track, body.scene);
      break;
    case "stop-track":
      ok = abletonBroker.stopTrack(body.track);
      break;
    case "stop-all":
      ok = abletonBroker.stopAll();
      break;
    case "play":
      ok = abletonBroker.play();
      break;
    case "stop":
      ok = abletonBroker.stopSong();
      break;
    case "continue":
      ok = abletonBroker.continueSong();
      break;
    case "tap-tempo":
      ok = abletonBroker.tap();
      break;
    case "set-tempo":
      if (!Number.isFinite(body.bpm) || body.bpm <= 0 || body.bpm > 999) {
        return NextResponse.json({ error: "Bad BPM" }, { status: 400 });
      }
      ok = abletonBroker.setTempo(body.bpm);
      break;
    case "set-metronome":
      ok = abletonBroker.toggleMetronome(Boolean(body.on));
      break;
    case "refresh-snapshot":
      ok = abletonBroker.refreshSnapshot();
      break;
    case "raw":
      if (typeof body.address !== "string" || !body.address.startsWith("/")) {
        return NextResponse.json({ error: "Bad address" }, { status: 400 });
      }
      ok = abletonBroker.sendRaw(body.address, body.args ?? []);
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!ok) {
    return NextResponse.json(
      { error: "OSC send failed (socket not ready?)" },
      { status: 503 }
    );
  }
  return NextResponse.json({ success: true });
}
