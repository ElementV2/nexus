"use client";

import { useCallback } from "react";
import { useOptimisticValue } from "./use-optimistic-value";
import {
  amplitudeToSlider,
  sliderToDb,
} from "@/lib/utils/audio";
import { THROTTLE_RATE_MS } from "@/lib/vmix/constants";

/**
 * Shared fader logic for AudioStrip / MasterStrip / BusStrip.
 *
 * Owns the optimistic-UI dance — local override while dragging,
 * throttled send to vMix, override expires once vMix's reported
 * amplitude moves past the drag-start snapshot. The actual logic
 * lives in the generic `useOptimisticValue` hook; this wrapper just
 * handles the amplitude ↔ slider conversion and exposes the dB read.
 *
 * The hook operates in SLIDER space (0..100, perceptual ^0.25 curve)
 * — that's what the user touches and what `setVolume` expects, so we
 * convert vMix's reported amplitude into slider space on the way in.
 * `sliderToDb(amplitudeToSlider(amp))` reduces to the same `dB`
 * expression as `volumeToDb(amp)`, so one read-out works in both
 * "live upstream" and "during-drag local" cases.
 *
 * `volume` is the raw vMix amplitude (0..100). `send(sliderPos)` is the
 * caller's chosen command (setVolume, setBusVolume, setMasterVolume).
 */
export function useAudioFader({
  volume,
  send,
}: {
  volume: number;
  send: (sliderPos: number) => void;
}) {
  const upstreamSlider = amplitudeToSlider(volume);

  const {
    display: displaySlider,
    isDragging,
    onChange: pushSlider,
    onChangeStart,
    onChangeEnd: commitSlider,
  } = useOptimisticValue<number>(upstreamSlider, send, {
    throttleMs: THROTTLE_RATE_MS,
    // 0.5 slider units of tolerance ≈ vMix's own amplitude rounding
    // floor. Below this the override hangs around long enough to
    // ride out a poll tick between drag and confirmation.
    equals: (a, b) => Math.abs(a - b) < 0.5,
  });

  const db = sliderToDb(displaySlider);

  // FaderStrip emits a 0..1 ratio; the hook works in 0..100 slider
  // position. Wrap the two emit handlers to do the conversion at the
  // edge so the rest of the audio components stay unchanged.
  const onChange = useCallback(
    (ratio: number) => pushSlider(ratio * 100),
    [pushSlider]
  );
  const onChangeEnd = useCallback(
    (ratio: number) => commitSlider(ratio * 100),
    [commitSlider]
  );

  return {
    /** Slider position (0..100) to render the fader at. */
    displaySlider,
    /** Real-time dB read-out for the GAIN display. */
    db,
    /** True while the user holds the cap. */
    isDragging,
    /** Pass to FaderStrip onChange (expects 0..1 ratio). */
    onChange,
    /** Pass to FaderStrip onChangeStart. */
    onChangeStart,
    /** Pass to FaderStrip onChangeEnd (expects 0..1 ratio). */
    onChangeEnd,
    /** Slider-space (0..100) variant of onChange. Used by callers
     *  that drive a 0..100 slider directly (shadcn `<Slider>` on the
     *  Live page details panel). */
    pushSlider,
    /** Slider-space (0..100) variant of onChangeEnd. */
    commitSlider,
  };
}
