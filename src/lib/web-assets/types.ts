// ── Base element shared by all overlay element types ──
export interface BaseElement {
  id: string;
  type: "hole" | "text" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  name: string;
}

// ── Hole (transparent cutout) ──
export interface HoleElement extends BaseElement {
  type: "hole";
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
}

// ── Text ──
export interface TextElement extends BaseElement {
  type: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  strokeColor: string;
  strokeWidth: number;
}

// ── Image ──
export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  objectFit: "cover" | "contain" | "fill" | "none";
  opacity: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
}

// ── Discriminated union ──
export type OverlayElement = HoleElement | TextElement | ImageElement;

// ── Overlay configuration ──
export interface OverlayConfig {
  id: string;
  name: string;
  backgroundType: "color" | "image";
  backgroundColor: string;
  backgroundImageUrl: string | null;
  textureUrl: string | null;
  blendMode: string;
  textureOpacity: number;
  elements: OverlayElement[];
}

// ── Legacy types (kept for migration) ──
export interface Hole {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
}

export interface WebAssetConfig {
  name: string;
  backgroundType: "color" | "image";
  backgroundColor: string;
  backgroundImageUrl: string | null;
  textureUrl: string | null;
  blendMode: string;
  textureOpacity: number;
  holes: Hole[];
}
