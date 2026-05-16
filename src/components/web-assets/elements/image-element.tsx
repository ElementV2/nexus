"use client";

import type { ImageElement } from "@/lib/web-assets/types";

interface ImageElementViewProps {
  element: ImageElement;
}

export function ImageElementView({ element }: ImageElementViewProps) {
  if (!element.src) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          background: "var(--card)",
          border: "1px dashed var(--line-hi)",
          color: "var(--muted)",
          fontSize: 11,
        }}
      >
        No image
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={element.src}
      alt={element.name}
      draggable={false}
      className="w-full h-full"
      style={{
        objectFit: element.objectFit,
        opacity: element.opacity,
        borderRadius: element.borderRadius,
        border:
          element.borderWidth > 0
            ? `${element.borderWidth}px solid ${element.borderColor}`
            : undefined,
      }}
    />
  );
}
