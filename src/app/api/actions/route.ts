import { NextResponse } from "next/server";
import { listActions, listVariables } from "@/lib/core/catalog";
import { ensureBooted } from "@/lib/core/boot";

export const dynamic = "force-dynamic";

/**
 * Catalog of every action and variable registered across all device
 * kinds. Single endpoint so the action editor / preset editor / surface
 * configurator only have to fetch once and filter client-side by kind.
 * (Stream Deck feedback is imperative per-kind, not declared here.)
 *
 * Notes:
 *   • `toCommand` is stripped — it's a function and can't cross JSON.
 *     The editor just needs the option schema; execution always goes
 *     through `/api/actions/run` which has the function on hand.
 */
export async function GET() {
  ensureBooted();
  return NextResponse.json({
    actions: listActions().map((e) => ({
      globalId: e.globalId,
      kind: e.kind,
      id: e.def.id,
      label: e.def.label,
      description: e.def.description,
      category: e.def.category,
      bgcolor: e.def.bgcolor,
      fgcolor: e.def.fgcolor,
      options: e.def.options ?? [],
    })),
    variables: listVariables().map((e) => ({
      globalId: e.globalId,
      kind: e.kind,
      id: e.def.id,
      label: e.def.label,
      description: e.def.description,
      hint: e.def.hint,
    })),
  });
}
