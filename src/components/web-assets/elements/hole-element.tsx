"use client";

import type { HoleElement } from "@/lib/web-assets/types";

interface HoleElementViewProps {
  element: HoleElement;
}

export function HoleElementView({ element }: HoleElementViewProps) {
  return (
    <div
      className="w-full h-full"
      style={{
        background:
          "repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, rgba(255,255,255,0.12) 0% 50%) 50% / 16px 16px",
        borderRadius: element.borderRadius,
        border:
          element.borderWidth > 0
            ? `${element.borderWidth}px solid ${element.borderColor}`
            : undefined,
      }}
    />
  );
}
