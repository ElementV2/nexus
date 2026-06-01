"use client";

import { useEffect, useRef } from "react";
import { drawKeyFace, type FaceCtx } from "@/lib/streamdeck/key-face";
import { whenKeyFontReady } from "./key-font";

interface KeyFacePreviewProps {
  bg: string;
  fg: string;
  face: string;
  badge?: { color: string; symbol?: string; icon?: "offline" };
  /** Logical edge length in px. */
  size?: number;
  radius?: number;
  style?: React.CSSProperties;
}

/**
 * A fixed-size key-face thumbnail painted by the SAME shared `drawKeyFace`
 * the hardware + deck grid use — so any "what will this key look like"
 * preview (inspector, dialogs) matches the physical deck exactly: same
 * font, auto-fit sizing, stroke halo, badge. Redraws when its inputs
 * change and once the bundled font finishes loading.
 */
export function KeyFacePreview({
  bg,
  fg,
  face,
  badge,
  size = 88,
  radius = 8,
  style,
}: KeyFacePreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const badgeColor = badge?.color;
  const badgeSymbol = badge?.symbol;
  const badgeIcon = badge?.icon;
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.round(size * dpr);
      cvs.height = Math.round(size * dpr);
      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawKeyFace(ctx as unknown as FaceCtx, {
        size,
        bg,
        fg,
        face,
        badge:
          badgeColor !== undefined
            ? { color: badgeColor, symbol: badgeSymbol, icon: badgeIcon }
            : undefined,
      });
    };
    paint();
    void whenKeyFontReady().then(paint);
    return () => {
      cancelled = true;
    };
  }, [bg, fg, face, badgeColor, badgeSymbol, badgeIcon, size]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={face}
      style={{ width: size, height: size, borderRadius: radius, ...style }}
    />
  );
}
