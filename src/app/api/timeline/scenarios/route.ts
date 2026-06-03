import { NextRequest, NextResponse } from "next/server";
import {
  getTimelineStore,
  normalizeScenario,
  removeScenario,
  upsertScenario,
  type Scenario,
} from "@/lib/db/timeline";

export const dynamic = "force-dynamic";

/**
 * List every persisted timeline scenario. One round-trip on page load —
 * the left rail and the editor both read from this.
 */
export async function GET() {
  const store = getTimelineStore();
  return NextResponse.json({ scenarios: store.scenarios });
}

/**
 * Upsert a scenario. Body: `{ scenario: Scenario }`. The whole scenario
 * is replaced — the editor sends the full object back on every change
 * (debounced), mirroring the Stream Deck layout save.
 */
export async function PUT(req: NextRequest) {
  let body: { scenario?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const s = body.scenario as Scenario | undefined;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.id) {
    return NextResponse.json({ error: "scenario.id required" }, { status: 400 });
  }
  const next = upsertScenario(normalizeScenario(s));
  return NextResponse.json({ ok: true, store: { scenarios: next.scenarios } });
}

/**
 * Delete a scenario by `?id=`. Refuses to remove the last one (the editor
 * always needs somewhere to work), mirroring the layout delete guard.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const store = getTimelineStore();
  if (store.scenarios.length <= 1) {
    return NextResponse.json(
      { error: "Can't delete the last scenario" },
      { status: 409 }
    );
  }
  if (!store.scenarios.some((s) => s.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const next = removeScenario(id);
  return NextResponse.json({ ok: true, store: { scenarios: next.scenarios } });
}
