import type { Shape, WorldMap } from "@/lib/world/model";

export type SyncOperation =
  | { type: "shape.upsert"; shape: Shape; expectedRevision: number | null }
  | { type: "shape.delete"; shapeId: string; expectedRevision: number }
  | { type: "map.patch"; changes: Partial<WorldMap>; expected: Record<string, unknown> };

const mapKeys = ["name", "width", "height", "restrictCharacterToBounds", "grid", "snap", "backgroundColor", "groups", "templates"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffMaps(previous: WorldMap, next: WorldMap): SyncOperation[] {
  const operations: SyncOperation[] = [];
  const before = new Map(previous.shapes.map((shape) => [shape.id, shape]));
  const after = new Map(next.shapes.map((shape) => [shape.id, shape]));
  for (const [id, shape] of before) if (!after.has(id)) operations.push({ type: "shape.delete", shapeId: id, expectedRevision: shape.revision });
  for (const shape of next.shapes) {
    const old = before.get(shape.id);
    if (!old || !same(old, shape)) operations.push({ type: "shape.upsert", shape, expectedRevision: old?.revision ?? null });
  }
  const changes: Partial<WorldMap> = {}, expected: Record<string, unknown> = {};
  for (const key of mapKeys) if (!same(previous[key], next[key])) {
    (changes as Record<string, unknown>)[key] = next[key];
    expected[key] = previous[key];
  }
  const oldOrder = previous.shapes.map((shape) => shape.id), newOrder = next.shapes.map((shape) => shape.id);
  if (!same(oldOrder, newOrder)) { (changes as Record<string, unknown>).shapeOrder = newOrder; expected.shapeOrder = oldOrder; }
  if (Object.keys(changes).length) operations.push({ type: "map.patch", changes, expected });
  return operations;
}

export function applyMapOperations(map: WorldMap, operations: SyncOperation[]): WorldMap {
  let next = map;
  for (const operation of operations) {
    if (operation.type === "shape.upsert") {
      const found = next.shapes.some((shape) => shape.id === operation.shape.id);
      next = { ...next, shapes: found ? next.shapes.map((shape) => shape.id === operation.shape.id ? operation.shape : shape) : [...next.shapes, operation.shape] };
    } else if (operation.type === "shape.delete") {
      next = { ...next, shapes: next.shapes.filter((shape) => shape.id !== operation.shapeId) };
    } else {
      const { shapeOrder, ...changes } = operation.changes as Partial<WorldMap> & { shapeOrder?: string[] };
      let shapes = next.shapes;
      if (shapeOrder) {
        const byId = new Map(shapes.map((shape) => [shape.id, shape]));
        shapes = [...shapeOrder.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), ...shapes.filter((shape) => !shapeOrder.includes(shape.id))];
      }
      next = { ...next, ...changes, shapes };
    }
  }
  return { ...next, updatedAt: Date.now() };
}

export function canRebaseOperations(latest: WorldMap, base: WorldMap, operations: SyncOperation[]): boolean {
  const latestShapes = new Map(latest.shapes.map((shape) => [shape.id, shape]));
  const baseShapes = new Map(base.shapes.map((shape) => [shape.id, shape]));
  for (const operation of operations) {
    if (operation.type === "shape.upsert") {
      const current = latestShapes.get(operation.shape.id);
      if (operation.expectedRevision === null ? Boolean(current) : current?.revision !== operation.expectedRevision) return false;
    } else if (operation.type === "shape.delete") {
      if (latestShapes.get(operation.shapeId)?.revision !== operation.expectedRevision) return false;
    } else {
      for (const [key, expected] of Object.entries(operation.expected)) {
        if (key === "shapeOrder") {
          if (!same(latest.shapes.map((shape) => shape.id), expected)) return false;
        } else if (!same((latest as unknown as Record<string, unknown>)[key], expected)) return false;
      }
      // A map patch may include no shape edits; keep its optimistic base explicit.
      if (!base) return false;
    }
  }
  return true;
}
