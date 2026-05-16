"use client";

import { Slider } from "@/components/ui/slider";
import { useOptimisticValue } from "@/hooks/use-optimistic-value";

interface YSliderProps {
  value: number;
  min: number;
  max: number;
  /** Slider height in px. Defaults to 260. */
  height?: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}

export function YSlider({
  value: propValue,
  min,
  max,
  height = 260,
  onChange,
  onChangeEnd,
}: YSliderProps) {
  // Throttle is provided by the caller via `onChange` (see WheelGroup) —
  // the hook here just owns the local override during a drag so the
  // slider doesn't snap back the moment the user lets go.
  const opt = useOptimisticValue<number>(propValue, onChange, {
    equals: (a, b) => Math.abs(a - b) < 0.001,
  });
  const signed =
    opt.display >= 0 ? `+${opt.display.toFixed(2)}` : opt.display.toFixed(2);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="label">Y</span>
      <div
        style={{
          height,
          background:
            "linear-gradient(to top, var(--ink) 0%, var(--mid) 50%, var(--bg) 100%)",
          width: 18,
          border: "1px solid var(--line-hi)",
        }}
        className="flex items-center justify-center"
      >
        <Slider
          orientation="vertical"
          value={[opt.display]}
          min={min}
          max={max}
          step={0.01}
          onValueChange={([v]) => opt.onChange(v)}
          onPointerDown={opt.onChangeStart}
          onPointerUp={() => {
            opt.onChangeEnd(opt.display);
            // Caller's `onChangeEnd` is the unthrottled final commit
            // (it bypasses the throttle the caller uses for `onChange`).
            onChangeEnd?.(opt.display);
          }}
          className="h-full"
        />
      </div>
      <span
        className="font-mono tabular-nums"
        style={{ fontSize: 11, color: "var(--ink)" }}
      >
        {signed}
      </span>
    </div>
  );
}
