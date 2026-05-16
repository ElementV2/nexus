"use client";

import { meterToLevel } from "@/lib/utils/audio";
import { cn } from "@/lib/utils";

interface VuMeterProps {
  amplitude: number;
  vertical?: boolean;
  className?: string;
  height?: number;
  muted?: boolean;
}

/**
 * Sectorised VU bar with a fixed broadcast gradient.
 *  0 – 70 %  green
 *  70 – 90 % amber
 *  90 – 100 % red
 *
 * Only the portion of the bar that actually reaches each threshold
 * shows the corresponding color — i.e. a 60 % level is fully green,
 * an 80 % level is green + a thin amber band, a 95 % level shows
 * green + amber + a small red tip.
 *
 * Rendering trick: the gradient fills the entire container, and a
 * bg-coloured "shutter" hides the empty portion from the empty side.
 * No `transition` on width/height so the meter responds frame-tight.
 */
export function VuMeter({
  amplitude,
  vertical,
  className,
  height,
  muted,
}: VuMeterProps) {
  const level = meterToLevel(amplitude);

  const gradient = muted
    ? "var(--cyan)"
    : vertical
      ? `linear-gradient(
          to top,
          var(--pvw) 0%,
          var(--pvw) 70%,
          var(--amber) 70%,
          var(--amber) 90%,
          var(--pgm) 90%,
          var(--pgm) 100%
        )`
      : `linear-gradient(
          to right,
          var(--pvw) 0%,
          var(--pvw) 70%,
          var(--amber) 70%,
          var(--amber) 90%,
          var(--pgm) 90%,
          var(--pgm) 100%
        )`;

  // Sectorised threshold markers — thin 1px ink line at 70 % and 90 %
  const markerStyle: React.CSSProperties = {
    position: "absolute",
    background: "var(--bg)",
    pointerEvents: "none",
  };

  if (vertical) {
    return (
      <div
        className={cn(
          "relative w-[6px] overflow-hidden",
          "border-[1px] border-sw-line-2",
          className
        )}
        style={{ height: height ?? 140, background: "var(--bg)" }}
      >
        {/* Fixed-position gradient covering the whole container */}
        <div className="absolute inset-0" style={{ background: gradient }} />
        {/* Shutter hiding the empty portion (from the top) */}
        <div
          className="absolute left-0 right-0 top-0"
          style={{
            height: `${(1 - level) * 100}%`,
            background: "var(--bg)",
          }}
        />
        {/* 70 % and 90 % threshold ticks */}
        <div style={{ ...markerStyle, left: 0, right: 0, top: "30%", height: 1 }} />
        <div style={{ ...markerStyle, left: 0, right: 0, top: "10%", height: 1 }} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-[6px] overflow-hidden",
        "border-[1px] border-sw-line-2",
        className
      )}
      style={{ background: "var(--bg)" }}
    >
      <div className="absolute inset-0" style={{ background: gradient }} />
      <div
        className="absolute top-0 bottom-0 right-0"
        style={{
          width: `${(1 - level) * 100}%`,
          background: "var(--bg)",
        }}
      />
      <div style={{ ...markerStyle, top: 0, bottom: 0, left: "70%", width: 1 }} />
      <div style={{ ...markerStyle, top: 0, bottom: 0, left: "90%", width: 1 }} />
    </div>
  );
}
