import { ASSET_WIDTH, ASSET_HEIGHT, SNAP_THRESHOLD } from "@/lib/vmix/constants";
import type { SnapLine, DistanceIndicator } from "@/stores/overlay-editor-store";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SnapResult {
  x: number;
  y: number;
  snapLines: SnapLine[];
  distances: DistanceIndicator[];
}

/** Get 6 reference points for a rect */
function getRefPoints(rect: Rect) {
  return {
    left: rect.x,
    centerX: rect.x + rect.width / 2,
    right: rect.x + rect.width,
    top: rect.y,
    centerY: rect.y + rect.height / 2,
    bottom: rect.y + rect.height,
  };
}

/** Canvas reference lines */
const CANVAS_REFS_X = [0, ASSET_WIDTH / 2, ASSET_WIDTH];
const CANVAS_REFS_Y = [0, ASSET_HEIGHT / 2, ASSET_HEIGHT];

export function computeSnap(
  moving: Rect,
  others: Rect[],
  threshold = SNAP_THRESHOLD
): SnapResult {
  const snapLines: SnapLine[] = [];
  const distances: DistanceIndicator[] = [];

  let bestDx: number | null = null;
  let bestDxDist = threshold + 1;
  let bestDy: number | null = null;
  let bestDyDist = threshold + 1;

  const movingPts = getRefPoints(moving);
  const movingXPoints = [movingPts.left, movingPts.centerX, movingPts.right];
  const movingYPoints = [movingPts.top, movingPts.centerY, movingPts.bottom];

  // Collect all reference points from other elements + canvas
  const refXValues: number[] = [...CANVAS_REFS_X];
  const refYValues: number[] = [...CANVAS_REFS_Y];

  for (const other of others) {
    const pts = getRefPoints(other);
    refXValues.push(pts.left, pts.centerX, pts.right);
    refYValues.push(pts.top, pts.centerY, pts.bottom);
  }

  // Find best X snap
  for (const mx of movingXPoints) {
    for (const rx of refXValues) {
      const dist = Math.abs(mx - rx);
      if (dist < bestDxDist) {
        bestDxDist = dist;
        bestDx = rx - mx; // delta to apply
      }
    }
  }

  // Find best Y snap
  for (const my of movingYPoints) {
    for (const ry of refYValues) {
      const dist = Math.abs(my - ry);
      if (dist < bestDyDist) {
        bestDyDist = dist;
        bestDy = ry - my;
      }
    }
  }

  // Apply snaps
  let snappedX = moving.x;
  let snappedY = moving.y;

  if (bestDx !== null && bestDxDist <= threshold) {
    snappedX = moving.x + bestDx;
    // Find which reference line we snapped to
    const snappedPts = getRefPoints({ ...moving, x: snappedX });
    for (const rx of refXValues) {
      for (const mx of [snappedPts.left, snappedPts.centerX, snappedPts.right]) {
        if (Math.abs(mx - rx) < 0.5) {
          snapLines.push({ axis: "x", position: rx });
        }
      }
    }
  }

  if (bestDy !== null && bestDyDist <= threshold) {
    snappedY = moving.y + bestDy;
    const snappedPts = getRefPoints({ ...moving, y: snappedY });
    for (const ry of refYValues) {
      for (const my of [snappedPts.top, snappedPts.centerY, snappedPts.bottom]) {
        if (Math.abs(my - ry) < 0.5) {
          snapLines.push({ axis: "y", position: ry });
        }
      }
    }
  }

  // Deduplicate snap lines
  const uniqueLines: SnapLine[] = [];
  for (const line of snapLines) {
    if (
      !uniqueLines.some(
        (l) => l.axis === line.axis && Math.abs(l.position - line.position) < 0.5
      )
    ) {
      uniqueLines.push(line);
    }
  }

  // Calculate distance indicators to nearest elements
  const snappedRect = { ...moving, x: snappedX, y: snappedY };
  const snappedPts = getRefPoints(snappedRect);

  for (const other of others) {
    const oPts = getRefPoints(other);

    // Horizontal distances (left/right gaps)
    if (
      snappedPts.bottom > oPts.top &&
      snappedPts.top < oPts.bottom
    ) {
      const midY =
        (Math.max(snappedPts.top, oPts.top) +
          Math.min(snappedPts.bottom, oPts.bottom)) /
        2;

      // Gap to the right of moving element
      if (oPts.left > snappedPts.right) {
        const gap = oPts.left - snappedPts.right;
        if (gap < 200) {
          distances.push({
            axis: "x",
            from: snappedPts.right,
            to: oPts.left,
            offset: midY,
            value: Math.round(gap),
          });
        }
      }

      // Gap to the left
      if (snappedPts.left > oPts.right) {
        const gap = snappedPts.left - oPts.right;
        if (gap < 200) {
          distances.push({
            axis: "x",
            from: oPts.right,
            to: snappedPts.left,
            offset: midY,
            value: Math.round(gap),
          });
        }
      }
    }

    // Vertical distances
    if (
      snappedPts.right > oPts.left &&
      snappedPts.left < oPts.right
    ) {
      const midX =
        (Math.max(snappedPts.left, oPts.left) +
          Math.min(snappedPts.right, oPts.right)) /
        2;

      if (oPts.top > snappedPts.bottom) {
        const gap = oPts.top - snappedPts.bottom;
        if (gap < 200) {
          distances.push({
            axis: "y",
            from: snappedPts.bottom,
            to: oPts.top,
            offset: midX,
            value: Math.round(gap),
          });
        }
      }

      if (snappedPts.top > oPts.bottom) {
        const gap = snappedPts.top - oPts.bottom;
        if (gap < 200) {
          distances.push({
            axis: "y",
            from: oPts.bottom,
            to: snappedPts.top,
            offset: midX,
            value: Math.round(gap),
          });
        }
      }
    }
  }

  return {
    x: snappedX,
    y: snappedY,
    snapLines: uniqueLines,
    distances,
  };
}
