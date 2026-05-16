import sharp from "sharp";
import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";
import type { Hole } from "./types";

interface GenerateOptions {
  backgroundColor: string;
  backgroundImageUrl?: string | null;
  textureUrl?: string | null;
  textureOpacity?: number;
  holes: Hole[];
}

function hexToRgba(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

export async function generateAssetPng(options: GenerateOptions): Promise<Buffer> {
  const { backgroundColor, holes } = options;
  const { r, g, b } = hexToRgba(backgroundColor);

  // Create base image with background color
  const image = sharp({
    create: {
      width: ASSET_WIDTH,
      height: ASSET_HEIGHT,
      channels: 4,
      background: { r, g, b, alpha: 255 },
    },
  }).png();

  // Get raw buffer to punch holes
  const rawBuffer = await image.raw().toBuffer();

  // Punch transparent holes
  for (const hole of holes) {
    const x1 = Math.max(0, Math.floor(hole.x));
    const y1 = Math.max(0, Math.floor(hole.y));
    const x2 = Math.min(ASSET_WIDTH, Math.ceil(hole.x + hole.width));
    const y2 = Math.min(ASSET_HEIGHT, Math.ceil(hole.y + hole.height));

    for (let py = y1; py < y2; py++) {
      for (let px = x1; px < x2; px++) {
        const idx = (py * ASSET_WIDTH + px) * 4;
        rawBuffer[idx + 3] = 0; // Set alpha to 0 (transparent)
      }
    }
  }

  // Convert back to PNG
  return sharp(rawBuffer, {
    raw: {
      width: ASSET_WIDTH,
      height: ASSET_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}
