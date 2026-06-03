import { NextRequest, NextResponse } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";
import { geometryForModel, getStreamdeckStore } from "@/lib/db/streamdeck";

export const dynamic = "force-dynamic";

/**
 * Render a layout (or a single key) to whatever physical device it's
 * paired with. Body forms, in priority order:
 *
 *   • `{ layoutId, keyIndex, binding }` — single-key live update.
 *     The editor uses this on every drag/edit so the deck reflects
 *     the change BEFORE the debounced save lands on disk. `binding`
 *     can be `null` to clear the key.
 *
 *   • `{ layoutId, keyIndex }` — same but reads the binding from
 *     the persisted store. Useful for replays / re-renders.
 *
 *   • `{ layoutId }` — render every binding of a saved layout.
 *
 *   • `{ devicePath, brightness }` — adjust brightness only.
 *   • `{ devicePath, clear: true }` — blank the panel.
 *
 * Returns 404 if the layout isn't paired to a connected device.
 */
export async function POST(req: NextRequest) {
  let body: {
    devicePath?: unknown;
    layoutId?: unknown;
    keyIndex?: unknown;
    binding?: unknown;
    brightness?: unknown;
    clear?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = await streamdeckDriver.status();
  if (status.state !== "ready") {
    return NextResponse.json(
      {
        ok: false,
        status,
        error:
          status.state === "deps-missing" ? status.reason : "Driver not ready",
      },
      { status: 503 }
    );
  }

  // Resolve target devicePaths: either a single explicit path, or EVERY
  // connected deck the layout is paired with (one layout can drive many).
  const explicitPath =
    typeof body.devicePath === "string" ? body.devicePath : null;
  const layoutId = typeof body.layoutId === "string" ? body.layoutId : null;
  const store = getStreamdeckStore();
  const layout = layoutId
    ? store.layouts.find((l) => l.id === layoutId)
    : undefined;

  let devicePaths: string[] = [];
  if (explicitPath) {
    devicePaths = [explicitPath];
  } else if (layout && layout.deviceSerials.length > 0) {
    const devices = await streamdeckDriver.listDevices();
    devicePaths = layout.deviceSerials
      .map((serial) => devices.find((d) => d.serialNumber === serial)?.path)
      .filter((p): p is string => !!p);
  }

  if (devicePaths.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: layout
          ? layout.deviceSerials.length > 0
            ? `None of the paired devices (${layout.deviceSerials.join(", ")}) are connected`
            : `Layout "${layoutId}" is not paired with a device`
          : "devicePath or layoutId required",
      },
      { status: 404 }
    );
  }

  if (body.clear === true) {
    await Promise.all(devicePaths.map((p) => streamdeckDriver.clearAll(p)));
    return NextResponse.json({ ok: true });
  }

  if (typeof body.brightness === "number") {
    const b = body.brightness;
    await Promise.all(
      devicePaths.map((p) => streamdeckDriver.setBrightness(p, b))
    );
  }

  // Single-key path — prefer the binding supplied in the body so
  // the editor's auto-push doesn't race the 400 ms debounced save.
  // `null` explicitly means "clear this key"; missing falls back to
  // the persisted store.
  if (typeof body.keyIndex === "number") {
    const keyIndex = body.keyIndex;
    const liveBinding =
      body.binding === null
        ? undefined
        : body.binding && typeof body.binding === "object"
          ? (body.binding as Parameters<typeof streamdeckDriver.renderKey>[2])
          : layout?.bindings[keyIndex];
    // `keyIndex` is a LAYOUT-grid index (the editor's grid). When a layout
    // is in play, render through renderLayoutKey so it lands on the correct
    // physical key of a differently-sized deck. An explicit devicePath with
    // no layout (rare internal caller) has no layout grid → render directly.
    await Promise.all(
      devicePaths.map((p) =>
        layout
          ? streamdeckDriver.renderLayoutKey(
              p,
              keyIndex,
              geometryForModel(layout.model),
              liveBinding
            )
          : streamdeckDriver.renderKey(p, keyIndex, liveBinding)
      )
    );
    return NextResponse.json({ ok: true });
  }

  // Whole-layout path — needs the persisted store.
  if (!layout) {
    return NextResponse.json(
      { ok: false, error: `Layout "${layoutId}" not found` },
      { status: 404 }
    );
  }
  await Promise.all(
    devicePaths.map((p) =>
      streamdeckDriver.pushLayout(
        p,
        layout.bindings,
        geometryForModel(layout.model)
      )
    )
  );
  // pushLayout painted STATIC faces (and reopened the HID handle as insurance
  // against another app having grabbed the deck). Immediately apply live
  // feedback in the same breath — tally / offline / state colours — so a
  // "Load to deck" shows its FINAL faces at once instead of static ones that
  // only gain feedback ~150 ms later on the layouts-route refresh (or the next
  // variable tick). renderLayout's renders supersede the just-queued static
  // ones per key (latest-writer-wins in the driver's debounce).
  void import("@/lib/streamdeck/feedback-coordinator")
    .then((m) => m.feedbackCoordinator.renderLayout(layout.id))
    .catch(() => {
      /* coordinator unavailable — static faces already painted */
    });
  return NextResponse.json({ ok: true });
}
