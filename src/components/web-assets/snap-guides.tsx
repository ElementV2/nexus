"use client";

import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";
import type { SnapLine } from "@/stores/overlay-editor-store";

interface SnapGuidesProps {
  lines: SnapLine[];
}

export function SnapGuides({ lines }: SnapGuidesProps) {
  if (lines.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={ASSET_WIDTH}
      height={ASSET_HEIGHT}
      style={{ zIndex: 9998 }}
    >
      {lines.map((line, i) =>
        line.axis === "x" ? (
          <line
            key={`x-${i}`}
            x1={line.position}
            y1={0}
            x2={line.position}
            y2={ASSET_HEIGHT}
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ) : (
          <line
            key={`y-${i}`}
            x1={0}
            y1={line.position}
            x2={ASSET_WIDTH}
            y2={line.position}
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )
      )}
    </svg>
  );
}
