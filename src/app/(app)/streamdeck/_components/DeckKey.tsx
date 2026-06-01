"use client";

import { memo, useEffect, useRef } from "react";
import type { DeckBinding } from "@/lib/db/streamdeck";
import type { FeedbackOverride } from "@/lib/streamdeck/feedback";
import {
  drawKeyFace,
  KEY_FONT_FAMILY,
  KEY_FONT_WEIGHT,
  type FaceCtx,
} from "@/lib/streamdeck/key-face";
import type { FireState } from "./types";

interface DeckKeyProps {
  index: number;
  binding: DeckBinding | undefined;
  override: FeedbackOverride | null;
  hovered: boolean;
  selected: boolean;
  fire: FireState;
  // Index-bound stable handlers (the index is passed at call time so
  // the parent can hand every cell the SAME function reference).
  onDragOver: (i: number, e: React.DragEvent) => void;
  onDragLeave: (i: number) => void;
  onDrop: (i: number, e: React.DragEvent) => void;
  onSelect: (i: number) => void;
}

/** True when `fire` is relevant to THIS key — so the memo comparator can
 *  ignore fire-state churn on other keys. */
function fireRelevant(fire: FireState, index: number): string {
  return fire.kind !== "idle" && fire.keyIndex === index ? fire.kind : "idle";
}

/** Custom memo comparator: re-render a cell only when its OWN visual
 *  inputs change. `override` is a fresh object each parent render even
 *  when unchanged, so we field-compare it; the handlers are stable refs
 *  and intentionally ignored. */
function deckKeyEqual(a: DeckKeyProps, b: DeckKeyProps): boolean {
  if (
    a.index !== b.index ||
    a.binding !== b.binding ||
    a.hovered !== b.hovered ||
    a.selected !== b.selected
  ) {
    return false;
  }
  if (fireRelevant(a.fire, a.index) !== fireRelevant(b.fire, b.index)) {
    return false;
  }
  const ao = a.override;
  const bo = b.override;
  if (!!ao !== !!bo) return false;
  if (ao && bo) {
    if (
      ao.bgcolor !== bo.bgcolor ||
      ao.fgcolor !== bo.fgcolor ||
      ao.text !== bo.text
    ) {
      return false;
    }
    const ab = ao.badge;
    const bb = bo.badge;
    if (!!ab !== !!bb) return false;
    if (
      ab &&
      bb &&
      (ab.color !== bb.color || ab.symbol !== bb.symbol || ab.icon !== bb.icon)
    ) {
      return false;
    }
  }
  return true;
}

export const DeckKey = memo(function DeckKey({
  index,
  binding,
  override,
  hovered,
  selected,
  fire,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelect,
}: DeckKeyProps) {
  const isFiring = fire.kind === "running" && fire.keyIndex === index;
  const justOk = fire.kind === "ok" && fire.keyIndex === index;
  const justErr = fire.kind === "err" && fire.keyIndex === index;

  // Feedback override beats the preset's static face — same precedence
  // the hardware composer uses, so what you see here is what the
  // physical key shows.
  const bg = override?.bgcolor ?? binding?.preset.bgcolor ?? "#0a0a0a";
  const fg = override?.fgcolor ?? binding?.preset.fgcolor ?? "#3a3a3c";
  const face =
    override?.text ?? binding?.preset.text ?? binding?.preset.label ?? "";
  const badge = override?.badge;

  // Paint the key face on a real <canvas> with the SAME shared drawer the
  // hardware uses — so the on-screen mockup matches the physical deck
  // exactly (font, auto-fit sizing, stroke halo, badge). Redraws only when
  // this key's visual inputs change; ring/hover/fire are CSS on the wrapper
  // and don't touch the canvas. Waits for the bundled font before drawing
  // so glyph metrics match the deck.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const badgeColor = badge?.color;
  const badgeSymbol = badge?.symbol;
  const badgeIcon = badge?.icon;
  useEffect(() => {
    if (!binding) return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const rect = cvs.getBoundingClientRect();
      const sizePx = Math.round(rect.width) || 84;
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.round(sizePx * dpr);
      cvs.height = Math.round(sizePx * dpr);
      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawKeyFace(ctx as unknown as FaceCtx, {
        size: sizePx,
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
    // Redraw once the web font is ready (first mount): the initial paint may
    // land before Barlow loads, which would mis-measure the auto-fit.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      fonts
        .load(`${KEY_FONT_WEIGHT} 16px "${KEY_FONT_FAMILY}"`)
        .then(paint)
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [binding, bg, fg, face, badgeColor, badgeSymbol, badgeIcon]);

  return (
    <div
      // Bound keys are draggable so the operator can rearrange the
      // layout in-place (move to an empty slot or swap with another
      // bound key). The drop handler upstream detects the
      // `x-nexus-deckkey` marker and routes accordingly. Empty keys
      // stay non-draggable — there's nothing to move.
      draggable={!!binding}
      onDragStart={
        binding
          ? (e) => {
              // `copyMove` accepts both effects at the target:
              // browser-tile drops use `copy`, intra-deck drops use
              // `move`. Setting `move` only would make the browser
              // reject any `copy`-flagged dragover, breaking
              // cross-source drops in ways that aren't obvious.
              e.dataTransfer.effectAllowed = "copyMove";
              // Both payloads: the marker drives the move/swap
              // branch upstream; the preset payload is a fallback
              // for drops landing on a non-deck target.
              e.dataTransfer.setData(
                "application/x-nexus-deckkey",
                JSON.stringify({ sourceIndex: index })
              );
              e.dataTransfer.setData(
                "application/x-nexus-preset",
                JSON.stringify(binding.preset)
              );
              e.dataTransfer.setData(
                "text/plain",
                `${binding.preset.kind}:${binding.preset.id}@key${index}`
              );
            }
          : undefined
      }
      onDragOver={(e) => onDragOver(index, e)}
      onDragLeave={() => onDragLeave(index)}
      onDrop={(e) => onDrop(index, e)}
      onClick={() => onSelect(index)}
      // Suppress the native context menu, but DON'T clear on right-click —
      // clearing is the Delete key (or the inspector's Clear button) so a
      // stray right-click never wipes a shortcut.
      onContextMenu={(e) => e.preventDefault()}
      title={
        binding
          ? `${binding.preset.kind}:${binding.preset.id}\nClick: select for editing\nDrag: move / swap\nDelete: clear`
          : `Key ${index} — drop a preset here, click to select`
      }
      className="relative flex flex-col items-center justify-center text-center overflow-hidden"
      style={{
        background: bg,
        color: fg,
        borderRadius: 8,
        // Selected gets a persistent amber ring; hovered (drag) cyan
        // ring takes precedence so the drop target is unambiguous
        // during an active drag.
        border: hovered
          ? "2px solid var(--cyan)"
          : selected
            ? "2px solid var(--amber)"
            : "1px solid rgba(255,255,255,0.06)",
        outline: justOk
          ? "2px solid var(--pvw)"
          : justErr
            ? "2px solid var(--pgm)"
            : "none",
        outlineOffset: -1,
        boxShadow: binding
          ? "0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "inset 0 1px 0 rgba(255,255,255,0.02)",
        // `grab` on bound keys hints the move affordance; falls back
        // to `pointer` while firing or `copy` when a drag is over an
        // empty key.
        cursor: binding ? "grab" : hovered ? "copy" : "default",
        opacity: isFiring ? 0.6 : 1,
        transform: isFiring ? "scale(0.95)" : "none",
        transition: "transform 120ms, opacity 120ms, outline 120ms",
        padding: binding ? 0 : 6,
      }}
    >
      {binding ? (
        // The face (bg + label + badge) is painted by the shared drawer —
        // byte-identical to the physical key. Full-bleed over the cell;
        // the wrapper's border/ring/shadow ride on top. pointer-events off
        // so drag/click still hit the wrapper.
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={face || `Key ${index + 1}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            borderRadius: 8,
            pointerEvents: "none",
          }}
        />
      ) : (
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.18em",
            opacity: hovered ? 0.8 : 0.25,
            textTransform: "uppercase",
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
          }}
        >
          {hovered ? "drop" : String(index + 1).padStart(2, "0")}
        </span>
      )}
    </div>
  );
}, deckKeyEqual);
