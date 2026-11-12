import type { MapGroup, Shape, WorldMap } from "./model";

export function descendantShapeIds(map: WorldMap, groupId: string): string[] {
  const groups = map.groups ?? [], visited = new Set<string>();
  const collect = (id: string): string[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    return [
      ...map.shapes.filter((shape) => shape.parentId === id).map((shape) => shape.id),
      ...groups.filter((group) => group.parentId === id).flatMap((group) => collect(group.id)),
    ];
  };
  return collect(groupId);
}

export function groupAncestors(map: WorldMap, groupId: string | null): MapGroup[] {
  const byId = new Map((map.groups ?? []).map((group) => [group.id, group])), result: MapGroup[] = [];
  let current = groupId;
  while (current) { const group = byId.get(current); if (!group) break; result.push(group); current = group.parentId; }
  return result;
}

export function isShapeVisible(map: WorldMap, shape: Shape): boolean {
  return shape.visible && groupAncestors(map, shape.parentId).every((group) => group.visible);
}

export function isShapeLocked(map: WorldMap, shape: Shape): boolean {
  return shape.locked || groupAncestors(map, shape.parentId).some((group) => group.locked);
}

export function selectedGroupRoot(map: WorldMap, selectedShapeIds: string[]): MapGroup | null {
  const selected = new Set(selectedShapeIds);
  return (map.groups ?? []).find((group) => {
    const members = descendantShapeIds(map, group.id);
    return members.length > 0 && members.length === selected.size && members.every((id) => selected.has(id));
  }) ?? null;
}

export function removeEmptyGroups(groups: MapGroup[], shapes: Shape[]): MapGroup[] {
  let remaining = [...groups], changed = true;
  while (changed) {
    const ids = new Set(remaining.map((group) => group.id));
    const used = new Set(shapes.flatMap((shape) => shape.parentId ? [shape.parentId] : []));
    for (const group of remaining) if (group.parentId && ids.has(group.parentId)) used.add(group.parentId);
    const next = remaining.filter((group) => used.has(group.id));
    changed = next.length !== remaining.length; remaining = next;
  }
  return remaining;
}
