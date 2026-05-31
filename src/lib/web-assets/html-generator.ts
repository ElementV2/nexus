import type { OverlayConfig, HoleElement, TextElement, ImageElement } from "./types";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escape a fully-assembled inline-style string for safe interpolation
 * into a double-quoted `style="..."` attribute. Element style values
 * (color, font-family, background-image url, …) come from user config
 * and were previously interpolated raw — a value containing `"` or `>`
 * could break out of the attribute / tag and inject markup. Escaping the
 * whole style string closes that: the browser HTML-decodes the attribute
 * before parsing CSS, so legitimate values (e.g. quoted font names) still
 * work while breakout characters are neutralised.
 */
/**
 * Sanitize a URL for use inside a CSS `url('…')`. HTML-escaping the whole
 * style string stops attribute/tag breakout but NOT CSS metacharacters
 * (`)` `;` `'`) which could inject extra declarations. Strip those + only
 * allow http(s)/data:image URLs (emitted inside single quotes). Returns ""
 * if unsafe so the caller omits the background entirely.
 */
function safeCssUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.replace(/['")\\\r\n]/g, "").trim();
  return /^(https?:\/\/|data:image\/)/i.test(v) ? v : "";
}

function escapeStyleAttr(style: string): string {
  return escapeHtml(style);
}

function generateHoleCSS(el: HoleElement): string {
  const styles: string[] = [
    `position: absolute`,
    `left: ${el.x}px`,
    `top: ${el.y}px`,
    `width: ${el.width}px`,
    `height: ${el.height}px`,
    `z-index: ${el.zIndex}`,
  ];
  if (el.rotation) styles.push(`transform: rotate(${el.rotation}deg)`);
  if (el.borderRadius) styles.push(`border-radius: ${el.borderRadius}px`);
  if (el.borderWidth > 0) {
    styles.push(`border: ${el.borderWidth}px solid ${el.borderColor}`);
  }
  return styles.join("; ");
}

function generateTextHTML(el: TextElement): string {
  const styles: string[] = [
    `position: absolute`,
    `left: ${el.x}px`,
    `top: ${el.y}px`,
    `width: ${el.width}px`,
    `height: ${el.height}px`,
    `z-index: ${el.zIndex}`,
    `font-family: ${el.fontFamily}`,
    `font-size: ${el.fontSize}px`,
    `font-weight: ${el.fontWeight}`,
    `color: ${el.color}`,
    `text-align: ${el.textAlign}`,
    `line-height: ${el.lineHeight}`,
    `display: flex`,
    `align-items: center`,
    `overflow: hidden`,
    `word-break: break-word`,
    `white-space: pre-wrap`,
  ];

  if (el.backgroundColor && el.backgroundColor !== "transparent") {
    styles.push(`background-color: ${el.backgroundColor}`);
  }
  if (el.rotation) styles.push(`transform: rotate(${el.rotation}deg)`);

  const justify =
    el.textAlign === "center"
      ? "center"
      : el.textAlign === "right"
      ? "flex-end"
      : "flex-start";
  styles.push(`justify-content: ${justify}`);

  if (el.shadowBlur > 0 || el.shadowOffsetX || el.shadowOffsetY) {
    styles.push(
      `text-shadow: ${el.shadowOffsetX}px ${el.shadowOffsetY}px ${el.shadowBlur}px ${el.shadowColor}`
    );
  }
  if (el.strokeWidth > 0) {
    styles.push(`-webkit-text-stroke: ${el.strokeWidth}px ${el.strokeColor}`);
  }

  return `<div style="${escapeStyleAttr(styles.join("; "))}">${escapeHtml(el.content)}</div>`;
}

function generateImageHTML(el: ImageElement): string {
  const styles: string[] = [
    `position: absolute`,
    `left: ${el.x}px`,
    `top: ${el.y}px`,
    `width: ${el.width}px`,
    `height: ${el.height}px`,
    `z-index: ${el.zIndex}`,
    `object-fit: ${el.objectFit}`,
  ];
  if (el.opacity < 1) styles.push(`opacity: ${el.opacity}`);
  if (el.borderRadius) styles.push(`border-radius: ${el.borderRadius}px`);
  if (el.borderWidth > 0) {
    styles.push(`border: ${el.borderWidth}px solid ${el.borderColor}`);
  }
  if (el.rotation) styles.push(`transform: rotate(${el.rotation}deg)`);

  return `<img src="${escapeHtml(el.src)}" style="${escapeStyleAttr(styles.join("; "))}" />`;
}

export function generateOverlayHTML(config: OverlayConfig): string {
  const sortedElements = [...config.elements]
    .filter((e) => e.visible)
    .sort((a, b) => a.zIndex - b.zIndex);

  // Separate holes from other elements
  const holes = sortedElements.filter((e) => e.type === "hole") as HoleElement[];
  const otherElements = sortedElements.filter((e) => e.type !== "hole");

  // Build CSS clip-path with path() + evenodd for true transparency
  let clipStyle = "";
  if (holes.length > 0) {
    let d = "M0,0 H1920 V1080 H0 Z";
    for (const h of holes) {
      const rx = Math.min(h.borderRadius || 0, h.width / 2, h.height / 2);
      if (rx > 0) {
        d += ` M${h.x + rx},${h.y}`;
        d += ` H${h.x + h.width - rx}`;
        d += ` A${rx},${rx} 0 0 1 ${h.x + h.width},${h.y + rx}`;
        d += ` V${h.y + h.height - rx}`;
        d += ` A${rx},${rx} 0 0 1 ${h.x + h.width - rx},${h.y + h.height}`;
        d += ` H${h.x + rx}`;
        d += ` A${rx},${rx} 0 0 1 ${h.x},${h.y + h.height - rx}`;
        d += ` V${h.y + rx}`;
        d += ` A${rx},${rx} 0 0 1 ${h.x + rx},${h.y}`;
        d += ` Z`;
      } else {
        d += ` M${h.x},${h.y} H${h.x + h.width} V${h.y + h.height} H${h.x} Z`;
      }
    }
    clipStyle = ` clip-path: path(evenodd, "${d}");`;
  }

  // Background styles
  const bgStyles: string[] = [
    `position: absolute`,
    `top: 0`,
    `left: 0`,
    `width: 1920px`,
    `height: 1080px`,
    `background-color: ${config.backgroundColor}`,
  ];
  const bgUrl = safeCssUrl(config.backgroundImageUrl);
  if (bgUrl) {
    bgStyles.push(`background-image: url('${bgUrl}')`);
    bgStyles.push(`background-size: cover`);
  }

  // Texture overlay
  let textureDiv = "";
  const texUrl = safeCssUrl(config.textureUrl);
  if (texUrl) {
    const texStyles = [
      `position: absolute; top: 0; left: 0; width: 1920px; height: 1080px`,
      `background-image: url('${texUrl}')`,
      `background-size: cover`,
      `mix-blend-mode: ${config.blendMode}`,
      `opacity: ${config.textureOpacity}`,
      `pointer-events: none`,
    ];
    textureDiv = `\n    <div style="${escapeStyleAttr(texStyles.join("; "))}"></div>`;
  }

  // Non-hole element HTML (text, images)
  const elementsHtml = otherElements
    .map((el) => {
      switch (el.type) {
        case "text":
          return `    ${generateTextHTML(el as TextElement)}`;
        case "image":
          return `    ${generateImageHTML(el as ImageElement)}`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");

  // Hole borders rendered OUTSIDE the masked container
  const holeBorders = holes
    .filter((h) => h.borderWidth > 0)
    .map(
      (h) =>
        `  <div style="${escapeStyleAttr(generateHoleCSS(h))}"></div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: transparent;
    }
  </style>
</head>
<body>
  <div style="position: absolute; top: 0; left: 0; width: 1920px; height: 1080px;${clipStyle}">
    <div style="${escapeStyleAttr(bgStyles.join("; "))}"></div>${textureDiv}
${elementsHtml}
  </div>
${holeBorders}
</body>
</html>`;
}
