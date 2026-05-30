import { NextRequest, NextResponse } from "next/server";
import {
  DECK_GEOMETRIES,
  getStreamdeckStore,
  normalizeLayout,
  removeLayout,
  upsertLayout,
  type DeckLayout,
} from "@/lib/db/streamdeck";

export const dynamic = "force-dynamic";

/**
 * List every persisted Stream Deck layout plus the geometry table the
 * editor needs to render any model. One round-trip on page load.
 */
export async function GET() {
  const store = getStreamdeckStore();
  return NextResponse.json({
    layouts: store.layouts,
    geometries: DECK_GEOMETRIES,
  });
}

/**
 * Upsert a layout. Body: `{ layout: DeckLayout }`. The whole layout
 * is replaced — partial updates (e.g. single binding) ride through
 * the editor by sending the full object back.
 */
export async function PUT(req: NextRequest) {
  let body: { layout?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const l = body.layout as DeckLayout | undefined;
  if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id) {
    return NextResponse.json({ error: "layout.id required" }, { status: 400 });
  }
  if (!(l.model in DECK_GEOMETRIES)) {
    return NextResponse.json(
      { error: `Unknown deck model "${l.model}"` },
      { status: 400 }
    );
  }
  // normalizeLayout coerces pairing into `deviceSerials: string[]` and
  // migrates a legacy single `deviceSerial` from older clients.
  const cleaned = normalizeLayout({
    id: l.id,
    model: l.model,
    label: typeof l.label === "string" && l.label.trim() ? l.label : l.id,
    deviceSerials: Array.isArray(l.deviceSerials) ? l.deviceSerials : [],
    deviceSerial: (l as { deviceSerial?: string }).deviceSerial,
    bindings:
      l.bindings && typeof l.bindings === "object"
        ? (l.bindings as DeckLayout["bindings"])
        : {},
  } as DeckLayout);
  const next = upsertLayout(cleaned);

  // The binding may have changed which input/scene/etc a key targets, which
  // changes its FEEDBACK (tally colour, overlay state…). The editor's live
  // key-push only sends the static face — the feedback override is applied
  // by the coordinator, which otherwise only re-renders on a variable
  // change. So nudge it here too, or a paired deck shows stale colours until
  // the next tally tick (or a manual press). Fire-and-forget + debounced.
  void import("@/lib/streamdeck/feedback-coordinator")
    .then((m) => m.feedbackCoordinator.refresh())
    .catch(() => {
      /* coordinator not booted / no devices — nothing to push */
    });

  return NextResponse.json({ ok: true, store: next });
}

/**
 * Delete a layout. The id comes from the query string so a single
 * route covers it without needing a nested `[id]` segment — the
 * editor's UI is the only consumer.
 *
 * Refuses to delete the last layout. Caller should handle the 409
 * by showing a "clear bindings instead" hint, mirroring the editor's
 * client-side guard.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const store = getStreamdeckStore();
  if (store.layouts.length <= 1) {
    return NextResponse.json(
      { error: "Can't delete the last layout" },
      { status: 409 }
    );
  }
  if (!store.layouts.some((l) => l.id === id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const next = removeLayout(id);
  return NextResponse.json({ ok: true, store: next });
}
