/**
 * Key image composer. Mirrors the server's `composeKeyImage`
 * (`src/lib/streamdeck/driver.ts`) so a key looks identical whether the
 * deck is local or behind this satellite.
 *
 * Renders here (not server-side) so the SSE payload stays tiny — the
 * server sends JSON metadata, the satellite paints the pixels.
 */

import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { DeckBindingLite, RenderOverride } from "./types";

export function composeKeyImage(
  size: number,
  binding: DeckBindingLite,
  override?: RenderOverride
): Buffer {
  const canvas: Canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  const bg = override?.bgcolor ?? binding.preset.bgcolor ?? "#000000";
  const fg = override?.fgcolor ?? binding.preset.fgcolor ?? "#ffffff";
  const face =
    override?.text ?? binding.preset.text ?? binding.preset.label ?? "";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  drawAutoFitText(ctx, face, size, fg);

  if (override?.badge) {
    const r = Math.max(5, Math.round(size * 0.06));
    const pad = Math.round(size * 0.08);
    ctx.beginPath();
    ctx.arc(size - pad, pad, r, 0, Math.PI * 2);
    ctx.fillStyle = override.badge.color;
    ctx.fill();
    if (override.badge.symbol) {
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(r * 1.2)}px sans-serif`;
      ctx.fillText(override.badge.symbol, size - pad, pad);
    }
  }

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

function drawAutoFitText(
  ctx: SKRSContext2D,
  face: string,
  size: number,
  color: string
): void {
  const lines = face
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return;

  const safeWidth = size - Math.max(8, Math.round(size * 0.1));
  const maxFontSize = Math.round(size * 0.32);
  const minFontSize = Math.max(10, Math.round(size * 0.14));
  const perLineCap =
    lines.length === 1
      ? maxFontSize
      : Math.round((size * 0.7) / lines.length);

  let fontSize = Math.min(maxFontSize, perLineCap);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (; fontSize >= minFontSize; fontSize -= 1) {
    ctx.font = `800 ${fontSize}px sans-serif`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= safeWidth) break;
  }
  ctx.font = `800 ${fontSize}px sans-serif`;

  const lineHeight = Math.round(fontSize * 1.02);
  const totalHeight = lineHeight * lines.length;
  let y = Math.round(size / 2 - totalHeight / 2 + lineHeight / 2);

  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  const strokeWidth = Math.max(2, Math.round(size * 0.025));
  (ctx as unknown as { lineWidth: number }).lineWidth = strokeWidth;
  ctx.fillStyle = color;
  for (const line of lines) {
    ctx.strokeText(line, size / 2, y);
    ctx.fillText(line, size / 2, y);
    y += lineHeight;
  }
}
