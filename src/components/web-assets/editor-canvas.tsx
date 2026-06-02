"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { useCanvasScale } from "@/hooks/use-canvas-scale";
import { useOverlayEditorStore, selectActiveOverlay } from "@/stores/overlay-editor-store";
import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";
import { DraggableElement } from "./draggable-element";
import { HoleElementView } from "./elements/hole-element";
import { TextElementView } from "./elements/text-element";
import { ImageElementView } from "./elements/image-element";
import { SnapGuides } from "./snap-guides";
import { DistanceIndicators } from "./distance-indicators";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import type { OverlayElement, HoleElement, TextElement, ImageElement } from "@/lib/web-assets/types";
import { createId } from "@/lib/utils/id";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

export function EditorCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitScale = useCanvasScale(containerRef);

  // Zoom & pan state
  const [zoom, setZoom] = useState<number | null>(null); // null = fit mode
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const spaceDown = useRef(false);
  const [grabCursor, setGrabCursor] = useState(false);

  // Effective scale: if zoom is null, use fitScale (fit-to-view)
  const scale = zoom ?? fitScale ?? 0.5;
  const ready = fitScale !== null;

  // Space key for panning
  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceDown.current = true;
        setGrabCursor(true);
      }
    }
    function onUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        spaceDown.current = false;
        if (!isPanning.current) setGrabCursor(false);
      }
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  // Wheel zoom — zoom toward cursor. Bound as a NATIVE non-passive
  // listener (see effect below): React attaches `wheel` passively, so an
  // onWheel handler can't preventDefault (it's ignored + logs a browser
  // warning). A native { passive: false } listener can.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!containerRef.current) return;
      e.preventDefault();

      const rect = containerRef.current.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const oldZoom = zoom ?? fitScale ?? 0.5;
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom + delta * oldZoom));

      // Zoom toward cursor
      const ratio = newZoom / oldZoom;
      const cx = rect.width / 2 + pan.x;
      const cy = rect.height / 2 + pan.y;
      const newPanX = pan.x - (cursorX - cx) * (ratio - 1);
      const newPanY = pan.y - (cursorY - cy) * (ratio - 1);

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    },
    [zoom, fitScale, pan]
  );

  // Attach the wheel handler natively as non-passive so preventDefault()
  // actually suppresses page scroll while zooming (React's onWheel is
  // passive). Re-binds when the handler closure changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Pan — middle mouse or space+left click
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
        e.preventDefault();
        isPanning.current = true;
        setGrabCursor(true);
        panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [pan]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
    if (!spaceDown.current) setGrabCursor(false);
  }, []);

  // Fit to view
  const fitToView = useCallback(() => {
    setZoom(null);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    const cur = zoom ?? fitScale ?? 0.5;
    setZoom(Math.min(MAX_ZOOM, cur + ZOOM_STEP * cur));
  }, [zoom, fitScale]);

  const zoomOut = useCallback(() => {
    const cur = zoom ?? fitScale ?? 0.5;
    setZoom(Math.max(MIN_ZOOM, cur - ZOOM_STEP * cur));
  }, [zoom, fitScale]);

  const overlay = useOverlayEditorStore(selectActiveOverlay);
  const selectedIds = useOverlayEditorStore((s) => s.selectedElementIds);
  const activeTool = useOverlayEditorStore((s) => s.activeTool);
  const addElement = useOverlayEditorStore((s) => s.addElement);
  const deselectAll = useOverlayEditorStore((s) => s.deselectAll);
  const selectElement = useOverlayEditorStore((s) => s.selectElement);
  const activeSnapLines = useOverlayEditorStore((s) => s.activeSnapLines);
  const activeDistances = useOverlayEditorStore((s) => s.activeDistances);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvasBg) {
        deselectAll();
      }
    },
    [deselectAll]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!overlay) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      const maxZ = overlay.elements.reduce((max, el) => Math.max(max, el.zIndex), -1);

      if (activeTool === "hole" || activeTool === "select") {
        const hole: HoleElement = {
          id: createId(),
          type: "hole",
          x: x - 100,
          y: y - 75,
          width: 200,
          height: 150,
          rotation: 0,
          locked: false,
          visible: true,
          zIndex: maxZ + 1,
          name: `Hole ${overlay.elements.filter((e) => e.type === "hole").length + 1}`,
          borderColor: "#FFFFFF",
          borderWidth: 0,
          borderRadius: 0,
        };
        addElement(hole);
      } else if (activeTool === "text") {
        const text: TextElement = {
          id: createId(),
          type: "text",
          x: x - 100,
          y: y - 20,
          width: 200,
          height: 40,
          rotation: 0,
          locked: false,
          visible: true,
          zIndex: maxZ + 1,
          name: `Text ${overlay.elements.filter((e) => e.type === "text").length + 1}`,
          content: "Double-click to edit",
          fontFamily: "Inter, sans-serif",
          fontSize: 24,
          fontWeight: 600,
          color: "#FFFFFF",
          backgroundColor: "transparent",
          textAlign: "center",
          lineHeight: 1.2,
          shadowColor: "rgba(0,0,0,0.5)",
          shadowBlur: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          strokeColor: "#000000",
          strokeWidth: 0,
        };
        addElement(text);
      } else if (activeTool === "image") {
        const img: ImageElement = {
          id: createId(),
          type: "image",
          x: x - 100,
          y: y - 75,
          width: 200,
          height: 150,
          rotation: 0,
          locked: false,
          visible: true,
          zIndex: maxZ + 1,
          name: `Image ${overlay.elements.filter((e) => e.type === "image").length + 1}`,
          src: "",
          objectFit: "cover",
          opacity: 1,
          borderRadius: 0,
          borderColor: "#FFFFFF",
          borderWidth: 0,
        };
        addElement(img);
      }
    },
    [overlay, activeTool, addElement, scale]
  );

  const renderElement = (element: OverlayElement) => {
    if (!element.visible) return null;
    switch (element.type) {
      case "hole":
        return <HoleElementView element={element} />;
      case "text":
        return <TextElementView element={element} selected={selectedIds.includes(element.id)} />;
      case "image":
        return <ImageElementView element={element} />;
    }
  };

  const sortedElements = overlay
    ? [...overlay.elements].sort((a, b) => a.zIndex - b.zIndex)
    : [];

  const zoomPct = Math.round(scale * 100);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full bg-[#0a0a0e] overflow-hidden transition-opacity duration-200",
        grabCursor ? "cursor-grab" : "",
        ready && overlay ? "opacity-100" : "opacity-0"
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {overlay && (
        <>
          {/* Pannable + zoomable layer */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            {/* Layout box matches rendered size */}
            <div
              className="relative shrink-0"
              style={{
                width: ASSET_WIDTH * scale,
                height: ASSET_HEIGHT * scale,
              }}
            >
              {/* Scaled canvas */}
              <div
                className="absolute origin-top-left"
                style={{
                  width: ASSET_WIDTH,
                  height: ASSET_HEIGHT,
                  transform: `scale(${scale})`,
                }}
              >
                {/* Canvas background */}
                <div
                  data-canvas-bg="true"
                  className="absolute inset-0 rounded-sm"
                  style={{
                    backgroundColor: overlay.backgroundColor,
                    backgroundImage: overlay.backgroundImageUrl
                      ? `url(${overlay.backgroundImageUrl})`
                      : undefined,
                    backgroundSize: "cover",
                  }}
                  onClick={handleCanvasClick}
                  onDoubleClick={handleDoubleClick}
                >
                  {/* Texture overlay */}
                  {overlay.textureUrl && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        backgroundImage: `url(${overlay.textureUrl})`,
                        backgroundSize: "cover",
                        mixBlendMode: overlay.blendMode as React.CSSProperties["mixBlendMode"],
                        opacity: overlay.textureOpacity,
                      }}
                    />
                  )}
                </div>

                {/* Elements */}
                {sortedElements.map((element) => (
                  <DraggableElement
                    key={element.id}
                    element={element}
                    scale={scale}
                    selected={selectedIds.includes(element.id)}
                    onSelect={(multi) => selectElement(element.id, multi)}
                  >
                    {renderElement(element)}
                  </DraggableElement>
                ))}

                {/* Snap guides SVG overlay */}
                <SnapGuides lines={activeSnapLines} />
                <DistanceIndicators distances={activeDistances} />
              </div>
            </div>
          </div>

          {/* Zoom controls — bottom-right, collés bar */}
          <div
            className="absolute bottom-3 right-3 inline-flex z-10"
            style={{ background: "var(--panel)" }}
          >
            <ZoomBtn
              onClick={zoomOut}
              position="first"
              title="Zoom out"
            >
              <ZoomOut size={14} strokeWidth={1.5} />
            </ZoomBtn>
            <ZoomBtn onClick={fitToView} wide title="Fit to view">
              {zoom === null ? (
                <span className="flex items-center gap-1">
                  <Maximize size={12} strokeWidth={1.5} /> Fit
                </span>
              ) : (
                `${zoomPct}%`
              )}
            </ZoomBtn>
            <ZoomBtn onClick={zoomIn} position="last" title="Zoom in">
              <ZoomIn size={14} strokeWidth={1.5} />
            </ZoomBtn>
          </div>
        </>
      )}
    </div>
  );
}

function ZoomBtn({
  children,
  onClick,
  wide,
  position,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  wide?: boolean;
  position?: "first" | "last";
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center font-mono tabular-nums transition-colors"
      style={{
        height: 24,
        width: wide ? undefined : 24,
        minWidth: wide ? 44 : undefined,
        padding: wide ? "0 8px" : 0,
        fontSize: 11,
        background: "var(--card)",
        color: "var(--mid)",
        borderTop: "1px solid var(--line)",
        borderBottom: "1px solid var(--line)",
        borderRight: "1px solid var(--line)",
        borderLeft: position === "first" ? "1px solid var(--line)" : "none",
        transitionDuration: "80ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--card-hi)";
        e.currentTarget.style.color = "var(--ink)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--card)";
        e.currentTarget.style.color = "var(--mid)";
      }}
    >
      {children}
    </button>
  );
}
