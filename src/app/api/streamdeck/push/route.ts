import { NextRequest, NextResponse } from "next/server";
import { streamdeckDriver } from "@/lib/streamdeck/driver";
import { getStreamdeckStore } from "@/lib/db/streamdeck";

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

  // Resolve target devicePath either directly or by serial-pairing.
  let devicePath = typeof body.devicePath === "string" ? body.devicePath : null;
  const layoutId = typeof body.layoutId === "string" ? body.layoutId : null;
  const store = getStreamdeckStore();
  const layout = layoutId
    ? store.layouts.find((l) => l.id === layoutId)
    : undefined;
  if (!devicePath && layout?.deviceSerial) {
    const devices = await streamdeckDriver.listDevices();
    const match = devices.find((d) => d.serialNumber === layout.deviceSerial);
    devicePath = match?.path ?? null;
  }
  if (!devicePath) {
    return NextResponse.json(
      {
        ok: false,
        error: layout
          ? layout.deviceSerial
            ? `Paired device ${layout.deviceSerial} not connected`
            : `Layout "${layoutId}" is not paired with a device`
          : "devicePath or layoutId required",
      },
      { status: 404 }
    );
  }

  if (body.clear === true) {
    await streamdeckDriver.clearAll(devicePath);
    return NextResponse.json({ ok: true });
  }

  if (typeof body.brightness === "number") {
    await streamdeckDriver.setBrightness(devicePath, body.brightness);
  }

  // Single-key path — prefer the binding supplied in the body so
  // the editor's auto-push doesn't race the 400 ms debounced save.
  // `null` explicitly means "clear this key"; missing falls back to
  // the persisted store.
  if (typeof body.keyIndex === "number") {
    const liveBinding =
      body.binding === null
        ? undefined
        : body.binding && typeof body.binding === "object"
          ? (body.binding as Parameters<typeof streamdeckDriver.renderKey>[2])
          : layout?.bindings[body.keyIndex];
    await streamdeckDriver.renderKey(devicePath, body.keyIndex, liveBinding);
    return NextResponse.json({ ok: true });
  }

  // Whole-layout path — needs the persisted store.
  if (!layout) {
    return NextResponse.json(
      { ok: false, error: `Layout "${layoutId}" not found` },
      { status: 404 }
    );
  }
  await streamdeckDriver.pushLayout(devicePath, layout.bindings);
  return NextResponse.json({ ok: true });
}
