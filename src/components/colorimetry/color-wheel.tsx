"use client";

import { useRef, useEffect, useCallback } from "react";
import { drawColorWheel, wheelPositionToRGB, rgbToWheelPosition } from "@/lib/utils/color";
import { useOptimisticValue } from "@/hooks/use-optimistic-value";
import { cn } from "@/lib/utils";

type RGB = [number, number, number];

// Tolerance for the RGB triple to be considered "moved past the
// drag-start snapshot". 0.001 is below operator perception but well
// above the float rounding floor on vMix's reported values.
const RGB_EQUALS = (a: RGB, b: RGB) =>
  Math.abs(a[0] - b[0]) < 0.001 &&
  Math.abs(a[1] - b[1]) < 0.001 &&
  Math.abs(a[2] - b[2]) < 0.001;

interface ColorWheelProps {
  r: number;
  g: number;
  b: number;
  sensitivity?: number;
  size?: number;
  /** Header / RGB display rendered by parent. */
  onChange: (r: number, g: number, b: number) => void;
  onChangeEnd?: (r: number, g: number, b: number) => void;
  onReset?: () => void;
}

export function ColorWheel({
  r: propR,
  g: propG,
  b: propB,
  sensitivity = 0.3,
  size = 200,
  onChange,
  onChangeEnd,
  onReset,
}: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const onChangeEndRef = useRef(onChangeEnd);
  useEffect(() => {
    onChangeEndRef.current = onChangeEnd;
  });

  // Refs for relative drag
  const startMouseRef = useRef({ x: 0, y: 0 });
  const startCursorRef = useRef({ x: 0, y: 0 });

  // Local optimistic override for immediate visual feedback during a
  // drag. Caller already throttles `onChange`, so the hook does not
  // re-throttle. The hook owns: local override during the drag,
  // staleness detection once vMix's reported RGB catches up.
  const sendRGB = useCallback(
    (rgb: RGB) => onChange(rgb[0], rgb[1], rgb[2]),
    [onChange]
  );
  const rgbOpt = useOptimisticValue<RGB>(
    [propR, propG, propB],
    sendRGB,
    { equals: RGB_EQUALS }
  );
  // Keep the displayed RGB available to the pointermove window handler
  // through a ref — the handler is registered once and the closure
  // would otherwise see only the stale tuple from the registration
  // render. Ref mutation lives in an effect so React 19's strict
  // purity rules pass.
  const displayRef = useRef(rgbOpt.display);
  useEffect(() => {
    displayRef.current = rgbOpt.display;
  });
  const isDragging = rgbOpt.isDragging;
  const [r, g, b] = rgbOpt.display;

  const radius = size / 2;
  const usableRadius = radius - 10;

  // Draw wheel background once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);

    // Resolve the dark sage panel colour from CSS so the inner disc
    // sits flush on the rest of the page (no jarring white circle).
    const panelColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--panel-2")
        .trim() || "#181f19";
    const lineColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--line-hi")
        .trim() || "#3a4439";
    const muted =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--muted")
        .trim() || "#6c7569";

    // Outer hue ring (full width — drawColorWheel paints only the ring band)
    drawColorWheel(ctx, radius, radius, radius - 2);

    // Dark inner disc — sized so the colour ring stays a clear band
    const ringInnerRadius = Math.round(radius * 0.78);
    ctx.beginPath();
    ctx.arc(radius, radius, ringInnerRadius, 0, Math.PI * 2);
    ctx.fillStyle = panelColor;
    ctx.fill();

    // Hairline between ring and inner disc
    ctx.beginPath();
    ctx.arc(radius, radius, ringInnerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Centre crosshair — short ticks marking the neutral (0,0) origin
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    const tick = 6;
    ctx.beginPath();
    ctx.moveTo(radius - tick, radius);
    ctx.lineTo(radius + tick, radius);
    ctx.moveTo(radius, radius - tick);
    ctx.lineTo(radius, radius + tick);
    ctx.stroke();
  }, [size, radius, usableRadius]);

  // Cursor position from current RGB values
  // Wheel angle 0° = red = top → screen angle -90°, so subtract 90°
  const { angle, distance } = rgbToWheelPosition(r, g, b);
  const screenAngle = angle - 90;
  const cursorX = radius + Math.cos((screenAngle * Math.PI) / 180) * distance * usableRadius;
  const cursorY = radius + Math.sin((screenAngle * Math.PI) / 180) * distance * usableRadius;

  // Capture the latest onChange/onStart/onEnd from the hook so the
  // window-level handlers (registered once) don't see stale refs.
  const onChangeHookRef = useRef(rgbOpt.onChange);
  const onChangeEndHookRef = useRef(rgbOpt.onChangeEnd);
  useEffect(() => {
    onChangeHookRef.current = rgbOpt.onChange;
    onChangeEndHookRef.current = rgbOpt.onChangeEnd;
  });

  const computeFromDrag = useCallback(
    (clientX: number, clientY: number) => {
      const dx = (clientX - startMouseRef.current.x) * sensitivity;
      const dy = (clientY - startMouseRef.current.y) * sensitivity;

      const newX = startCursorRef.current.x + dx;
      const newY = startCursorRef.current.y + dy;

      const dist = Math.min(Math.sqrt(newX * newX + newY * newY) / usableRadius, 1);
      const a = ((Math.atan2(newY, newX) * 180) / Math.PI + 90 + 360) % 360;

      const rgb = wheelPositionToRGB(a, dist);
      onChangeHookRef.current([rgb.r, rgb.g, rgb.b]);
    },
    [sensitivity, usableRadius]
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      computeFromDrag(e.clientX, e.clientY);
    };

    const handleUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const final = displayRef.current;
      // Tell the hook the drag is over so its `isDragging` flips.
      onChangeEndHookRef.current(final);
      // Unthrottled final commit straight to the caller.
      onChangeEndRef.current?.(final[0], final[1], final[2]);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [computeFromDrag]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    rgbOpt.onChangeStart();

    startMouseRef.current = { x: e.clientX, y: e.clientY };

    // Wheel angle → screen angle: subtract 90°
    const { angle: a, distance: d } = rgbToWheelPosition(propR, propG, propB);
    const sa = a - 90;
    startCursorRef.current = {
      x: Math.cos((sa * Math.PI) / 180) * d * usableRadius,
      y: Math.sin((sa * Math.PI) / 180) * d * usableRadius,
    };
  };

  const handleDoubleClick = () => {
    if (onReset) {
      onReset();
    } else {
      onChangeHookRef.current([0, 0, 0]);
      onChangeEndRef.current?.(0, 0, 0);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative select-none touch-none"
      style={{ width: size, height: size }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="rounded-full cursor-crosshair"
      />

      {/* Amber target cursor — bigger and high-contrast on the dark
          inner disc. The thin inner dot pinpoints the exact position. */}
      <div
        className={cn(
          "absolute pointer-events-none wheel-cursor",
          isDragging && "dragging"
        )}
        style={{
          left: cursorX - 12,
          top: cursorY - 12,
          width: 24,
          height: 24,
          border: "2px solid var(--amber)",
          background: "transparent",
        }}
      />
      <div
        className="absolute pointer-events-none wheel-cursor"
        style={{
          left: cursorX - 2,
          top: cursorY - 2,
          width: 4,
          height: 4,
          background: "var(--amber)",
        }}
      />
    </div>
  );
}
