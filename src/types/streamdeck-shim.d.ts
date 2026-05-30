/**
 * Minimal type stubs for the optional Stream Deck dependency chain.
 * These packages aren't required for the rest of Nexus to build, so
 * they're declared as `optionalDependencies` in package.json. Adding
 * shims here lets `tsc --noEmit` pass whether or not `npm install`
 * has been run yet; runtime guards in `src/lib/streamdeck/driver.ts`
 * detect missing modules and surface a "driver not installed" status.
 *
 * The shims intentionally don't try to mirror the full package API —
 * just the surface the driver uses. Once the real package is
 * installed its `.d.ts` files override these (broader types win).
 */

declare module "@elgato-stream-deck/node" {
  export interface StreamDeckDeviceInfo {
    path: string;
    serialNumber?: string;
    model: string;
    productId?: number;
    vendorId?: number;
  }

  export interface StreamDeck {
    NUM_KEYS: number;
    KEY_COLUMNS: number;
    KEY_ROWS: number;
    ICON_SIZE: number;
    PRODUCT_NAME: string;
    MODEL: string;
    fillKeyBuffer(
      keyIndex: number,
      buffer: Buffer | Uint8Array,
      options?: { format?: "rgb" | "rgba" }
    ): Promise<void>;
    fillKeyColor(
      keyIndex: number,
      r: number,
      g: number,
      b: number
    ): Promise<void>;
    clearKey(keyIndex: number): Promise<void>;
    clearPanel(): Promise<void>;
    setBrightness(percent: number): Promise<void>;
    close(): Promise<void>;
    on(event: "down" | "up", cb: (keyIndex: number) => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    removeAllListeners(event?: string): void;
  }

  export function listStreamDecks(): Promise<StreamDeckDeviceInfo[]>;
  export function openStreamDeck(path: string): Promise<StreamDeck>;
}

declare module "@napi-rs/canvas" {
  export interface ImageData {
    width: number;
    height: number;
    /** RGBA, row-major, 4 bytes per pixel. */
    data: Uint8ClampedArray;
  }
  export interface CanvasRenderingContext2D {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    font: string;
    textAlign: "start" | "end" | "left" | "right" | "center";
    textBaseline:
      | "top"
      | "hanging"
      | "middle"
      | "alphabetic"
      | "ideographic"
      | "bottom";
    fillRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number, maxWidth?: number): void;
    strokeText(text: string, x: number, y: number, maxWidth?: number): void;
    measureText(text: string): { width: number };
    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    beginPath(): void;
    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number
    ): void;
    fill(): void;
    stroke(): void;
  }
  export interface Canvas {
    width: number;
    height: number;
    getContext(type: "2d"): CanvasRenderingContext2D;
    toBuffer(format?: "image/png" | "image/jpeg"): Buffer;
  }
  export function createCanvas(width: number, height: number): Canvas;
}

declare module "node-hid" {
  // Driver only uses node-hid transitively via @elgato-stream-deck/node;
  // no direct imports here. The stub keeps tsc happy if some peer
  // dependency types reference it.
  const _placeholder: unknown;
  export default _placeholder;
}

declare module "usb" {
  // usb v2 exposes the hotplug EventEmitter under a `usb` sub-export.
  // Top-level helpers like `findByIds` exist too but the driver only
  // needs the hotplug events.
  export const usb: {
    on(event: "attach" | "detach", cb: (device: unknown) => void): void;
    off(event: "attach" | "detach", cb: (device: unknown) => void): void;
  };
}
