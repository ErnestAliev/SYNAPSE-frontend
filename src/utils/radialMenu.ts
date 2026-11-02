export interface RadialMenuGeometry {
  pillWidth: number;
  pillHeight: number;
  side: number;
  middle: number;
  row: number;
  pole: number;
  width: number;
  height: number;
  fitsViewport: boolean;
  maxNodeDiameter: number;
}

/** Screen-space geometry shared by the ring and its viewport positioning. */
export function getRadialMenuGeometry(
  viewportWidth: number,
  nodeDiameter = 78,
  coarsePointer = false,
): RadialMenuGeometry {
  const availableWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 1024;
  const pillWidth = availableWidth < 350 ? 80 : availableWidth < 460 ? 96 : 116;
  const pillHeight = coarsePointer ? 44 : 30;
  const safeDiameter = Number.isFinite(nodeDiameter) ? Math.max(0, nodeDiameter) : 78;
  const nodeRadius = safeDiameter / 2;
  const clearance = 6;
  const extra = Math.max(0, (safeDiameter - 78) / 2);
  const desiredMiddle = 124 + extra;
  const availableMiddle = Math.max(0, (availableWidth - pillWidth - 24) / 2);
  const minimumMiddle = nodeRadius + pillWidth / 2 + clearance;
  // Do not squeeze the side buttons into a large node to fit the viewport.
  // The caller can zoom to maxNodeDiameter before opening the ring instead.
  const middle = Math.max(minimumMiddle, Math.min(desiredMiddle, availableMiddle));
  const side = (98 + extra) * (middle / desiredMiddle);
  const diagonalNearestX = Math.max(0, side - pillWidth / 2);
  const diagonalClearanceY = Math.sqrt(Math.max(0, (nodeRadius + clearance) ** 2 - diagonalNearestX ** 2));
  const row = Math.max(
    36,
    pillHeight + clearance,
    (nodeRadius + pillHeight / 2 + clearance) / 2,
    pillHeight / 2 + diagonalClearanceY,
  );
  const pole = 2 * row;
  const width = middle * 2 + pillWidth;

  return {
    pillWidth,
    pillHeight,
    middle,
    side,
    row,
    pole,
    width,
    height: pole * 2 + pillHeight,
    fitsViewport: width <= availableWidth - 24 + 0.001,
    maxNodeDiameter: Math.max(0, availableWidth - 24 - 2 * pillWidth - 2 * clearance),
  };
}
