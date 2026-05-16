"use client";

import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";
import type { DistanceIndicator } from "@/stores/overlay-editor-store";

interface DistanceIndicatorsProps {
  distances: DistanceIndicator[];
}

export function DistanceIndicators({ distances }: DistanceIndicatorsProps) {
  if (distances.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={ASSET_WIDTH}
      height={ASSET_HEIGHT}
      style={{ zIndex: 9998 }}
    >
      {distances.map((d, i) => {
        const color = "#f59e0b";

        if (d.axis === "x") {
          // Horizontal distance line
          const y = d.offset;
          const midX = (d.from + d.to) / 2;
          return (
            <g key={`dx-${i}`}>
              <line
                x1={d.from}
                y1={y}
                x2={d.to}
                y2={y}
                stroke={color}
                strokeWidth={1}
              />
              {/* End caps */}
              <line
                x1={d.from}
                y1={y - 4}
                x2={d.from}
                y2={y + 4}
                stroke={color}
                strokeWidth={1}
              />
              <line
                x1={d.to}
                y1={y - 4}
                x2={d.to}
                y2={y + 4}
                stroke={color}
                strokeWidth={1}
              />
              {/* Label */}
              <rect
                x={midX - 14}
                y={y - 9}
                width={28}
                height={14}
                rx={2}
                fill="rgba(0,0,0,0.7)"
              />
              <text
                x={midX}
                y={y + 2}
                textAnchor="middle"
                fill={color}
                fontSize={9}
                fontFamily="monospace"
              >
                {d.value}
              </text>
            </g>
          );
        } else {
          // Vertical distance line
          const x = d.offset;
          const midY = (d.from + d.to) / 2;
          return (
            <g key={`dy-${i}`}>
              <line
                x1={x}
                y1={d.from}
                x2={x}
                y2={d.to}
                stroke={color}
                strokeWidth={1}
              />
              <line
                x1={x - 4}
                y1={d.from}
                x2={x + 4}
                y2={d.from}
                stroke={color}
                strokeWidth={1}
              />
              <line
                x1={x - 4}
                y1={d.to}
                x2={x + 4}
                y2={d.to}
                stroke={color}
                strokeWidth={1}
              />
              <rect
                x={x - 14}
                y={midY - 7}
                width={28}
                height={14}
                rx={2}
                fill="rgba(0,0,0,0.7)"
              />
              <text
                x={x}
                y={midY + 3}
                textAnchor="middle"
                fill={color}
                fontSize={9}
                fontFamily="monospace"
              >
                {d.value}
              </text>
            </g>
          );
        }
      })}
    </svg>
  );
}
