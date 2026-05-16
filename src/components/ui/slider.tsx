"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Swiss-styled slider. Rectangular ink track, no rounding. The thumb
 * is a wide solid block so it can be grabbed on touchscreens — 24×10
 * for vertical faders, 10×24 for horizontal sliders.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  );

  const isVertical = orientation === "vertical";

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      orientation={orientation}
      className={cn(
        "relative flex touch-none select-none items-center justify-center",
        "data-[disabled]:opacity-50",
        isVertical ? "h-full w-auto flex-col" : "w-full",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-visible",
          isVertical ? "h-full w-[14px]" : "h-[10px] w-full"
        )}
        style={{
          background: "var(--card)",
          border: "1px solid var(--line-hi)",
        }}
      >
        {/* Centre tick */}
        <div
          className={cn(
            "absolute pointer-events-none",
            isVertical
              ? "left-0 right-0 h-px top-1/2"
              : "top-0 bottom-0 w-px left-1/2"
          )}
          style={{ background: "var(--line-hi)" }}
        />
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn("absolute", isVertical ? "w-full bottom-0" : "h-full")}
          style={{ background: "var(--mid)" }}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "flex shrink-0 items-center justify-center",
            "focus-visible:outline-none disabled:pointer-events-none",
            "cursor-grab active:cursor-grabbing",
            isVertical
              ? "w-[28px] h-[14px] flex-col -mx-[7px]"
              : "h-[28px] w-[14px] flex-row -my-[7px]"
          )}
          style={{
            background: "var(--ink)",
            border: "1px solid var(--bg)",
            gap: 2,
          }}
        >
          {/* 3 grip ticks — perpendicular to drag direction */}
          {isVertical ? (
            <>
              <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
              <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
              <span style={{ width: 14, height: 1, background: "var(--bg)" }} />
            </>
          ) : (
            <>
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
              <span style={{ height: 14, width: 1, background: "var(--bg)" }} />
            </>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
