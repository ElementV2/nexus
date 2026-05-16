import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";
import type { OverlayConfig, HoleElement, TextElement, ImageElement } from "./types";

async function loadImage(src: string): Promise<HTMLImageElement> {
  // Proxy external images through our API to avoid CORS
  const proxiedSrc = src.startsWith("data:") || src.startsWith("blob:")
    ? src
    : `/api/proxy-image?url=${encodeURIComponent(src)}`;

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = proxiedSrc;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draw image with CSS background-size:cover / object-fit:cover logic */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  posX = 0.5, posY = 0.5, // 0=top/left, 0.5=center, 1=bottom/right
) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = dw / dh;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (imgRatio > boxRatio) {
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) * posX;
  } else {
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) * posY;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawImageElement(ctx: CanvasRenderingContext2D, el: ImageElement, img: HTMLImageElement) {
  ctx.save();

  // Rotation
  if (el.rotation) {
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
  }

  ctx.globalAlpha = el.opacity;

  // Clip to border radius
  if (el.borderRadius > 0) {
    roundRect(ctx, el.x, el.y, el.width, el.height, el.borderRadius);
    ctx.clip();
  }

  // Draw image with objectFit
  if (el.objectFit === "cover") {
    drawCover(ctx, img, el.x, el.y, el.width, el.height);
  } else if (el.objectFit === "contain") {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const elRatio = el.width / el.height;
    let dw = el.width, dh = el.height, dx = el.x, dy = el.y;
    if (imgRatio > elRatio) {
      dh = el.width / imgRatio;
      dy = el.y + (el.height - dh) / 2;
    } else {
      dw = el.height * imgRatio;
      dx = el.x + (el.width - dw) / 2;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.drawImage(img, el.x, el.y, el.width, el.height);
  }

  // Border
  if (el.borderWidth > 0) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = el.borderWidth;
    roundRect(ctx, el.x, el.y, el.width, el.height, el.borderRadius);
    ctx.stroke();
  }

  ctx.restore();
}

function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement) {
  ctx.save();

  if (el.rotation) {
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
  }

  // Background
  if (el.backgroundColor && el.backgroundColor !== "transparent") {
    ctx.fillStyle = el.backgroundColor;
    ctx.fillRect(el.x, el.y, el.width, el.height);
  }

  const fontSize = el.fontSize;
  ctx.font = `${el.fontWeight} ${fontSize}px ${el.fontFamily}`;
  ctx.textBaseline = "top";
  ctx.textAlign = el.textAlign;

  const lineH = fontSize * el.lineHeight;
  const lines = el.content.split("\n");

  let tx = el.x;
  if (el.textAlign === "center") tx = el.x + el.width / 2;
  else if (el.textAlign === "right") tx = el.x + el.width;

  const totalH = lines.length * lineH;
  const startY = el.y + (el.height - totalH) / 2;

  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineH;

    // Shadow
    if (el.shadowBlur > 0 || el.shadowOffsetX || el.shadowOffsetY) {
      ctx.shadowColor = el.shadowColor;
      ctx.shadowBlur = el.shadowBlur;
      ctx.shadowOffsetX = el.shadowOffsetX;
      ctx.shadowOffsetY = el.shadowOffsetY;
    }

    // Stroke
    if (el.strokeWidth > 0) {
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth * 2;
      ctx.lineJoin = "round";
      ctx.strokeText(lines[i], tx, ly);
    }

    // Fill
    ctx.fillStyle = el.color;
    ctx.fillText(lines[i], tx, ly);

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.restore();
}

function drawHoleElement(ctx: CanvasRenderingContext2D, el: HoleElement) {
  ctx.save();

  if (el.rotation) {
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
  }

  // Punch transparent hole
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  if (el.borderRadius > 0) {
    roundRect(ctx, el.x, el.y, el.width, el.height, el.borderRadius);
    ctx.fill();
  } else {
    ctx.fillRect(el.x, el.y, el.width, el.height);
  }

  // Draw border back on top
  ctx.globalCompositeOperation = "source-over";
  if (el.borderWidth > 0) {
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = el.borderWidth;
    roundRect(ctx, el.x, el.y, el.width, el.height, el.borderRadius);
    ctx.stroke();
  }

  ctx.restore();
}

export async function exportOverlayPng(overlay: OverlayConfig): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = ASSET_WIDTH;
  canvas.height = ASSET_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // 1. Background color
  ctx.fillStyle = overlay.backgroundColor;
  ctx.fillRect(0, 0, ASSET_WIDTH, ASSET_HEIGHT);

  // 2. Background image (CSS background-size:cover, default position 0% 0%)
  if (overlay.backgroundImageUrl) {
    try {
      const bgImg = await loadImage(overlay.backgroundImageUrl);
      drawCover(ctx, bgImg, 0, 0, ASSET_WIDTH, ASSET_HEIGHT, 0, 0);
    } catch { /* ignore failed bg image */ }
  }

  // 3. Texture overlay
  if (overlay.textureUrl) {
    try {
      const texImg = await loadImage(overlay.textureUrl);
      ctx.save();
      ctx.globalAlpha = overlay.textureOpacity;
      ctx.globalCompositeOperation = overlay.blendMode as GlobalCompositeOperation;
      ctx.drawImage(texImg, 0, 0, ASSET_WIDTH, ASSET_HEIGHT);
      ctx.restore();
    } catch { /* ignore failed texture */ }
  }

  // 4. Render elements in z-order
  const sorted = [...overlay.elements]
    .filter((e) => e.visible)
    .sort((a, b) => a.zIndex - b.zIndex);

  // Pre-load all images
  const imageCache = new Map<string, HTMLImageElement>();
  for (const el of sorted) {
    if (el.type === "image" && el.src) {
      try {
        imageCache.set(el.src, await loadImage(el.src));
      } catch { /* skip broken images */ }
    }
  }

  for (const el of sorted) {
    switch (el.type) {
      case "image": {
        const img = imageCache.get(el.src);
        if (img) drawImageElement(ctx, el, img);
        break;
      }
      case "text":
        drawTextElement(ctx, el);
        break;
      case "hole":
        drawHoleElement(ctx, el);
        break;
    }
  }

  // 5. Download
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${overlay.name}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
