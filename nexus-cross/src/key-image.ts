/**
 * Key image composer. Delegates the actual face drawing to the shared
 * `drawKeyFace` (mirror of the server's `src/lib/streamdeck/key-face.ts`)
 * so a key looks identical whether the deck is local or behind this
 * satellite. This file only owns the canvas allocation + RGBA→RGB
 * extraction.
 *
 * Renders here (not server-side) so the SSE payload stays tiny — the
 * server sends JSON metadata, the satellite paints the pixels.
 */

import {
  createCanvas,
  GlobalFonts,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import type { DeckBindingLite, RenderOverride } from "./types";
import { drawKeyFace, KEY_FONT_FAMILY, type FaceCtx } from "./key-face";

let fontRegistered = false;

/**
 * Register the bundled key-label font with the canvas engine. Idempotent.
 * `main.ts` resolves the TTF path (electron resource dir differs between
 * dev and the packaged app) and passes the candidates here. If none load
 * the canvas falls back to its default sans-serif — keys still render.
 */
export function registerKeyFont(candidatePaths: string[]): void {
  if (fontRegistered) return;
  fontRegistered = true;
  for (const path of candidatePaths) {
    try {
      if (!existsSync(path)) continue;
      GlobalFonts.registerFromPath(path, KEY_FONT_FAMILY);
      return;
    } catch {
      /* try the next candidate */
    }
  }
}

export function composeKeyImage(
  size: number,
  binding: DeckBindingLite,
  override?: RenderOverride
): Buffer {
  const canvas: Canvas = createCanvas(size, size);
  const ctx: SKRSContext2D = canvas.getContext("2d");

  const bg = override?.bgcolor ?? binding.preset.bgcolor ?? "#000000";
  const fg = override?.fgcolor ?? binding.preset.fgcolor ?? "#ffffff";
  const face =
    override?.text ?? binding.preset.text ?? binding.preset.label ?? "";

  // Shared drawer — identical to the server + browser preview. Cast: the
  // engine's `fillStyle` is `string | gradient | pattern`, but the drawer
  // only ever assigns strings, so the narrower `FaceCtx` is safe.
  drawKeyFace(ctx as unknown as FaceCtx, {
    size,
    bg,
    fg,
    face,
    badge: override?.badge,
  });

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
