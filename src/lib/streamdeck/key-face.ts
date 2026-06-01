/**
 * Single source of truth for how a Stream Deck key FACE is drawn.
 *
 * The exact same routine paints:
 *   • the physical key (server-side, `@napi-rs/canvas` → `driver.ts`)
 *   • the on-screen mockup (browser `<canvas>` → `DeckKey.tsx`,
 *     `KeyFacePreview.tsx`)
 *   • the satellite's local key (mirror copy in
 *     `nexus-cross/src/key-face.ts` — that package can't import from
 *     here, so keep the two byte-for-byte identical when editing).
 *
 * Because all three call this one function with a structurally-shared
 * 2D context, a key looks the SAME whether you read it off the metal
 * or off the editor page — same font, same auto-fit + word-wrap, same
 * halo logic, same badge placement.
 *
 * Font: Barlow Semi Condensed (bundled, OFL) at MEDIUM weight. A
 * condensed, high-x-height UI face — short broadcast labels (PGM/PVW,
 * scene names) stay large and legible on a small key. Medium (not bold)
 * keeps multi-word labels crisp instead of clogged.
 */

/** Font family registered with the canvas engine + declared via
 *  `@font-face` in the browser. Keep both in lockstep with this name. */
export const KEY_FONT_FAMILY = "Barlow Semi Condensed";
/** Weight we render labels at — the bundled file we register for it.
 *  Medium reads cleaner than Bold on small / multi-word labels. */
export const KEY_FONT_WEIGHT = 500;

/** Minimal gradient handle — `addColorStop` is all the drawer calls. */
interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

/** The slice of the Canvas 2D API the face drawer touches. Both the DOM
 *  `CanvasRenderingContext2D` and `@napi-rs/canvas`'s `SKRSContext2D`
 *  satisfy this structurally, so one function drives both engines. */
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
  /** Square edge length in *logical* pixels. */
  size: number;
  bg: string;
  fg: string;
  /** Resolved label — may contain explicit `\n` for hard line breaks. */
  face: string;
  /** Top-right status marker. `icon: "offline"` draws a struck-through
   *  wi-fi glyph (the key's target connection isn't established); otherwise
   *  a plain dot with an optional centred symbol. */
  badge?: { color: string; symbol?: string; icon?: "offline" };
}

/**
 * Paint a full key face (background + auto-fit, word-wrapped label +
 * optional badge) into `ctx`, covering the `size × size` square from the
 * origin. The caller owns pixel-ratio scaling (scale the ctx before
 * calling) and any surrounding chrome (borders, selection rings).
 */
export function drawKeyFace(ctx: FaceCtx, opts: KeyFace): void {
  const { size, bg, fg, face, badge } = opts;

  // Background — a subtle vertical gradient derived from the chosen colour
  // (a touch lighter at the top, the base in the middle, a touch darker at
  // the bottom) so faces have a little depth instead of a flat, uniform
  // slab. Falls back to a solid fill if the colour isn't a parseable hex.
  ctx.fillStyle = backgroundFill(ctx, bg, size);
  ctx.fillRect(0, 0, size, size);

  // Label — plain fg on the background, no outline/shadow. Contrast is the
  // operator's call (they pick bg + fg).
  drawAutoFitText(ctx, face, size, fg);

  // Status marker, top-right.
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

/**
 * Top-right "no connection" glyph: a wi-fi fan (three arcs + a base dot)
 * with a diagonal slash through it. Drawn in `color` over a white
 * underlay so it reads on any face colour. Signals the key's target
 * connection isn't established — shown persistently, not on press.
 */
function drawOfflineIcon(ctx: FaceCtx, size: number, color: string): void {
  const cx = size * 0.82; // wi-fi apex (base dot) x — tucked into the corner
  const cy = size * 0.24; // wi-fi apex y
  const step = size * 0.05;
  ctx.lineCap = "round";

  // Three wi-fi arcs opening upward.
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, Math.round(size * 0.02));
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, step * i, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }
  // Base dot.
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.3, size * 0.013), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Diagonal slash — white underlay first for contrast, then the colour.
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

/** Parse a `#rgb`/`#rrggbb` colour to [r,g,b] (0..255), or null. */
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

/** Lighten (`amount > 0`, mix toward white) or darken (`amount < 0`, mix
 *  toward black) a hex colour by a fraction. Returns the input unchanged
 *  if it isn't a parseable hex. */
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

/** Subtlety of the face gradient: how far the top/bottom stops sit from
 *  the base colour. Kept gentle — depth, not a spotlight. */
const BG_LIGHTEN = 0.13;
const BG_DARKEN = -0.16;

/** Build the key-face background fill: a gentle diagonal gradient (top-left
 *  lighter → bottom-right darker) around the base colour, or the solid
 *  colour when it can't be parsed. */
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

/** CSS equivalent of `backgroundFill` for DOM elements that style their
 *  background with `background:` (e.g. the preset library tiles) — same
 *  gradient maths so they match the canvas-rendered keys. `135deg` runs
 *  top-left → bottom-right. Returns the raw value (which may be a CSS var)
 *  unchanged when it isn't a hex colour. */
export function keyBackgroundCss(bg: string): string {
  if (!parseRgb(bg)) return bg;
  return `linear-gradient(135deg, ${shadeColor(bg, BG_LIGHTEN)} 0%, ${bg} 50%, ${shadeColor(bg, BG_DARKEN)} 100%)`;
}

/**
 * Centered label, broken into lines ONLY where the user typed a newline.
 * We never auto-wrap — line breaks are the operator's call. Each explicit
 * line is auto-shrunk (largest first) until the widest fits the safe width
 * and the stack fits the height. Floor at 13 % so a long label degrades
 * rather than vanishes. Plain fill, no outline/shadow.
 */
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
