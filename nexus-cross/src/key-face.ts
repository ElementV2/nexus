/**
 * Mirror copy of the server's `src/lib/streamdeck/key-face.ts`.
 *
 * The satellite ships as a standalone binary with no source-import
 * dependency on the Next.js project, so the key-face drawer is
 * duplicated here. Keep the drawing logic BYTE-FOR-BYTE identical to the
 * server copy — that's what guarantees a key looks the same whether it's
 * driven locally or bridged through this satellite.
 *
 * Font: Barlow Semi Condensed Medium (bundled under `resources/fonts`,
 * OFL), registered by `main.ts` before any render.
 */

/** Font family registered with the canvas engine. Must match the server
 *  copy AND the `@font-face` declared in the main app's browser editor. */
export const KEY_FONT_FAMILY = "Barlow Semi Condensed";
/** Weight we render labels at. */
export const KEY_FONT_WEIGHT = 500;

/** Minimal gradient handle — `addColorStop` is all the drawer calls. */
interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/** The slice of the Canvas 2D API the face drawer touches.
 *  `@napi-rs/canvas`'s `SKRSContext2D` satisfies this structurally. */
export interface FaceCtx {
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): CanvasGradientLike;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
}

interface KeyFace {
  size: number;
  bg: string;
  fg: string;
  face: string;
  badge?: { color: string; symbol?: string; icon?: "offline" };
}

export function drawKeyFace(ctx: FaceCtx, opts: KeyFace): void {
  const { size, bg, fg, face, badge } = opts;

  ctx.fillStyle = backgroundFill(ctx, bg, size);
  ctx.fillRect(0, 0, size, size);

  drawAutoFitText(ctx, face, size, fg);

  if (badge?.icon === "offline") {
    drawOfflineIcon(ctx, size, badge.color);
  } else if (badge) {
    const r = Math.max(5, Math.round(size * 0.06));
    const pad = Math.round(size * 0.08);
    ctx.beginPath();
    ctx.arc(size - pad, pad, r, 0, Math.PI * 2);
    ctx.fillStyle = badge.color;
    ctx.fill();
    if (badge.symbol) {
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${KEY_FONT_WEIGHT} ${Math.round(r * 1.4)}px "${KEY_FONT_FAMILY}", sans-serif`;
      ctx.fillText(badge.symbol, size - pad, pad);
    }
  }
}

function drawOfflineIcon(ctx: FaceCtx, size: number, color: string): void {
  const cx = size * 0.82;
  const cy = size * 0.24;
  const step = size * 0.05;
  ctx.lineCap = "round";

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, Math.round(size * 0.02));
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, step * i, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.3, size * 0.013), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const x0 = cx - step * 2.6;
  const y0 = cy - step * 2.6;
  const x1 = cx + step * 0.8;
  const y1 = cy + step * 0.8;
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = Math.max(2.5, Math.round(size * 0.04));
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, Math.round(size * 0.02));
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function parseRgb(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function shadeColor(color: string, amount: number): string {
  const rgb = parseRgb(color);
  if (!rgb) return color;
  const mix = (c: number) =>
    amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
  const hex = rgb
    .map((c) => {
      const v = Math.max(0, Math.min(255, Math.round(mix(c))));
      return v.toString(16).padStart(2, "0");
    })
    .join("");
  return `#${hex}`;
}

const BG_LIGHTEN = 0.13;
const BG_DARKEN = -0.16;

function backgroundFill(
  ctx: FaceCtx,
  bg: string,
  size: number
): string | CanvasGradientLike {
  if (!parseRgb(bg)) return bg;
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, shadeColor(bg, BG_LIGHTEN));
  grad.addColorStop(0.5, bg);
  grad.addColorStop(1, shadeColor(bg, BG_DARKEN));
  return grad;
}

// (The app-only CSS-gradient helper `keyBackgroundCss` lives in the server
// copy — the satellite has no DOM, so it's intentionally omitted here.)

function drawAutoFitText(
  ctx: FaceCtx,
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
  const heightCap = size - Math.max(6, Math.round(size * 0.12));
  const maxFontSize = Math.round(size * 0.42);
  const minFontSize = Math.max(9, Math.round(size * 0.13));

  const setFont = (px: number) => {
    ctx.font = `${KEY_FONT_WEIGHT} ${px}px "${KEY_FONT_FAMILY}", sans-serif`;
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let fontSize = maxFontSize;
  for (; fontSize >= minFontSize; fontSize -= 1) {
    setFont(fontSize);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (
      widest <= safeWidth &&
      Math.round(fontSize * 1.08) * lines.length <= heightCap
    ) {
      break;
    }
  }
  setFont(fontSize);

  const lineHeight = Math.round(fontSize * 1.08);
  const totalHeight = lineHeight * lines.length;
  let y = Math.round(size / 2 - totalHeight / 2 + lineHeight / 2);

  ctx.fillStyle = color;
  for (const line of lines) {
    ctx.fillText(line, size / 2, y);
    y += lineHeight;
  }
}
