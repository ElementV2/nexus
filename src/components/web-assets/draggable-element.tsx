"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useOverlayEditorStore, getActiveOverlay } from "@/stores/overlay-editor-store";
import { MIN_ELEMENT_SIZE } from "@/lib/vmix/constants";
import { computeSnap } from "@/lib/web-assets/snap";
import type { OverlayElement } from "@/lib/web-assets/types";

type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const handleCursors: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

const handlePositions: Record<ResizeHandle, React.CSSProperties> = {
  n: { top: -4, left: "50%", marginLeft: -4 },
  s: { bottom: -4, left: "50%", marginLeft: -4 },
  e: { right: -4, top: "50%", marginTop: -4 },
  w: { left: -4, top: "50%", marginTop: -4 },
  ne: { top: -4, right: -4 },
  nw: { top: -4, left: -4 },
  se: { bottom: -4, right: -4 },
  sw: { bottom: -4, left: -4 },
};

interface DraggableElementProps {
  element: OverlayElement;
  scale: number;
  selected: boolean;
  onSelect: (multi: boolean) => void;
  children: React.ReactNode;
}

export function DraggableElement({
  element,
  scale,
  selected,
  onSelect,
  children,
}: DraggableElementProps) {
  const updateElement = useOverlayEditorStore((s) => s.updateElement);
  const pushUndo = useOverlayEditorStore((s) => s.pushUndo);
  const snapEnabled = useOverlayEditorStore((s) => s.snapEnabled);
  const setActiveSnapLines = useOverlayEditorStore((s) => s.setActiveSnapLines);
  const setActiveDistances = useOverlayEditorStore((s) => s.setActiveDistances);
  const clearSnapGuides = useOverlayEditorStore((s) => s.clearSnapGuides);

  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<ResizeHandle | null>(null);
  const dragStart = useRef({ x: 0, y: 0, ex: 0, ey: 0, ew: 0, eh: 0 });
  const undoPushed = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (element.locked) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect(e.shiftKey || e.ctrlKey || e.metaKey);
      setDragging(true);
      undoPushed.current = false;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ex: element.x,
        ey: element.y,
        ew: element.width,
        eh: element.height,
      };
    },
    [element, onSelect]
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, handle: ResizeHandle) => {
      if (element.locked) return;
      e.stopPropagation();
      e.preventDefault();
      setResizing(handle);
      undoPushed.current = false;
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ex: element.x,
        ey: element.y,
        ew: element.width,
        eh: element.height,
      };
    },
    [element]
  );

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMove = (e: PointerEvent) => {
      if (!undoPushed.current) {
        pushUndo();
        undoPushed.current = true;
      }

      const dx = (e.clientX - dragStart.current.x) / scale;
      const dy = (e.clientY - dragStart.current.y) / scale;
      const { ex, ey, ew, eh } = dragStart.current;

      if (dragging) {
        let newX = ex + dx;
        let newY = ey + dy;

        if (snapEnabled) {
          const overlay = getActiveOverlay();
          if (overlay) {
            const otherElements = overlay.elements.filter(
              (el) => el.id !== element.id
            );
            const result = computeSnap(
              { x: newX, y: newY, width: ew, height: eh },
              otherElements
            );
            newX = result.x;
            newY = result.y;
            setActiveSnapLines(result.snapLines);
            setActiveDistances(result.distances);
          }
        }

        updateElement(element.id, { x: newX, y: newY });
      } else if (resizing) {
        let newX = ex, newY = ey, newW = ew, newH = eh;

        if (resizing.includes("e")) newW = Math.max(MIN_ELEMENT_SIZE, ew + dx);
        if (resizing.includes("w")) {
          newW = Math.max(MIN_ELEMENT_SIZE, ew - dx);
          if (newW > MIN_ELEMENT_SIZE) newX = ex + dx;
        }
        if (resizing.includes("s")) newH = Math.max(MIN_ELEMENT_SIZE, eh + dy);
        if (resizing.includes("n")) {
          newH = Math.max(MIN_ELEMENT_SIZE, eh - dy);
          if (newH > MIN_ELEMENT_SIZE) newY = ey + dy;
        }

        if (snapEnabled) {
          const overlay = getActiveOverlay();
          if (overlay) {
            const otherElements = overlay.elements.filter(
              (el) => el.id !== element.id
            );
            const result = computeSnap(
              { x: newX, y: newY, width: newW, height: newH },
              otherElements
            );
            // Apply snap adjustments
            if (result.x !== newX) {
              if (resizing.includes("w")) {
                newW += newX - result.x;
                newX = result.x;
              } else {
                newW += result.x - newX;
                newX = result.x;
              }
            }
            if (result.y !== newY) {
              if (resizing.includes("n")) {
                newH += newY - result.y;
                newY = result.y;
              } else {
                newH += result.y - newY;
                newY = result.y;
              }
            }
            setActiveSnapLines(result.snapLines);
            setActiveDistances(result.distances);
          }
        }

        updateElement(element.id, {
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        });
      }
    };

    const handleUp = () => {
      setDragging(false);
      setResizing(null);
      clearSnapGuides();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [
    dragging,
    resizing,
    scale,
    element.id,
    updateElement,
    pushUndo,
    snapEnabled,
    setActiveSnapLines,
    setActiveDistances,
    clearSnapGuides,
  ]);

  return (
    <div
      className="absolute"
      style={{
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.zIndex,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        pointerEvents: element.locked ? "none" : undefined,
        opacity: element.visible ? 1 : 0.3,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Element content */}
      <div
        className="w-full h-full"
        style={{
          cursor: element.locked
            ? "default"
            : dragging
            ? "grabbing"
            : "grab",
        }}
        onPointerDown={handlePointerDown}
      >
        {children}
      </div>

      {/* Selection border — amber per spec (user-focus accent) */}
      {selected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ border: "2px solid var(--amber)" }}
        />
      )}

      {/* Resize handles */}
      {selected && !element.locked && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              className="absolute z-10"
              style={{
                width: 8,
                height: 8,
                background: "var(--amber)",
                border: "1px solid var(--bg)",
                cursor: handleCursors[h],
                ...handlePositions[h],
              }}
              onPointerDown={(e) => handleResizeStart(e, h)}
            />
          ))}
        </>
      )}
    </div>
  );
}
