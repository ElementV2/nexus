/**
 * Convert color wheel position (angle + distance) to RGB offsets
 * Used for vMix Lift/Gamma/Gain color correction
 *
 * angle: 0-360 degrees (0 = top/red)
 * distance: 0-1 (center to edge)
 * sensitivity: multiplier for the offset
 */
export function wheelPositionToRGB(
  angle: number,
  distance: number,
): { r: number; g: number; b: number } {
  const normalizedAngle = ((angle % 360) + 360) % 360;
  let r: number, g: number, b: number;

  if (normalizedAngle < 60) {
    r = 1;
    g = -1;
    b = -1 + (2 * normalizedAngle) / 60;
  } else if (normalizedAngle < 120) {
    r = 1 - (2 * (normalizedAngle - 60)) / 60;
    g = -1;
    b = 1;
  } else if (normalizedAngle < 180) {
    r = -1;
    g = -1 + (2 * (normalizedAngle - 120)) / 60;
    b = 1;
  } else if (normalizedAngle < 240) {
    r = -1;
    g = 1;
    b = 1 - (2 * (normalizedAngle - 180)) / 60;
  } else if (normalizedAngle < 300) {
    r = -1 + (2 * (normalizedAngle - 240)) / 60;
    g = 1;
    b = -1;
  } else {
    r = 1;
    g = 1 - (2 * (normalizedAngle - 300)) / 60;
    b = -1;
  }

  return {
    r: r * distance,
    g: g * distance,
    b: b * distance,
  };
}

/**
 * Convert RGB offsets back to wheel position (angle + distance)
 */
export function rgbToWheelPosition(
  r: number,
  g: number,
  b: number,
): { angle: number; distance: number } {
  const maxVal = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  if (maxVal === 0) return { angle: 0, distance: 0 };

  const distance = maxVal;
  const nr = r / maxVal;
  const ng = g / maxVal;
  const nb = b / maxVal;

  let angle = 0;

  if (nr >= ng && nr >= nb) {
    if (nb >= ng) {
      angle = ((nb + 1) / 2) * 60;
    } else {
      angle = 360 - ((ng + 1) / 2) * 60;
    }
  } else if (nb >= nr && nb >= ng) {
    if (nr >= ng) {
      angle = 60 + ((1 - nr) / 2) * 60;
    } else {
      angle = 120 + ((ng + 1) / 2) * 60;
    }
  } else {
    if (nb >= nr) {
      angle = 180 + ((1 - nb) / 2) * 60;
    } else {
      angle = 240 + ((nr + 1) / 2) * 60;
    }
  }

  return { angle: angle % 360, distance: Math.min(distance, 1) };
}

/**
 * Draw a color wheel ring on a canvas (outer rainbow band, transparent center)
 */
export function drawColorWheel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  ringWidth?: number
) {
  const rw = ringWidth ?? Math.round(radius * 0.18);
  const outerR = radius;
  const innerR = radius - rw;
  const diameter = Math.ceil(outerR * 2);
  const imageData = ctx.createImageData(diameter, diameter);
  const data = imageData.data;

  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      const dx = x - outerR;
      const dy = y - outerR;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= outerR && dist >= innerR) {
        // Anti-alias edges
        let alpha = 1;
        if (dist > outerR - 1) alpha = Math.max(0, outerR - dist);
        else if (dist < innerR + 1) alpha = Math.max(0, dist - innerR);

        // Negate + rotate so red is at top, matching vMix order (R→M→B→C→G→Y clockwise)
        const hue = (-(Math.atan2(dy, dx) * 180) / Math.PI - 90 + 720) % 360;
        // Full saturation ring
        const c = 1;
        const x2 = c * (1 - Math.abs(((hue / 60) % 2) - 1));

        let r = 0, g = 0, b = 0;
        if (hue < 60) { r = c; g = x2; b = 0; }
        else if (hue < 120) { r = x2; g = c; b = 0; }
        else if (hue < 180) { r = 0; g = c; b = x2; }
        else if (hue < 240) { r = 0; g = x2; b = c; }
        else if (hue < 300) { r = x2; g = 0; b = c; }
        else { r = c; g = 0; b = x2; }

        const idx = (y * diameter + x) * 4;
        data[idx] = Math.round(r * 255);
        data[idx + 1] = Math.round(g * 255);
        data[idx + 2] = Math.round(b * 255);
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
  }

  ctx.putImageData(imageData, cx - outerR, cy - outerR);
}
