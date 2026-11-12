import type { Point, Shape } from "./model";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const shapeBounds = (shape: Shape): Bounds | null => {
  if (!shape.points.length) return null;
  return {
    minX: Math.min(...shape.points.map((point) => point.x)),
    minY: Math.min(...shape.points.map((point) => point.y)),
    maxX: Math.max(...shape.points.map((point) => point.x)),
    maxY: Math.max(...shape.points.map((point) => point.y)),
  };
};

const cellKey = (x: number, y: number) => `${x},${y}`;

/** A lightweight uniform grid that narrows pointer hit tests to nearby geometry. */
export class ShapeSpatialIndex {
  private readonly cells = new Map<string, Shape[]>();
  private readonly bounds = new Map<string, Bounds>();

  constructor(shapes: Shape[], readonly cellSize = 256) {
    for (const shape of shapes) {
      const bounds = shapeBounds(shape);
      if (!bounds) continue;
      this.bounds.set(shape.id, bounds);
      for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x++) {
        for (let y = Math.floor(bounds.minY / cellSize); y <= Math.floor(bounds.maxY / cellSize); y++) {
          const key = cellKey(x, y), items = this.cells.get(key) ?? [];
          items.push(shape);
          this.cells.set(key, items);
        }
      }
    }
  }

  queryPoint(point: Point, padding = 0): Shape[] {
    const minX = Math.floor((point.x - padding) / this.cellSize), maxX = Math.floor((point.x + padding) / this.cellSize);
    const minY = Math.floor((point.y - padding) / this.cellSize), maxY = Math.floor((point.y + padding) / this.cellSize);
    const found = new Map<string, Shape>();
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      for (const shape of this.cells.get(cellKey(x, y)) ?? []) {
        const bounds = this.bounds.get(shape.id)!;
        if (bounds.maxX + padding >= point.x && bounds.minX - padding <= point.x && bounds.maxY + padding >= point.y && bounds.minY - padding <= point.y) found.set(shape.id, shape);
      }
    }
    return [...found.values()];
  }

  queryBounds(bounds: Bounds): Shape[] {
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const padding = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    return this.queryPoint(center, padding).filter((shape) => {
      const item = this.bounds.get(shape.id)!;
      return item.maxX >= bounds.minX && item.minX <= bounds.maxX && item.maxY >= bounds.minY && item.minY <= bounds.maxY;
    });
  }
}
