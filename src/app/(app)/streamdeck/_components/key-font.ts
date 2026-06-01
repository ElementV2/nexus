import { KEY_FONT_FAMILY, KEY_FONT_WEIGHT } from "@/lib/streamdeck/key-face";

/**
 * Resolve once the bundled key-label font is loaded, memoised process-wide.
 *
 * The deck grid (`DeckKey`) and the inspector preview (`KeyFacePreview`)
 * each redraw their `<canvas>` whenever a key's inputs change; calling
 * `document.fonts.load(...)` inside every redraw allocated a fresh promise
 * per key per redraw (32+ on a full-layout change). One shared promise lets
 * every canvas just `.then(paint)` off the same resolved handle.
 */
let ready: Promise<void> | null = null;

export function whenKeyFontReady(): Promise<void> {
  if (ready) return ready;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  ready = fonts?.load
    ? fonts
        .load(`${KEY_FONT_WEIGHT} 16px "${KEY_FONT_FAMILY}"`)
        .then(() => undefined)
        .catch(() => undefined)
    : Promise.resolve();
  return ready;
}
