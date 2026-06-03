/**
 * Stream Deck HID driver. All HID access goes through here so the
 * routes and the streamdeck page don't have to know about the
 * underlying packages.
 *
 * The packages (`@elgato-stream-deck/node`, `node-hid`, `usb`,
 * `@napi-rs/canvas`) are declared as `optionalDependencies` in
 * `package.json` — Nexus still builds and runs when they're not
 * installed. The driver detects this at module load time and reports
 * `state: "deps-missing"` so the UI can grey out HID affordances and
 * point the user to `npm install`.
 *
 * Hotplug: we subscribe to `usb.attach` / `detach` and re-list decks
 * on every event. SSE consumers get a `devices-changed` push so the
 * UI can re-render without polling.
 *
 * Rendering: each key image is composed via `@napi-rs/canvas` from
 * the bound preset's bg/fg/text. The composed RGB buffer is handed
 * to `fillKeyBuffer` directly — no PNG roundtrip on the hot path.
 */

import type { Canvas } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DeckBinding } from "@/lib/db/streamdeck";
import {
  DECK_GEOMETRIES,
  modelForGrid,
  remapKeyIndex,
  type DeckModel,
} from "@/lib/db/streamdeck";
import { screendeckServer } from "./screendeck-server";
import { hmrSingleton } from "@/lib/utils/hmr-singleton";
import { satelliteRegistry } from "./satellite-registry";
import { drawKeyFace, KEY_FONT_FAMILY, type FaceCtx } from "./key-face";
import { createLogger } from "@/lib/core/logger";

const log = createLogger("streamdeck");

// The @elgato-stream-deck/node v7 type surface is rich; we only need
// the slices the driver actually touches. Importing as types keeps
// tsc happy when the optional dep isn't installed yet — the runtime
// `await import("...")` still gates whether anything actually runs.
type StreamDeckDeviceInfo = {
  path: string;
  serialNumber?: string;
  model: string;
  productId?: number;
  vendorId?: number;
};
type ControlDef = {
  type: string;
  row: number;
  column: number;
  index: number;
  feedbackType?: string;
  pixelSize?: { width: number; height: number };
};
type StreamDeck = {
  readonly CONTROLS: readonly ControlDef[];
  readonly MODEL: string;
  readonly PRODUCT_NAME: string;
  fillKeyBuffer(
    keyIndex: number,
    buffer: Uint8Array,
    options: { format: "rgb" | "rgba" | "bgr" | "bgra" }
  ): Promise<void>;
  fillKeyColor(
    keyIndex: number,
    r: number,
    g: number,
    b: number
  ): Promise<void>;
  clearKey(keyIndex: number): Promise<void>;
  clearPanel(): Promise<void>;
  /** Restore the firmware's standby logo screen — the "plugged in, nothing
   *  driving it" look. Present on @elgato-stream-deck/node v7. */
  resetToLogo(): Promise<void>;
  setBrightness(percent: number): Promise<void>;
  close(): Promise<void>;
  on(event: "down" | "up", cb: (control: ControlDef) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  removeAllListeners(event?: string): void;
};

// ─────────────────────────── Module shape ─────────────────────────────

export interface DeviceSummary {
  path: string;
  serialNumber?: string;
  model: string;
  productId?: number;
  vendorId?: number;
  /** True if the driver already has an open handle for this device.
   *  Satellite-owned devices always report `true` (they're claimed
   *  by the remote agent, not by us). */
  opened: boolean;
  /** Convenience: row × col rendered by the driver based on the
   *  device's reported `KEY_ROWS` / `KEY_COLUMNS`. */
  rows?: number;
  cols?: number;
  iconSize?: number;
  /** True for devices forwarded by a `nexus-cross` satellite (i.e.
   *  physically plugged into a different machine on the LAN). The
   *  pairing / inspector UI labels these with a `(remote)` chip. */
  remote?: boolean;
  /** Satellite id owning this remote device. Only set when `remote`
   *  is true. Useful for the UI to group decks by host. */
  remoteSatelliteId?: string;
  /** Friendly label the satellite announced (the name the operator
   *  typed in nexus-cross). Shown next to the deck so it's obvious
   *  which machine it lives on. Falls back to the id when unset. */
  satelliteLabel?: string;
}

export type DriverState =
  | { state: "deps-missing"; reason: string }
  | { state: "ready"; devicesKnown: number }
  | { state: "error"; reason: string };

export interface DriverEvent {
  type: "devices-changed" | "key-down" | "key-up" | "error" | "status";
  devicePath?: string;
  /** HID serial number of the device — included on key events so
   *  consumers can resolve a paired layout without round-tripping
   *  through the device list. */
  serialNumber?: string;
  keyIndex?: number;
  /** Physical grid of the device this event came from — set on key
   *  events so the press dispatcher can remap the physical key back to
   *  the layout's (row,col) cell when the paired layout was designed on
   *  a different-width deck. */
  cols?: number;
  rows?: number;
  state?: DriverState;
  reason?: string;
}

type DriverListener = (event: DriverEvent) => void;

// ─────────────────────────── Lazy module load ─────────────────────────

interface LoadedModules {
  streamdeck: typeof import("@elgato-stream-deck/node");
  canvas: typeof import("@napi-rs/canvas");
  usb?: typeof import("usb");
}

let loadPromise: Promise<LoadedModules | null> | null = null;
let lastLoadError: string | null = null;
let fontRegistered = false;

/**
 * Register the bundled key-label font (Barlow Semi Condensed) with the
 * canvas engine so `composeKeyImage` paints the SAME face the browser
 * editor shows. Idempotent. The TTF ships in `public/fonts` — copied
 * next to the standalone server (`next-server/public`) by the launcher's
 * electron-builder config — so it resolves off `process.cwd()` in both
 * dev and the packaged build. If it can't be found we don't throw: the
 * canvas falls back to its default sans-serif and keys still render.
 */
function registerKeyFont(canvas: LoadedModules["canvas"]): void {
  if (fontRegistered) return;
  fontRegistered = true; // one attempt — don't re-stat on every reload
  // `GlobalFonts` is a value export of @napi-rs/canvas but isn't surfaced
  // on the dynamic-import namespace type here — reach it through a narrow
  // cast, and bail gracefully if the build's canvas build lacks it.
  const gf = (
    canvas as unknown as {
      GlobalFonts?: { registerFromPath(path: string, name?: string): boolean };
    }
  ).GlobalFonts;
  if (!gf) return;
  const candidates = [
    join(process.cwd(), "public", "fonts", "BarlowSemiCondensed-Medium.ttf"),
    join(process.cwd(), "fonts", "BarlowSemiCondensed-Medium.ttf"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      gf.registerFromPath(path, KEY_FONT_FAMILY);
      return;
    } catch {
      /* keep trying the next candidate */
    }
  }
}

/** Per-key render coalescing window. 60 ms catches a typical
 *  edit → save echo → variable change burst (~30-50 ms span) and
 *  collapses it into one HID write. Larger windows feel laggy on
 *  manual edits; smaller ones let glitches through. */
const RENDER_DEBOUNCE_MS = 60;

/** TTL for the cached `listDevices()` enumeration (see usage). */
const LIST_TTL_MS = 1000;

/**
 * Load JUST the canvas engine, independent of the HID stack. ScreenDeck
 * (and any Companion-Satellite client) renders server-composed bitmaps,
 * so it needs `@napi-rs/canvas` but NOT `@elgato-stream-deck/node` —
 * a machine with no physical decks (HID deps absent) must still drive
 * on-screen virtual decks. `loadModules` would fail the whole load if the
 * Elgato package is missing; this path doesn't depend on it.
 */
let canvasPromise: Promise<LoadedModules["canvas"] | null> | null = null;
async function loadCanvas(): Promise<LoadedModules["canvas"] | null> {
  if (canvasPromise) return canvasPromise;
  canvasPromise = (async () => {
    try {
      const canvas = await import("@napi-rs/canvas");
      registerKeyFont(canvas);
      return canvas;
    } catch {
      return null;
    }
  })();
  return canvasPromise;
}

async function loadModules(): Promise<LoadedModules | null> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const streamdeck = await import("@elgato-stream-deck/node");
      const canvas = await import("@napi-rs/canvas");
      registerKeyFont(canvas);
      // usb is optional even within the driver — without it we lose
      // hotplug but the rest still works. Wrap in its own try/catch.
      let usb: typeof import("usb") | undefined;
      try {
        usb = await import("usb");
      } catch {
        usb = undefined;
      }
      lastLoadError = null;
      return { streamdeck, canvas, usb };
    } catch (err) {
      lastLoadError = err instanceof Error ? err.message : String(err);
      return null;
    }
  })();
  return loadPromise;
}

// ─────────────────────────── Driver impl ──────────────────────────────

class DriverImpl {
  private openHandles = new Map<string, StreamDeck>();
  /**
   * In-flight `openStreamDeck` calls keyed by devicePath. Without
   * this, concurrent callers (e.g. pushLayout calling renderKey 32
   * times in parallel) each find an empty `openHandles`, each fire
   * `openStreamDeck`, each attach `on("down"/"up")` handlers — and
   * a single physical key press then triggers N event emissions.
   * The dedupe ensures only the first call actually opens the
   * device; everyone else awaits the same promise.
   */
  private openInFlight = new Map<string, Promise<StreamDeck | null>>();
  /** path → device info from the last `listDevices()` call. We keep
   *  this in parallel to `openHandles` so key events can attach a
   *  serial number without a fresh HID enumeration (which would
   *  block the event loop briefly on every press). */
  private deviceInfo = new Map<string, StreamDeckDeviceInfo>();
  private listeners = new Set<DriverListener>();
  private hotplugBound = false;
  private detachHotplug: (() => void) | null = null;

  /**
   * Per-key render coalescing. When multiple render requests land
   * for the same key within `RENDER_DEBOUNCE_MS`, only the last
   * one's binding+override is composed and written. Eliminates the
   * visible glitch on rapid var-change → edit → tally bursts and
   * cuts HID bandwidth roughly in half during a flurry.
   *
   * Key: `${devicePath}:${keyIndex}`. Value: a pending state
   * holding the latest payload + the timer.
   */
  private pendingRenders = new Map<
    string,
    {
      binding: DeckBinding | undefined;
      override:
        | {
            bgcolor?: string;
            fgcolor?: string;
            text?: string;
            badge?: { color: string; symbol?: string; icon?: "offline" };
          }
        | undefined;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Connection to the satellite registry — wired once, drops the
   *  unsubscribe on dispose. Created lazily so importing the
   *  driver from a route that doesn't actually fire HID doesn't
   *  drag the registry into a stale singleton state.  */
  private satelliteUnsub: (() => void) | null = null;

  /** Connections to the ScreenDeck (Companion-Satellite) server — its
   *  presses are normalized into the same key-down/up stream, and a
   *  surface (dis)connect re-emits devices-changed so the coordinator
   *  paints / drops it. Wired once on first subscribe, dropped on
   *  dispose. */
  private screendeckUnsub: (() => void) | null = null;
  private screendeckChangeUnsub: (() => void) | null = null;

  /** Last resolved face signature per `devicePath:keyIndex`. The
   *  feedback coordinator re-pushes EVERY bound key on EVERY variable
   *  change; without change-detection a single tally tick recomposes +
   *  HID-writes (or SSE-sends to a satellite) all 32 keys even though
   *  only one changed. We skip when the signature is unchanged. */
  private lastFace = new Map<string, string>();

  /** Short-TTL cache of `listDevices()`. The coordinator calls it on
   *  every recompute (every variable change) and each call otherwise
   *  does a full HID enumeration (`listStreamDecks()`), which briefly
   *  blocks the event loop. Invalidated on hotplug + satellite change. */
  private devicesCache: { ts: number; list: DeviceSummary[] } | null = null;
  private devicesChangedTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(cb: DriverListener): () => void {
    this.listeners.add(cb);
    // First subscriber wires up the satellite registry → driver
    // emit channel. Satellite presses are normalized into the same
    // `key-down` / `key-up` shape the local SDK uses so the press
    // dispatcher doesn't have to special-case them.
    if (!this.satelliteUnsub) {
      this.satelliteUnsub = satelliteRegistry.subscribePresses((event) => {
        const devicePath = `satellite:${event.serial}`;
        const dims = this.resolveDims(devicePath);
        this.emit({
          type: event.type === "down" ? "key-down" : "key-up",
          // Remote decks have no device path on this side — set a
          // synthetic marker prefixed with `satellite:` so any
          // downstream logic that wants to differentiate still can.
          devicePath,
          serialNumber: event.serial,
          keyIndex: event.keyIndex,
          cols: dims?.cols,
          rows: dims?.rows,
        });
      });
    }
    // Same bridge for ScreenDeck / Companion-Satellite virtual decks.
    if (!this.screendeckUnsub) {
      this.screendeckUnsub = screendeckServer.subscribePresses((event) => {
        const devicePath = `screendeck:${event.serial}`;
        const dims = this.resolveDims(devicePath);
        this.emit({
          type: event.type === "down" ? "key-down" : "key-up",
          devicePath,
          serialNumber: event.serial,
          keyIndex: event.keyIndex,
          cols: dims?.cols,
          rows: dims?.rows,
        });
      });
    }
    if (!this.screendeckChangeUnsub) {
      // A virtual surface (dis)appeared — same signal as USB hotplug /
      // a satellite (re)announce, so reuse the debounced broadcast.
      this.screendeckChangeUnsub = screendeckServer.onChange(() => {
        this.notifyDevicesChanged();
      });
    }
    return () => this.listeners.delete(cb);
  }

  private emit(event: DriverEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }

  async status(): Promise<DriverState> {
    const mods = await loadModules();
    if (!mods) {
      // Even if the local HID deps failed to load, satellites can
      // still bridge remote decks — the renderKey path doesn't need
      // them for `satellite:` paths. Report "ready" when at least
      // one satellite is connected so the UI doesn't grey out
      // controls that DO work.
      let remoteCount = 0;
      satelliteRegistry.forEachDevice(() => {
        remoteCount += 1;
      });
      screendeckServer.forEachDevice(() => {
        remoteCount += 1;
      });
      if (remoteCount > 0) {
        return { state: "ready", devicesKnown: remoteCount };
      }
      return {
        state: "deps-missing",
        reason:
          lastLoadError ??
          "Install @elgato-stream-deck/node + node-hid + @napi-rs/canvas",
      };
    }
    return { state: "ready", devicesKnown: this.openHandles.size };
  }

  async listDevices(): Promise<DeviceSummary[]> {
    // Short-TTL cache: the coordinator calls this on every variable
    // change, and a fresh `listStreamDecks()` HID enumeration per tally
    // tick briefly blocks the event loop. Hotplug + satellite changes
    // null the cache, so staleness is bounded to LIST_TTL_MS anyway.
    if (this.devicesCache && Date.now() - this.devicesCache.ts < LIST_TTL_MS) {
      return this.devicesCache.list;
    }
    const mods = await loadModules();
    if (!mods) {
      // Local HID failed to load, but satellites can still bridge —
      // return whatever the registry knows about so the UI can
      // pair against remote decks.
      const out: DeviceSummary[] = [];
      satelliteRegistry.forEachDevice((satelliteId, d, satelliteLabel) => {
        out.push({
          path: `satellite:${d.serial}`,
          serialNumber: d.serial,
          model: d.model,
          opened: true,
          rows: d.rows,
          cols: d.cols,
          iconSize: d.iconSize,
          remote: true,
          remoteSatelliteId: satelliteId,
          satelliteLabel: satelliteLabel ?? satelliteId,
        });
      });
      this.appendScreendeckDevices(out);
      this.devicesCache = { ts: Date.now(), list: out };
      return out;
    }
    let infos: StreamDeckDeviceInfo[] = [];
    try {
      infos = await mods.streamdeck.listStreamDecks();
    } catch (err) {
      // Local HID enumeration failed (e.g. a packaged build missing the
      // node-hid native binary). Do NOT bail with an empty list — fall
      // through so the REMOTE satellite decks below still surface. A broken
      // local HID must never hide working remote decks in "Load to deck".
      const reason = err instanceof Error ? err.message : String(err);
      log.warn(`local HID enumeration failed: ${reason}`);
      this.emit({ type: "error", reason });
      infos = [];
    }
    // Bind hotplug now that we've shown the modules load — the first
    // listDevices call typically fires after the user opens
    // /streamdeck so the timing is right.
    this.bindHotplug(mods);

    const out: DeviceSummary[] = [];
    // Refresh the cached info map — drop entries that are no longer
    // enumerated (unplugged) so we don't keep emitting their serial
    // on stray events.
    const seen = new Set<string>();
    for (const info of infos) {
      seen.add(info.path);
      this.deviceInfo.set(info.path, info);
      const open = this.openHandles.get(info.path);
      const dims = open ? deriveDims(open) : undefined;
      out.push({
        path: info.path,
        serialNumber: info.serialNumber,
        model: info.model,
        productId: info.productId,
        vendorId: info.vendorId,
        opened: !!open,
        rows: dims?.rows,
        cols: dims?.cols,
        iconSize: dims?.iconSize,
      });
    }
    for (const [k] of this.deviceInfo) {
      if (!seen.has(k)) this.deviceInfo.delete(k);
    }
    // Close handles for decks that are no longer enumerated (unplugged).
    // Without this a re-plug on the same USB path would reuse the DEAD
    // cached handle (open() returns it as-is), so renders silently no-op
    // — exactly the "deck shows in Load to deck but won't load after a
    // replug" symptom. Closing here means the next open() builds fresh.
    for (const [path] of this.openHandles) {
      if (!seen.has(path)) void this.close(path);
    }

    // Merge in satellite-owned devices. Their `path` is a synthetic
    // marker the rest of the pipeline routes through the satellite
    // registry instead of HID. The UI treats local and remote
    // identically — same serial-based pairing, same renders.
    // Skip any serial that's ALSO present locally: a deck physically
    // plugged into this PC must be driven over local HID, not a stale
    // satellite that still advertises it (which would render into the
    // void). Local wins.
    const localSerials = new Set(
      out.map((o) => o.serialNumber).filter((s): s is string => !!s)
    );
    satelliteRegistry.forEachDevice((satelliteId, d, satelliteLabel) => {
      if (localSerials.has(d.serial)) return;
      out.push({
        path: `satellite:${d.serial}`,
        serialNumber: d.serial,
        model: d.model,
        productId: undefined,
        vendorId: undefined,
        opened: true,
        rows: d.rows,
        cols: d.cols,
        iconSize: d.iconSize,
        // Tagged so the device picker / pairing UI can hint
        // "(remote)" alongside the serial.
        remote: true,
        remoteSatelliteId: satelliteId,
        satelliteLabel: satelliteLabel ?? satelliteId,
      });
    });
    this.appendScreendeckDevices(out);
    this.devicesCache = { ts: Date.now(), list: out };
    return out;
  }

  private bindHotplug(mods: LoadedModules): void {
    if (this.hotplugBound || !mods.usb) return;
    this.hotplugBound = true;
    const onUsbChange = () => {
      // Debounce: re-list after a tick to let the OS finish
      // enumerating before we ask. Stream Deck takes ~50 ms.
      this.devicesCache = null; // device set changed → drop the cache
      setTimeout(() => {
        this.emit({ type: "devices-changed" });
      }, 80);
    };
    // usb v2 exposes the hotplug EventEmitter under `usb.usb`, not
    // the top-level export. Top-level has Device/findByIds/etc.
    const usb = mods.usb.usb;
    usb.on("attach", onUsbChange);
    usb.on("detach", onUsbChange);
    // Remember how to detach so dispose() (HMR / teardown) doesn't leave
    // listeners accumulating on the module-level usb emitter.
    this.detachHotplug = () => {
      usb.off("attach", onUsbChange);
      usb.off("detach", onUsbChange);
    };
  }

  async open(devicePath: string): Promise<StreamDeck | null> {
    const mods = await loadModules();
    if (!mods) return null;
    const existing = this.openHandles.get(devicePath);
    if (existing) return existing;
    // Coalesce concurrent open() callers onto a single open promise.
    // Without this, the 32 renderKey calls fired by pushLayout each
    // raced past the openHandles check, each opened the device, each
    // attached `down/up` handlers — a 1× key press would then route
    // through N listeners. Map entry is cleared in the finally so a
    // subsequent open after a close succeeds.
    const inFlight = this.openInFlight.get(devicePath);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<StreamDeck | null> => {
      try {
        // Cast through unknown: the published `@elgato-stream-deck/node`
        // `StreamDeck` type re-export drops `CONTROLS` (it lives on
        // the wrapped `device` in v7), but every implementation
        // forwards the constants we rely on. Our local `StreamDeck`
        // shape pins the surface we actually call.
        const deck = (await mods.streamdeck.openStreamDeck(
          devicePath
        )) as unknown as StreamDeck;
        // The control carries its own (row, column); forward the grid
        // width/height so the press dispatcher can remap to the paired
        // layout's cell when the layout was designed on a different deck.
        const buttons = deck.CONTROLS.filter((c) => c.type === "button");
        let cols = 0;
        let rows = 0;
        for (const c of buttons) {
          if (c.column + 1 > cols) cols = c.column + 1;
          if (c.row + 1 > rows) rows = c.row + 1;
        }
        deck.on("down", (control) => {
          if (control.type !== "button") return;
          this.emit({
            type: "key-down",
            devicePath,
            serialNumber: this.deviceInfo.get(devicePath)?.serialNumber,
            keyIndex: control.index,
            cols,
            rows,
          });
        });
        deck.on("up", (control) => {
          if (control.type !== "button") return;
          this.emit({
            type: "key-up",
            devicePath,
            serialNumber: this.deviceInfo.get(devicePath)?.serialNumber,
            keyIndex: control.index,
            cols,
            rows,
          });
        });
        deck.on("error", (err: Error) => {
          log.warn(`deck ${devicePath} runtime error: ${err.message}`);
          this.emit({ type: "error", devicePath, reason: err.message });
        });
        this.openHandles.set(devicePath, deck);
        const info = this.deviceInfo.get(devicePath);
        log.info(
          `deck connected: ${info?.serialNumber ?? devicePath}` +
            ` (${cols}×${rows} keys)`
        );
        return deck;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.warn(`failed to open deck ${devicePath}: ${reason}`);
        this.emit({ type: "error", devicePath, reason });
        return null;
      }
    })();

    this.openInFlight.set(devicePath, promise);
    try {
      return await promise;
    } finally {
      this.openInFlight.delete(devicePath);
    }
  }

  async close(devicePath: string): Promise<void> {
    // Drop the per-key face cache for this device: a closed deck that's
    // re-plugged comes back BLANK, so the next render of an unchanged face
    // must actually re-draw instead of being skipped by change-detection
    // (the "deck stays dark after a re-plug" class of bug).
    this.invalidateFaceCache(devicePath);
    const handle = this.openHandles.get(devicePath);
    if (!handle) return;
    const info = this.deviceInfo.get(devicePath);
    try {
      handle.removeAllListeners();
      await handle.close();
    } catch {
      /* ignore — device may already be unplugged */
    }
    this.openHandles.delete(devicePath);
    log.info(`deck disconnected: ${info?.serialNumber ?? devicePath}`);
  }

  /**
   * Append connected ScreenDeck / Companion-Satellite virtual surfaces to
   * a device list. They surface exactly like satellite decks (remote +
   * labelled) so the pairing UI and "Load to deck" treat them uniformly.
   * The model is inferred from the announced grid so pairing one as a
   * layout's first device adopts the right editor geometry.
   */
  private appendScreendeckDevices(out: DeviceSummary[]): void {
    screendeckServer.forEachDevice((d) => {
      out.push({
        path: `screendeck:${d.deviceId}`,
        serialNumber: d.deviceId,
        model: modelForGrid(d.rows, d.cols),
        opened: true,
        rows: d.rows,
        cols: d.cols,
        iconSize: d.bitmapSize > 0 ? d.bitmapSize : 72,
        remote: true,
        satelliteLabel: d.productName,
      });
    });
  }

  /**
   * Best-effort physical grid of a device by path. Authoritative when
   * the deck is open (derived from its CONTROLS); falls back to the
   * satellite registry for remote decks, then to the model's published
   * geometry for a known-but-not-yet-open local deck. Null when nothing
   * knows the device yet (pre-enumeration) — callers treat that as
   * "assume the layout's own grid" (identity), which is correct when
   * the deck matches the layout and only momentarily off otherwise.
   */
  private resolveDims(devicePath: string): { rows: number; cols: number } | null {
    const open = this.openHandles.get(devicePath);
    if (open) {
      const d = deriveDims(open);
      return { rows: d.rows, cols: d.cols };
    }
    if (devicePath.startsWith("satellite:")) {
      const serial = devicePath.slice("satellite:".length);
      let dims: { rows: number; cols: number } | null = null;
      satelliteRegistry.forEachDevice((_id, d) => {
        if (d.serial === serial) dims = { rows: d.rows, cols: d.cols };
      });
      return dims;
    }
    if (devicePath.startsWith("screendeck:")) {
      const id = devicePath.slice("screendeck:".length);
      const d = screendeckServer.dims(id);
      return d ? { rows: d.rows, cols: d.cols } : null;
    }
    const info = this.deviceInfo.get(devicePath);
    const g = info ? DECK_GEOMETRIES[info.model as DeckModel] : undefined;
    return g ? { rows: g.rows, cols: g.cols } : null;
  }

  /**
   * Render a LAYOUT-space key onto a device, mapping it to the physical
   * key for the same (row,col) cell. This is the entry point every
   * caller that holds a layout (the editor live-push, the feedback
   * coordinator) should use: it honors the pinned-top-left overlay rule
   * so a layout designed on a wide deck shows correctly on a narrower
   * one. A binding whose cell is off this (smaller) device is silently
   * skipped — there's no physical key to draw it on.
   */
  renderLayoutKey(
    devicePath: string,
    layoutIndex: number,
    layout: { cols: number; rows: number },
    binding: DeckBinding | undefined,
    override?: Parameters<DriverImpl["renderKey"]>[3]
  ): void {
    const dims = this.resolveDims(devicePath);
    // Identity fallback when dims are unknown (device not yet enumerated):
    // correct for a matching deck, and self-corrects on the next render
    // once the handle opens.
    const cols = dims?.cols ?? layout.cols;
    const rows = dims?.rows ?? layout.rows;
    const physical = remapKeyIndex(layoutIndex, layout.cols, cols, rows);
    if (physical === undefined) return; // cell is off this device
    this.renderKey(devicePath, physical, binding, override);
  }

  /**
   * Render one key from a binding's preset and push to the device.
   * Coalesces rapid successive calls for the same key into a single
   * write (60 ms debounce) so a burst of edits / variable updates
   * doesn't ghost-flicker the LCD with intermediate frames.
   *
   * `override` applies a runtime style change (e.g. tally lit) on
   * top of the preset's static face. Used by the feedback
   * coordinator without mutating the stored binding.
   */
  renderKey(
    devicePath: string,
    keyIndex: number,
    binding: DeckBinding | undefined,
    override?: {
      bgcolor?: string;
      fgcolor?: string;
      text?: string;
      badge?: { color: string; symbol?: string; icon?: "offline" };
    }
  ): void {
    // Satellite-owned devices skip the local debounce + HID write
    // path — they're handled by the agent on the remote machine.
    // We forward the latest payload through the registry; the
    // agent does its own per-key coalescing on the receiving end.
    if (devicePath.startsWith("satellite:")) {
      const serial = devicePath.slice("satellite:".length);
      // Skip the SSE send when the resolved face is unchanged — the
      // coordinator re-pushes every key on every variable tick.
      const ck = `${devicePath}:${keyIndex}`;
      const sig = faceSignature(binding, override);
      if (this.lastFace.get(ck) === sig) return;
      this.lastFace.set(ck, sig);
      // Send only the visual fields the satellite renders from — not
      // the whole binding (steps/options/connection pins stay server
      // side). Keeps the SSE payload tiny on busy tally updates.
      satelliteRegistry.send({
        type: "render",
        serial,
        keyIndex,
        binding: binding
          ? {
              preset: {
                label: binding.preset.label,
                text: binding.preset.text,
                bgcolor: binding.preset.bgcolor,
                fgcolor: binding.preset.fgcolor,
              },
            }
          : null,
        override,
      });
      return;
    }
    const cacheKey = `${devicePath}:${keyIndex}`;
    const existing = this.pendingRenders.get(cacheKey);
    if (existing) {
      // Latest writer wins — replace the pending payload + reset
      // the timer so the user always sees the freshest face.
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pendingRenders.delete(cacheKey);
      void this.writeKey(devicePath, keyIndex, binding, override);
    }, RENDER_DEBOUNCE_MS);
    this.pendingRenders.set(cacheKey, { binding, override, timer });
  }

  /**
   * Internal: the actual HID write. Called from the debounce timer
   * with the *latest* payload for that key. Returns void so the
   * caller (timer) doesn't keep dangling promises.
   */
  private async writeKey(
    devicePath: string,
    keyIndex: number,
    binding: DeckBinding | undefined,
    override:
      | {
          bgcolor?: string;
          fgcolor?: string;
          text?: string;
          badge?: { color: string; symbol?: string; icon?: "offline" };
        }
      | undefined
  ): Promise<void> {
    // Skip recompose + HID write when the resolved face is identical to
    // what's already on the key. The coordinator fans a full-layout
    // re-push on every variable change; this collapses that to only the
    // keys that actually changed.
    const ck = `${devicePath}:${keyIndex}`;
    const sig = faceSignature(binding, override);
    if (this.lastFace.get(ck) === sig) return;

    // ScreenDeck / Companion-Satellite virtual decks: compose the SAME face
    // and ship it over the protocol as a bitmap. This path uses canvas only
    // (no HID), so it works on a machine with no physical decks.
    if (devicePath.startsWith("screendeck:")) {
      const id = devicePath.slice("screendeck:".length);
      const dims = screendeckServer.dims(id);
      if (!dims) return; // surface disconnected mid-debounce
      if (!binding) {
        screendeckServer.clearKey(id, keyIndex);
        this.lastFace.set(ck, sig);
        return;
      }
      const canvas = await loadCanvas();
      if (!canvas) return;
      const rgb = composeKeyImage(canvas, dims.iconSize, binding, override);
      // Diagnostic (top row only): which binding goes to which device key.
      if (keyIndex < dims.cols) {
        log.info(
          `SD render flat=${keyIndex} → ${Math.floor(keyIndex / dims.cols)}/${keyIndex % dims.cols} "${binding.preset.label}"`
        );
      }
      screendeckServer.renderKey(id, keyIndex, rgb);
      this.lastFace.set(ck, sig);
      return;
    }

    const mods = await loadModules();
    if (!mods) return;
    const deck = await this.open(devicePath);
    if (!deck) return;
    if (!binding) {
      try {
        await deck.clearKey(keyIndex);
        this.lastFace.set(ck, sig);
      } catch {
        // Write failed → the handle is likely dead (cable glitch, deck
        // dropped without a clean USB detach). Evict it so the next render
        // opens a fresh handle instead of silently writing into the void.
        void this.close(devicePath);
      }
      return;
    }
    const dims = deriveDims(deck);
    const size = dims.iconSize;
    const png = composeKeyImage(mods.canvas, size, binding, override);
    try {
      await deck.fillKeyBuffer(keyIndex, png, { format: "rgb" });
      this.lastFace.set(ck, sig);
    } catch (err) {
      this.emit({
        type: "error",
        devicePath,
        keyIndex,
        reason: err instanceof Error ? err.message : String(err),
      });
      // Dead handle → evict so the next render rebuilds it (otherwise every
      // subsequent write to this deck keeps failing against the stale handle
      // until the next listDevices enumeration notices it's gone).
      void this.close(devicePath);
    }
  }

  async clearAll(devicePath: string): Promise<void> {
    // clearPanel blanks every key, so the per-key face cache is now
    // stale for this device — drop its entries so the next render of an
    // unchanged face still re-draws onto the freshly-blanked panel.
    this.invalidateFaceCache(devicePath);
    if (devicePath.startsWith("satellite:")) {
      const serial = devicePath.slice("satellite:".length);
      satelliteRegistry.send({ type: "clear-panel", serial });
      return;
    }
    if (devicePath.startsWith("screendeck:")) {
      screendeckServer.clearPanel(devicePath.slice("screendeck:".length));
      return;
    }
    const deck = await this.open(devicePath);
    if (!deck) return;
    try {
      await deck.clearPanel();
    } catch {
      /* ignore */
    }
  }

  /**
   * Restore EVERY connected deck to the firmware standby logo and release
   * the local handles. Called on server shutdown so a closed server doesn't
   * leave stale, now-dead button images lit — the operator sees the same
   * idle Elgato logo as a freshly-plugged deck that nothing is driving.
   * Local decks use the SDK's `resetToLogo` (clearPanel as fallback);
   * satellites are told to do the same on their machine.
   */
  async resetAll(): Promise<void> {
    // Cancel in-flight debounced renders so nothing redraws over the logo.
    for (const { timer } of this.pendingRenders.values()) clearTimeout(timer);
    this.pendingRenders.clear();

    const handles = [...this.openHandles.entries()];
    await Promise.all(
      handles.map(async ([path, deck]) => {
        this.invalidateFaceCache(path);
        try {
          await deck.resetToLogo();
        } catch {
          // Model/SDK without resetToLogo → at least blank the dead buttons.
          try {
            await deck.clearPanel();
          } catch {
            /* device already gone */
          }
        }
        await this.close(path);
      })
    );

    // Tell every satellite to reset its own decks to the logo as well.
    satelliteRegistry.resetAllDecks();

    // Blank every connected virtual deck too — there's no "logo" for a
    // ScreenDeck, so clearing all keys is the closest idle state.
    screendeckServer.forEachDevice((d) => {
      this.invalidateFaceCache(`screendeck:${d.deviceId}`);
      screendeckServer.clearPanel(d.deviceId);
    });
  }

  async setBrightness(devicePath: string, percent: number): Promise<void> {
    if (devicePath.startsWith("satellite:")) {
      const serial = devicePath.slice("satellite:".length);
      satelliteRegistry.send({
        type: "brightness",
        serial,
        percent: Math.max(0, Math.min(100, percent | 0)),
      });
      return;
    }
    if (devicePath.startsWith("screendeck:")) {
      screendeckServer.setBrightness(
        devicePath.slice("screendeck:".length),
        percent
      );
      return;
    }
    const deck = await this.open(devicePath);
    if (!deck) return;
    try {
      await deck.setBrightness(Math.max(0, Math.min(100, percent | 0)));
    } catch {
      /* ignore */
    }
  }

  /** Drop the per-key face cache for one device (all its keys). */
  private invalidateFaceCache(devicePath: string): void {
    const prefix = `${devicePath}:`;
    for (const k of this.lastFace.keys()) {
      if (k.startsWith(prefix)) this.lastFace.delete(k);
    }
  }

  /**
   * Forget everything cached for a satellite's deck — its face cache
   * AND the device-list cache. Called when a satellite (re)announces:
   * its decks may have just reopened blank (restart), so the next
   * re-render must actually re-send every key instead of being skipped
   * by the change-detection above.
   */
  invalidateSatellite(serial: string): void {
    this.invalidateFaceCache(`satellite:${serial}`);
    this.devicesCache = null;
  }

  /**
   * Tell every SSE subscriber (the browser editor) that the device set
   * changed — a satellite just (re)announced or dropped, which local
   * USB hotplug can't signal. The editor re-fetches `/api/streamdeck/
   * devices` on this, so a remote deck appears/disappears live instead
   * of only on a manual refresh / page reload. Also drops the list
   * cache so that refetch is fresh.
   */
  notifyDevicesChanged(): void {
    // Drop the list cache immediately (cheap), but debounce the SSE
    // "devices-changed" broadcast: a satellite reconnect storm fires one
    // announce per flap, and each emit makes every open editor refetch
    // /devices → a fresh HID enumeration. Coalesce into one trailing emit.
    this.devicesCache = null;
    if (this.devicesChangedTimer) return;
    this.devicesChangedTimer = setTimeout(() => {
      this.devicesChangedTimer = null;
      this.emit({ type: "devices-changed" });
    }, 150);
  }

  async pushLayout(
    devicePath: string,
    bindings: Record<number, DeckBinding>,
    layout: { cols: number; rows: number }
  ): Promise<void> {
    // A "Load to deck" must repaint EVERY key unconditionally. Clear the
    // per-key face cache first: change-detection (`lastFace`) otherwise
    // SKIPS a key whose resolved face matches what we last drew — but the
    // physical key may actually be blank because another app (e.g. the
    // Elgato Stream Deck software) grabbed + reset the device, or it was
    // re-plugged. Symptom: a loaded layout only shows the keys that have
    // feedback (their override changes the signature when it fires, forcing
    // a redraw) or the ones the operator presses, while plain keys stay
    // dark. Invalidating up-front guarantees a full repaint. Covers the
    // satellite path below too (same cache, `satellite:<serial>:<key>`).
    this.invalidateFaceCache(devicePath);

    // Satellite path: we don't have a HID handle here — look up the
    // device's key count from the satellite registry instead, then
    // forward a render per key. The satellite agent applies them.
    if (devicePath.startsWith("satellite:")) {
      const serial = devicePath.slice("satellite:".length);
      let satCols = 0;
      let satRows = 0;
      satelliteRegistry.forEachDevice((_id, d) => {
        if (d.serial === serial) {
          satCols = d.cols;
          satRows = d.rows;
        }
      });
      const total = satCols * satRows;
      if (total === 0) return;
      // Iterate the satellite's PHYSICAL keys; pull each one's binding from
      // the layout cell at the same (row,col). Physical keys with no layout
      // cell (deck wider/taller than the layout) get `undefined` → cleared.
      for (let i = 0; i < total; i++) {
        const layoutIndex = remapKeyIndex(i, satCols, layout.cols, layout.rows);
        this.renderKey(
          devicePath,
          i,
          layoutIndex === undefined ? undefined : bindings[layoutIndex]
        );
      }
      return;
    }

    // Virtual-deck path: same shape as satellite — no HID handle, the grid
    // comes from the surface the client registered. renderKey routes the
    // composed bitmap over the Satellite protocol.
    if (devicePath.startsWith("screendeck:")) {
      const id = devicePath.slice("screendeck:".length);
      const d = screendeckServer.dims(id);
      if (!d) return;
      const total = d.cols * d.rows;
      for (let i = 0; i < total; i++) {
        const layoutIndex = remapKeyIndex(i, d.cols, layout.cols, layout.rows);
        this.renderKey(
          devicePath,
          i,
          layoutIndex === undefined ? undefined : bindings[layoutIndex]
        );
      }
      return;
    }

    const mods = await loadModules();
    if (!mods) return;
    // Drop any existing handle before reopening. A handle that another app
    // (the Elgato software) stole and then released goes stale — writing to
    // it silently no-ops the key, leaving it blank. `close()` evicts the
    // dead handle (and re-clears the face cache); `open()` then builds a
    // fresh, writable one. pushLayout is an explicit, non-hot action, so the
    // extra reopen is cheap insurance against the "loaded layout won't
    // draw after another app touched the deck" bug.
    await this.close(devicePath);
    const deck = await this.open(devicePath);
    if (!deck) return;
    // v7 publishes a CONTROLS array with one entry per physical
    // surface element (button, encoder, lcd-segment). We only render
    // buttons here; encoder LEDs / LCD segments will plug into their
    // own renderKey-like helpers when we wire Stream Deck +.
    //
    // renderKey is now fire-and-forget (returns void) — it schedules
    // a debounced HID write internally. All 32 keys land within the
    // debounce window, then the SDK's own queue serialises the
    // actual writes. No need to await per-key.
    const dims = deriveDims(deck);
    const buttons = deck.CONTROLS.filter((c) => c.type === "button");
    for (const ctrl of buttons) {
      // Map the PHYSICAL key to the layout cell at the same (row,col).
      // A physical key with no layout cell (deck bigger than the layout)
      // resolves to `undefined` → renderKey clears it, so stale faces
      // from a previous, larger layout don't linger.
      const layoutIndex = remapKeyIndex(
        ctrl.index,
        dims.cols,
        layout.cols,
        layout.rows
      );
      this.renderKey(
        devicePath,
        ctrl.index,
        layoutIndex === undefined ? undefined : bindings[layoutIndex]
      );
    }
  }

  dispose(): void {
    this.detachHotplug?.();
    this.detachHotplug = null;
    this.hotplugBound = false;
    this.satelliteUnsub?.();
    this.satelliteUnsub = null;
    this.screendeckUnsub?.();
    this.screendeckUnsub = null;
    this.screendeckChangeUnsub?.();
    this.screendeckChangeUnsub = null;
    for (const { timer } of this.pendingRenders.values()) {
      clearTimeout(timer);
    }
    this.pendingRenders.clear();
    for (const [, handle] of this.openHandles) {
      try {
        handle.removeAllListeners();
        handle.close();
      } catch {
        /* swallow */
      }
    }
    this.openHandles.clear();
    this.listeners.clear();
    this.lastFace.clear();
    if (this.devicesChangedTimer) clearTimeout(this.devicesChangedTimer);
    this.devicesChangedTimer = null;
    this.devicesCache = null;
  }
}

// ─────────────────────────── Geometry helper ─────────────────────────

/**
 * Derive rows / cols / iconSize from the deck's CONTROLS array.
 * Older SDKs exposed KEY_ROWS / KEY_COLUMNS / ICON_SIZE directly;
 * v7+ replaced them with a richer CONTROLS list — same numbers,
 * different access path. Fallbacks (72px) mirror the Stream Deck MK.2
 * key size so a never-seen-before model still renders something.
 */
function deriveDims(deck: StreamDeck): {
  rows: number;
  cols: number;
  iconSize: number;
} {
  const buttons = deck.CONTROLS.filter((c) => c.type === "button");
  let maxRow = 0;
  let maxCol = 0;
  let size = 72;
  for (const c of buttons) {
    if (c.row > maxRow) maxRow = c.row;
    if (c.column > maxCol) maxCol = c.column;
    if (c.pixelSize?.width) size = c.pixelSize.width;
  }
  return {
    rows: maxRow + 1,
    cols: maxCol + 1,
    iconSize: size,
  };
}

// ─────────────────────────── Image composer ───────────────────────────

/**
 * Render a key face as a raw RGB buffer the Stream Deck SDK can write
 * directly. The face itself (bg + auto-fit label + badge) is painted by
 * the shared `drawKeyFace` so the metal matches the browser editor and
 * the satellite exactly; this function only owns the canvas allocation
 * and the RGBA→RGB pixel extraction.
 *
 * The output is RGB (3 bytes per pixel) because that's what
 * `fillKeyBuffer({format: "rgb"})` expects — slightly more efficient
 * than the RGBA path for our use case.
 */

/** Cheap signature of the RESOLVED key face — what actually gets drawn.
 *  Two payloads with the same signature produce an identical image, so
 *  we can skip the recompose + HID write / SSE send. */
function faceSignature(
  binding: DeckBinding | undefined,
  override?: {
    bgcolor?: string;
    fgcolor?: string;
    text?: string;
    badge?: { color: string; symbol?: string; icon?: "offline" };
  }
): string {
  if (!binding) return "∅";
  const bg = override?.bgcolor ?? binding.preset.bgcolor ?? "";
  const fg = override?.fgcolor ?? binding.preset.fgcolor ?? "";
  const face = override?.text ?? binding.preset.text ?? binding.preset.label ?? "";
  const badge = override?.badge
    ? `${override.badge.color}|${override.badge.symbol ?? ""}|${override.badge.icon ?? ""}`
    : "";
  return `${bg}|${fg}|${face}|${badge}`;
}

function composeKeyImage(
  canvasModule: LoadedModules["canvas"],
  size: number,
  binding: DeckBinding,
  override?: {
    bgcolor?: string;
    fgcolor?: string;
    text?: string;
    badge?: { color: string; symbol?: string; icon?: "offline" };
  }
): Buffer {
  const canvas: Canvas = canvasModule.createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const bg = override?.bgcolor ?? binding.preset.bgcolor ?? "#000000";
  const fg = override?.fgcolor ?? binding.preset.fgcolor ?? "#ffffff";
  const face = override?.text ?? binding.preset.text ?? binding.preset.label ?? "";

  // Single shared drawer — identical to the browser preview + satellite.
  // Cast: the engine's `fillStyle` is `string | gradient | pattern`, but the
  // drawer only ever assigns strings, so the narrower `FaceCtx` is safe.
  drawKeyFace(ctx as unknown as FaceCtx, {
    size,
    bg,
    fg,
    face,
    badge: override?.badge,
  });

  // Extract RGBA via getImageData (the only way to get raw pixel
  // bytes from @napi-rs/canvas — its toBuffer() only emits encoded
  // formats). Strip alpha for the Stream Deck SDK's RGB path.
  const img = ctx.getImageData(0, 0, size, size);
  const rgba = img.data;
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

// ─────────────────────────── HMR-safe singleton ───────────────────────

export const streamdeckDriver = hmrSingleton("streamdeck-driver", DriverImpl);
