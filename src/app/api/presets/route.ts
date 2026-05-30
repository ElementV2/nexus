import { NextResponse } from "next/server";
import { listPresets } from "@/lib/core/catalog";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Catalog of every preset registered across all device kinds. Drives
 * the preset browser page and (later) the Stream Deck editor's
 * drag-from palette.
 */
export async function GET() {
  ensureBooted();
  return NextResponse.json({
    presets: listPresets().map((e) => ({
      globalId: e.globalId,
      kind: e.kind,
      id: e.def.id,
      label: e.def.label,
      category: e.def.category,
      text: e.def.text,
      bgcolor: e.def.bgcolor,
      fgcolor: e.def.fgcolor,
      steps: e.def.steps,
    })),
  });
}
