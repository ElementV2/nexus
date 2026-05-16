"use client";

import { useCallback, useEffect, useState } from "react";
import { useThrottle } from "@/lib/utils/throttle";

/**
 * Generic "optimistic UI override" for any sliding / dragged value
 * mirrored from a remote (vMix, Ableton, …).
 *
 * Semantics — what the hook owns:
 *
 *   1. user grabs the cap → `onChangeStart` flips `isDragging`
 *   2. drag in progress → `onChange(v)` records the local value AND
 *      fires `send(v)` through the (optional) throttle
 *   3. user releases → `onChangeEnd(v)` lowers `isDragging` and fires
 *      one final unthrottled `send(v)`. The local override STAYS
 *      visible because the remote takes a poll tick (~150 ms) to
 *      report the change — without this the slider would snap back
 *      for one frame.
 *   4. the override expires the moment `upstream` catches up to
 *      `local` (per `equals`). Until then we keep showing `local`,
 *      so a fast drag whose throttled mid-values reach the remote
 *      before the unthrottled final doesn't briefly flash the
 *      mid-value on screen.
 *   5. once an override has been confirmed at least once, future
 *      external `upstream` changes flip the display back to upstream
 *      — we don't want a stale local value to mask a real change
 *      made elsewhere on the remote.
 *
 * The 6 places this used to live inline (audio strips, live details
 * panel, colorimetry hue/sat, y-slider, color-wheel RGB, playlist
 * seek) all reduce to ~3 lines of glue + this hook.
 *
 * @example  // simple float, vMix amplitude tolerance
 *   const { display, onChange, onChangeStart, onChangeEnd } =
 *     useOptimisticValue(volume, sendVolume, {
 *       throttleMs: 80,
 *       equals: (a, b) => Math.abs(a - b) < 0.5,
 *     });
 *
 * @example  // RGB triple
 *   const { display, onChange, ... } =
 *     useOptimisticValue<[number, number, number]>(rgb, sendRgb, {
 *       equals: (a, b) =>
 *         Math.abs(a[0]-b[0])<0.5 &&
 *         Math.abs(a[1]-b[1])<0.5 &&
 *         Math.abs(a[2]-b[2])<0.5,
 *     });
 */
export interface UseOptimisticValueOptions<T> {
  /** Throttle `onChange`'s `send` call. The trailing call is preserved.
   *  Omit for no throttle (immediate send on every change). */
  throttleMs?: number;
  /** Custom "values match" predicate. Defaults to `Object.is`. Use a
   *  tolerance compare for floats or a deep compare for tuples /
   *  records. The hook calls it as `equals(local, upstream)` — when
   *  it returns true the remote has caught up and the override
   *  expires. */
  equals?: (a: T, b: T) => boolean;
}

export interface UseOptimisticValueResult<T> {
  /** Value to render the control at — local override during a drag
   *  and while waiting for the remote to catch up; `upstream`
   *  otherwise. */
  display: T;
  /** True while `onChangeStart` has fired and `onChangeEnd` hasn't. */
  isDragging: boolean;
  /** Call from the drag handler on every move. */
  onChange: (v: T) => void;
  /** Call once on drag start (mousedown / pointerdown / touch-start). */
  onChangeStart: () => void;
  /** Call once on drag end with the final value. */
  onChangeEnd: (v: T) => void;
}

export function useOptimisticValue<T>(
  upstream: T,
  send: (v: T) => void,
  options: UseOptimisticValueOptions<T> = {}
): UseOptimisticValueResult<T> {
  const equals = options.equals ?? Object.is;
  const throttleMs = options.throttleMs ?? 0;

  const [isDragging, setIsDragging] = useState(false);
  const [local, setLocal] = useState<T | null>(null);
  /**
   * Has the remote caught up to our most-recent local value at least
   * once since the user last touched the control? Once true the
   * override goes inert and we trust `upstream` again — that lets us
   * surface external changes (someone else moved the fader, vMix
   * reset, …) instead of permanently showing a stale local.
   *
   * Flipped to `true` by the effect below; cleared back to `false`
   * on every fresh user input in `onChange`.
   */
  const [confirmed, setConfirmed] = useState(false);

  // Watch for the remote catching up. Once `upstream` equals our
  // `local`, mark the override confirmed — subsequent renders will
  // then prefer `upstream` so any future external change is visible
  // immediately. setState-in-effect is the right fit here: it
  // synchronises a derived flag with the external `upstream` prop.
  useEffect(() => {
    if (
      !confirmed &&
      !isDragging &&
      local !== null &&
      equals(local, upstream)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirmed(true);
    }
  }, [confirmed, isDragging, local, upstream, equals]);

  // Override valid when:
  //   – the user has actually touched it (`local !== null`)
  //   – the previous override hasn't yet been confirmed by upstream
  //   – either dragging right now, OR the remote hasn't caught up yet
  const overrideValid =
    local !== null &&
    !confirmed &&
    (isDragging || !equals(local, upstream));

  const display: T = overrideValid ? (local as T) : upstream;

  // Throttled wrapper around `send`. When `throttleMs` is 0 the
  // wrapper falls through to immediate so we go through the same
  // code path either way.
  const throttledSend = useThrottle(
    useCallback((v: T) => send(v), [send]) as (v: T) => void,
    throttleMs
  );

  const onChange = useCallback(
    (v: T) => {
      setLocal(v);
      // Fresh user input — reset the confirmation gate so the new
      // local takes precedence until upstream catches up to IT.
      setConfirmed(false);
      throttledSend(v);
    },
    [throttledSend]
  );

  const onChangeStart = useCallback(() => {
    setIsDragging(true);
    setConfirmed(false);
    // Don't overwrite `local` if `onChange` already set it (Radix
    // Slider fires `onValueChange` BEFORE `onPointerDown` on track-
    // clicks, so the click position arrives first).
    setLocal((prev) => prev ?? upstream);
  }, [upstream]);

  const onChangeEnd = useCallback(
    (v: T) => {
      setIsDragging(false);
      setLocal(v);
      // Final unthrottled commit — the released value lands even if
      // a slow throttled call would otherwise be the most-recent
      // thing `send` saw.
      send(v);
    },
    [send]
  );

  return { display, isDragging, onChange, onChangeStart, onChangeEnd };
}
