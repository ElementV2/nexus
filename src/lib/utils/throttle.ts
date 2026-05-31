import { useCallback, useEffect, useRef } from "react";

/**
 * Hook that returns a throttled callback
 * During the throttle period, the latest call args are saved and fired when the period expires
 */
export function useThrottle<T extends (...args: never[]) => void>(
  fn: T,
  delay: number
): T {
  const lastCall = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestArgs = useRef<Parameters<T> | null>(null);

  // Clear a pending trailing call on unmount so we don't fire `fn` (a
  // command dispatch) for a control that no longer exists — e.g. a fader
  // unmounted mid-drag.
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const remaining = delay - (now - lastCall.current);

      if (remaining <= 0) {
        lastCall.current = now;
        fn(...args);
      } else {
        latestArgs.current = args;
        if (!timeoutRef.current) {
          timeoutRef.current = setTimeout(() => {
            lastCall.current = Date.now();
            if (latestArgs.current) {
              fn(...latestArgs.current);
            }
            latestArgs.current = null;
            timeoutRef.current = null;
          }, remaining);
        }
      }
    },
    [fn, delay]
  ) as T;
}
