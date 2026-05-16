/**
 * vMix volume mapping (matches vmixconnect & vMix desktop):
 *
 * XML @_volume = amplitude (0-100)
 * Slider position = amplitude^0.25 * 100  (perceptual / 4th root curve)
 * SetVolume command = slider position (0-100), NOT amplitude
 * dB = 20 * log10(amplitude / 100)
 *
 * Example cycle:
 *   XML returns amplitude=8 → slider shows 53% → user drags to 53%
 *   → sends SetVolume=53 → vMix stores amplitude≈8 → XML returns 8
 */

/** Convert vMix amplitude (0-100 from XML) to slider position (0-100) */
export function amplitudeToSlider(amplitude: number): number {
  if (amplitude <= 0) return 0;
  if (amplitude >= 100) return 100;
  return Math.pow(amplitude / 100, 0.25) * 100;
}

/** Convert vMix amplitude (0-100 from XML) to dB */
export function volumeToDb(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  if (amplitude >= 100) return 0;
  return 20 * Math.log10(amplitude / 100);
}

/** Convert slider position (0-100) to dB (for display during drag) */
export function sliderToDb(sliderPos: number): number {
  if (sliderPos <= 0) return -Infinity;
  if (sliderPos >= 100) return 0;
  // amplitude = (pos/100)^4, dB = 20*log10(amplitude)
  return 80 * Math.log10(sliderPos / 100);
}

/** Convert dB to display string */
export function formatDb(db: number): string {
  if (!isFinite(db)) return "-inf";
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

/**
 * Convert raw meter amplitude (0-1 from XML meterF1/meterF2) to normalized level (0-1)
 * Maps -60dB to 0dB range to 0-1 for VU meter display
 */
export function meterToLevel(amplitude: number): number {
  if (amplitude <= 0) return 0;
  const db = 20 * Math.log10(amplitude);
  const level = (db + 60) / 60;
  return Math.max(0, Math.min(1, level));
}

/** Convert raw meter amplitude (0-1) to dB for real-time display */
export function meterToDb(amplitude: number): number {
  if (amplitude <= 0) return -Infinity;
  return 20 * Math.log10(amplitude);
}

/**
 * Read-out colour for a gain or peak dB value, matching the broadcast
 * convention used everywhere in the UI:
 *   > 0 dB → amber (above unity / clipping warning)
 *   > -60 dB → ink (normal)
 *   ≤ -60 dB → muted (silence)
 */
export function getGainColor(db: number): string {
  if (db > 0) return "var(--amber)";
  if (db > -60) return "var(--ink)";
  return "var(--muted)";
}
