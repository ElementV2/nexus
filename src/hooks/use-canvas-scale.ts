import { useState, useEffect, useCallback, useRef } from "react";
import { ASSET_WIDTH, ASSET_HEIGHT } from "@/lib/vmix/constants";

const PAD = 32;

export function useCanvasScale(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState<number | null>(null);
  const rafRef = useRef(0);

  const compute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width: availW, height: availH } = el.getBoundingClientRect();
    if (availW < 1 || availH < 1) return;
    const s = Math.min((availW - PAD) / ASSET_WIDTH, (availH - PAD) / ASSET_HEIGHT, 1);
    setScale(s);
  }, [containerRef]);

  useEffect(() => {
    // Retry a few frames — layout may not be stable on first paint
    function retryCompute(n: number) {
      rafRef.current = requestAnimationFrame(() => {
        compute();
        if (n > 0) retryCompute(n - 1);
      });
    }
    retryCompute(3);

    const el = containerRef.current;
    if (!el) return () => cancelAnimationFrame(rafRef.current);

    const ro = new ResizeObserver(compute);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [compute, containerRef]);

  return scale;
}
