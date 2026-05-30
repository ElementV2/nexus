/**
 * Local Stream Deck HID management for the satellite.
 *
 * Responsibilities:
 *   • Enumerate connected decks at boot AND on USB hotplug.
 *   • Open each deck and expose `renderKey`, `clearKey`, `clearPanel`,
 *     `setBrightness` to the message loop.
 *   • Forward key-down / key-up events to a single subscriber (the
 *     server-client uplink).
 *   • Apply a per-key debounce identical to the server driver so a
 *     burst of remote render commands collapses to one HID write.
 *
 * The agent always assumes the optional native deps are installed
 * (unlike the Next.js project which makes them optional) — the
 * package.json lists them as regular dependencies, so a failed
 * install means the user shouldn't have run the agent in the first
 * place. We surface load errors clearly instead of silently muting
 * features.
 */

import { listStreamDecks, openStreamDeck } from "@elgato-stream-deck/node";
import * as usbMod from "usb";
import type { SatelliteDevice, DeckBindingLite, RenderOverride } from "./types";
import { composeKeyImage } from "./key-image";

const RENDER_DEBOUNCE_MS = 60;
// Opening a Stream Deck already held by another process (the main Nexus
// app, Elgato software) can hang the native call instead of throwing.
// Race every open against this so one locked deck can't wedge refresh().
const OPEN_TIMEOUT_MS = 4_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

type ControlDef = {
  type: string;
  row: number;
  column: number;
  index: number;
  pixelSize?: { width: number; height: number };
};

type DeckHandle = {
  readonly CONTROLS: readonly ControlDef[];
  readonly MODEL: string;
  readonly PRODUCT_NAME: string;
  /** v7 reads the serial from the device asynchronously. Some OSes
   *  don't surface it in the HID enumeration, so we fall back to this. */
  getSerialNumberAsync?(): Promise<string>;
  fillKeyBuffer(
    keyIndex: number,
    buffer: Uint8Array,
    options: { format: "rgb" | "rgba" | "bgr" | "bgra" }
  ): Promise<void>;
  clearKey(keyIndex: number): Promise<void>;
  clearPanel(): Promise<void>;
  setBrightness(percent: number): Promise<void>;
  close(): Promise<void>;
  on(event: "down" | "up", cb: (control: ControlDef) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  removeAllListeners(event?: string): void;
};

interface OpenDeck {
  serial: string;
  path: string;
  handle: DeckHandle;
  dims: { rows: number; cols: number; iconSize: number };
  pending: Map<number, NodeJS.Timeout>;
}

export type KeyEvent = {
  serial: string;
  keyIndex: number;
  type: "down" | "up";
};

export class HidManager {
  private decks = new Map<string, OpenDeck>(); // serial → deck
  private keyListener: ((e: KeyEvent) => void) | null = null;
  private deviceChangeListener: (() => void) | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private detachHotplug: (() => void) | null = null;
  // Decks that enumeration found but we couldn't open — almost always
  // because another process on this machine already owns them (the main
  // Nexus app, or Elgato's software). Surfaced in the status so the UI
  // can say "in use" instead of the misleading "no deck detected".
  private blocked = 0;

  onKey(cb: (e: KeyEvent) => void): void {
    this.keyListener = cb;
  }

  onDeviceChange(cb: () => void): void {
    this.deviceChangeListener = cb;
  }

  /** Open every Stream Deck currently plugged in. Idempotent — calling
   *  again after a hotplug picks up new devices and skips already-open
   *  ones. */
  async refresh(): Promise<void> {
    const infos = await listStreamDecks();
    const seen = new Set<string>();
    let blocked = 0;
    for (const info of infos) {
      let serial = info.serialNumber;
      // Known serial that's already open → nothing to do.
      if (serial && this.decks.has(serial)) {
        seen.add(serial);
        continue;
      }
      try {
        const handle = (await withTimeout(
          openStreamDeck(info.path) as unknown as Promise<DeckHandle>,
          OPEN_TIMEOUT_MS,
          `open ${info.path}`
        )) as DeckHandle;
        // Some platforms omit the serial from enumeration — read it
        // from the opened device. Pairing is serial-based, so a deck
        // with no resolvable serial can't be targeted; skip it.
        if (!serial && handle.getSerialNumberAsync) {
          try {
            serial = await withTimeout(
              handle.getSerialNumberAsync(),
              OPEN_TIMEOUT_MS,
              "getSerialNumber"
            );
          } catch {
            /* fall through to the no-serial guard */
          }
        }
        if (!serial) {
          console.warn(`[hid] ${info.path}: no serial number, skipping`);
          await handle.close().catch(() => {});
          continue;
        }
        // Race: opened via a second path while already known.
        if (this.decks.has(serial)) {
          await handle.close().catch(() => {});
          seen.add(serial);
          continue;
        }
        // Capture as const so the event closures below see a definite
        // string (the outer `serial` is `let`, hence string|undefined).
        const sn: string = serial;
        seen.add(sn);
        const dims = deriveDims(handle);
        const open: OpenDeck = {
          serial: sn,
          path: info.path,
          handle,
          dims,
          pending: new Map(),
        };
        handle.on("down", (ctrl) => {
          if (ctrl.type !== "button") return;
          this.keyListener?.({ serial: sn, keyIndex: ctrl.index, type: "down" });
        });
        handle.on("up", (ctrl) => {
          if (ctrl.type !== "button") return;
          this.keyListener?.({ serial: sn, keyIndex: ctrl.index, type: "up" });
        });
        handle.on("error", (err) => {
          console.error(`[hid] deck ${sn} error:`, err.message);
        });
        this.decks.set(sn, open);
        console.log(
          `[hid] opened ${serial} (${handle.MODEL}, ${dims.rows}×${dims.cols})`
        );
      } catch (err) {
        // Found in the HID enumeration but open() failed — treat as a
        // deck claimed by another app (the common same-PC case).
        blocked++;
        console.error(
          `[hid] failed to open ${serial}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    this.blocked = blocked;
    // Drop decks that were unplugged.
    for (const [serial, open] of this.decks) {
      if (!seen.has(serial)) {
        for (const t of open.pending.values()) clearTimeout(t);
        try {
          await open.handle.close();
        } catch {
          /* ignore */
        }
        this.decks.delete(serial);
        console.log(`[hid] closed ${serial} (unplugged)`);
      }
    }
    this.deviceChangeListener?.();
  }

  /** Count of decks present in HID enumeration that couldn't be opened
   *  (already claimed by another process). 0 when all visible decks are
   *  ours or none are plugged in. */
  blockedCount(): number {
    return this.blocked;
  }

  list(): SatelliteDevice[] {
    return Array.from(this.decks.values()).map((d) => ({
      serial: d.serial,
      model: d.handle.MODEL,
      productName: d.handle.PRODUCT_NAME,
      rows: d.dims.rows,
      cols: d.dims.cols,
      iconSize: d.dims.iconSize,
    }));
  }

  renderKey(
    serial: string,
    keyIndex: number,
    binding: DeckBindingLite | null,
    override?: RenderOverride
  ): void {
    const deck = this.decks.get(serial);
    if (!deck) return;
    const existing = deck.pending.get(keyIndex);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      deck.pending.delete(keyIndex);
      void this.writeKey(deck, keyIndex, binding, override);
    }, RENDER_DEBOUNCE_MS);
    deck.pending.set(keyIndex, timer);
  }

  private async writeKey(
    deck: OpenDeck,
    keyIndex: number,
    binding: DeckBindingLite | null,
    override?: RenderOverride
  ): Promise<void> {
    if (!binding) {
      try {
        await deck.handle.clearKey(keyIndex);
      } catch (err) {
        // Usually means the deck was unplugged mid-write — benign, but
        // log so a deck that goes dark isn't a total mystery.
        console.warn(
          `[hid] clearKey ${deck.serial}#${keyIndex} failed:`,
          err instanceof Error ? err.message : err
        );
      }
      return;
    }
    try {
      const buf = composeKeyImage(deck.dims.iconSize, binding, override);
      await deck.handle.fillKeyBuffer(keyIndex, buf, { format: "rgb" });
    } catch (err) {
      console.error(
        `[hid] write ${deck.serial}#${keyIndex} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  async clearKey(serial: string, keyIndex: number): Promise<void> {
    const deck = this.decks.get(serial);
    if (!deck) return;
    try {
      await deck.handle.clearKey(keyIndex);
    } catch (err) {
      console.warn(
        `[hid] clearKey ${serial}#${keyIndex} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  async clearPanel(serial: string): Promise<void> {
    const deck = this.decks.get(serial);
    if (!deck) return;
    try {
      await deck.handle.clearPanel();
    } catch (err) {
      console.warn(
        `[hid] clearPanel ${serial} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  async setBrightness(serial: string, percent: number): Promise<void> {
    const deck = this.decks.get(serial);
    if (!deck) return;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    try {
      await deck.handle.setBrightness(clamped);
    } catch (err) {
      console.warn(
        `[hid] setBrightness ${serial} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /** Subscribe to USB hotplug. Debounces so an attach burst (Windows
   *  fires multiple events per device) only triggers one rescan. */
  watchHotplug(): void {
    // usb v2 nests its exports under `.usb`.
    const usb = (usbMod as unknown as { usb?: typeof import("usb").usb })
      .usb;
    if (!usb || typeof usb.on !== "function") {
      console.warn("[hid] usb hotplug not available — relying on manual rescan");
      return;
    }
    const schedule = () => {
      if (this.rescanTimer) clearTimeout(this.rescanTimer);
      this.rescanTimer = setTimeout(() => {
        this.rescanTimer = null;
        void this.refresh();
      }, 250);
    };
    usb.on("attach", schedule);
    usb.on("detach", schedule);
    // The agent creates a fresh HidManager on every settings change
    // (server-URL edit) — without detaching, each old manager's hotplug
    // listeners stay registered on the module-level usb emitter and pile
    // up, firing N duplicate rescans per plug. Remember how to remove them.
    this.detachHotplug = () => {
      usb.off("attach", schedule);
      usb.off("detach", schedule);
    };
  }

  async dispose(): Promise<void> {
    this.detachHotplug?.();
    this.detachHotplug = null;
    if (this.rescanTimer) {
      clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
    }
    for (const open of this.decks.values()) {
      for (const t of open.pending.values()) clearTimeout(t);
      try {
        await open.handle.close();
      } catch (err) {
        console.warn(
          `[hid] close ${open.serial} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    this.decks.clear();
  }
}

function deriveDims(
  deck: DeckHandle
): { rows: number; cols: number; iconSize: number } {
  const buttons = deck.CONTROLS.filter((c) => c.type === "button");
  let rows = 0;
  let cols = 0;
  let iconSize = 72;
  for (const b of buttons) {
    if (b.row + 1 > rows) rows = b.row + 1;
    if (b.column + 1 > cols) cols = b.column + 1;
    if (b.pixelSize?.width) iconSize = b.pixelSize.width;
  }
  return { rows, cols, iconSize };
}
