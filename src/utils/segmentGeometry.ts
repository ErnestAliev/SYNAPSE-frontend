export interface SegmentPoint {
  x: number;
  y: number;
}

function cross(a: SegmentPoint, b: SegmentPoint, point: SegmentPoint) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function haveOppositeSigns(left: number, right: number) {
  return (left < 0 && right > 0) || (left > 0 && right < 0);
}

function pointToSegmentDistance(point: SegmentPoint, start: SegmentPoint, end: SegmentPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const position = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - start.x - position * dx, point.y - start.y - position * dy);
}

/** Test the entire pointer stroke, including crossings between sampled positions. */
export function segmentsWithinDistance(
  a: SegmentPoint,
  b: SegmentPoint,
  c: SegmentPoint,
  d: SegmentPoint,
  tolerance: number,
): boolean {
  if (
    !Number.isFinite(tolerance) || tolerance < 0 ||
    [a, b, c, d].some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) return false;

  if (
    haveOppositeSigns(cross(a, b, c), cross(a, b, d)) &&
    haveOppositeSigns(cross(c, d, a), cross(c, d, b))
  ) return true;

  // For disjoint segments their closest points include an endpoint. This also
  // covers touching endpoints, collinear overlap and zero-length segments.
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  ) <= tolerance;
}
