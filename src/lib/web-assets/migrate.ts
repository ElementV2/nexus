import type { OverlayConfig, OverlayElement, HoleElement } from "./types";
import { createId } from "@/lib/utils/id";

interface LegacyHole {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
}

interface LegacyAsset {
  name: string;
  backgroundType: "color" | "image";
  backgroundColor: string;
  backgroundImageUrl: string | null;
  textureUrl: string | null;
  blendMode: string;
  textureOpacity: number;
  holes: LegacyHole[];
}

export function migrateLegacyAsset(legacy: LegacyAsset): OverlayConfig {
  const elements: OverlayElement[] = legacy.holes.map(
    (hole, i): HoleElement => ({
      id: hole.id,
      type: "hole",
      x: hole.x,
      y: hole.y,
      width: hole.width,
      height: hole.height,
      rotation: 0,
      locked: false,
      visible: true,
      zIndex: i,
      name: `Hole ${i + 1}`,
      borderColor: hole.borderColor,
      borderWidth: hole.borderWidth,
      borderRadius: 0,
    })
  );

  return {
    id: createId(),
    name: legacy.name,
    backgroundType: legacy.backgroundType,
    backgroundColor: legacy.backgroundColor,
    backgroundImageUrl: legacy.backgroundImageUrl,
    textureUrl: legacy.textureUrl,
    blendMode: legacy.blendMode,
    textureOpacity: legacy.textureOpacity,
    elements,
  };
}

/** Detect if stored data uses old format (has `holes` key) */
export function isLegacyFormat(data: unknown): data is LegacyAsset[] {
  if (!Array.isArray(data)) return false;
  return data.length > 0 && "holes" in data[0] && !("elements" in data[0]);
}

export function migrateIfNeeded(data: unknown): OverlayConfig[] | null {
  if (isLegacyFormat(data)) {
    return data.map(migrateLegacyAsset);
  }
  return null;
}
