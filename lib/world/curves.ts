import type { Point, Shape } from "./model";

export function samplePath(shape: Pick<Shape, "kind" | "points" | "closed" | "handles">, steps = 10): Point[] {
  const points = shape.points;
  if (shape.kind === "rectangle" && points.length >= 2) {
    const [a, b] = points;
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }
  if (shape.kind === "ellipse" && points.length >= 2) {
    const [a, b] = points, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    return Array.from({ length: Math.max(12, steps * 4) }, (_, index) => { const angle = index / Math.max(12, steps * 4) * Math.PI * 2; return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry }; });
  }
  if (!shape.handles || shape.handles.length !== points.length || points.length < 2) return points;
  const sampled: Point[] = [points[0]], safeSteps = Math.max(2, Math.floor(steps));
  for (let index = 0; index < (shape.closed ? points.length : points.length - 1); index++) {
    const next = (index + 1) % points.length, a = points[index], b = points[next];
    const h1 = shape.handles[index]?.outgoing ?? { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    const h2 = shape.handles[next]?.incoming ?? { x: a.x + 2 * (b.x - a.x) / 3, y: a.y + 2 * (b.y - a.y) / 3 };
    for (let part = 1; part <= safeSteps; part++) {
      const t = part / safeSteps, u = 1 - t;
      sampled.push({ x: u ** 3 * a.x + 3 * u ** 2 * t * h1.x + 3 * u * t ** 2 * h2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u ** 2 * t * h1.y + 3 * u * t ** 2 * h2.y + t ** 3 * b.y });
    }
  }
  return sampled;
}
