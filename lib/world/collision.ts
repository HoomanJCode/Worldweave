import { distanceToSegment, pointInPolygon } from "./geometry";
import { isShapeVisible } from "./groups";
import { samplePath } from "./curves";
import type { Point, WorldMap } from "./model";

/** Returns true when a circular character collider cannot occupy this world position. */
export function isCharacterBlocked(point: Point, map: WorldMap, radius = 8): boolean {
  if (
    map.restrictCharacterToBounds && map.width !== null && map.height !== null &&
    (Math.abs(point.x) + radius > map.width / 2 || Math.abs(point.y) + radius > map.height / 2)
  ) return true;

  for (const shape of map.shapes) {
    if (!isShapeVisible(map, shape) || shape.collision === "none" || shape.points.length < 2) continue;
    const points = samplePath(shape, 10);
    if (shape.collision === "solid" && shape.closed && pointInPolygon(point, points)) return true;
    const segments = shape.closed
      ? points.map((start, index) => [start, points[(index + 1) % points.length]] as const)
      : points.slice(1).map((end, index) => [points[index], end] as const);
    if (segments.some(([start, end]) => distanceToSegment(point, start, end) < radius + shape.collisionThickness / 2)) return true;
  }
  return false;
}
