import type { Point, Shape, WorldMap } from "./model";

export type EditCommand =
  | { id: string; type: "shape.create"; shape: Shape }
  | { id: string; type: "shape.update"; shapeId: string; expectedRevision: number; changes: Partial<Shape> }
  | { id: string; type: "shape.delete"; shapeId: string; expectedRevision: number }
  | { id: string; type: "map.rename"; name: string };

export type CommandConflict = { code: "revision_conflict"; shapeId: string; expected: number; actual: number };

export function applyCommand(map: WorldMap, command: EditCommand, seen: ReadonlySet<string> = new Set()): { map: WorldMap; applied: boolean; conflict?: CommandConflict } {
  if (seen.has(command.id)) return { map, applied: false };
  let shapes = map.shapes;
  if (command.type === "map.rename") return { map: { ...map, name: command.name.trim() || map.name, updatedAt: Date.now() }, applied: true };
  if (command.type === "shape.create") {
    if (map.shapes.some((shape) => shape.id === command.shape.id)) return { map, applied: false };
    shapes = [...map.shapes, command.shape];
  } else {
    const target = map.shapes.find((shape) => shape.id === command.shapeId);
    if (!target) return { map, applied: false };
    if (target.revision !== command.expectedRevision) return { map, applied: false, conflict: { code: "revision_conflict", shapeId: target.id, expected: command.expectedRevision, actual: target.revision } };
    shapes = command.type === "shape.delete"
      ? map.shapes.filter((shape) => shape.id !== target.id)
      : map.shapes.map((shape) => shape.id === target.id ? { ...shape, ...command.changes, id: shape.id, revision: shape.revision + 1 } : shape);
  }
  return { map: { ...map, shapes, updatedAt: Date.now() }, applied: true };
}

export function moveShapes(map: WorldMap, ids: string[], delta: Point): WorldMap {
  const selected = new Set(ids);
  return { ...map, updatedAt: Date.now(), shapes: map.shapes.map((shape) => selected.has(shape.id) && !shape.locked ? { ...shape, points: shape.points.map((p) => ({ x:p.x+delta.x,y:p.y+delta.y })),handles:shape.handles?.map(handle=>handle?{incoming:handle.incoming?{x:handle.incoming.x+delta.x,y:handle.incoming.y+delta.y}:undefined,outgoing:handle.outgoing?{x:handle.outgoing.x+delta.x,y:handle.outgoing.y+delta.y}:undefined}:null), revision:shape.revision+1 } : shape) };
}

export function duplicateShapes(map: WorldMap, ids: string[]): { map: WorldMap; ids: string[] } {
  const selected = new Set(ids), copies: Shape[] = [],groupIds=new Map<string,string>(),sourceGroups=new Map((map.groups??[]).map(group=>[group.id,group]));
  const requiredGroups=new Set<string>();for(const shape of map.shapes)if(selected.has(shape.id)){let parent=shape.parentId;while(parent&&!requiredGroups.has(parent)){requiredGroups.add(parent);parent=sourceGroups.get(parent)?.parentId??null;}}
  for(const id of requiredGroups)groupIds.set(id,crypto.randomUUID());
  for (const shape of map.shapes) if (selected.has(shape.id)) {
    const parentId=shape.parentId?groupIds.get(shape.parentId)??null:null;
    copies.push({ ...shape, id: crypto.randomUUID(), name: `${shape.name} copy`, points: shape.points.map((p) => ({x:p.x+18,y:p.y+18})),handles:shape.handles?.map(handle=>handle?{incoming:handle.incoming?{x:handle.incoming.x+18,y:handle.incoming.y+18}:undefined,outgoing:handle.outgoing?{x:handle.outgoing.x+18,y:handle.outgoing.y+18}:undefined}:null), revision:1, createdAt:Date.now(), parentId });
  }
  const copiedGroups=(map.groups??[]).filter(group=>requiredGroups.has(group.id)).map(group=>({...group,id:groupIds.get(group.id)!,parentId:group.parentId?groupIds.get(group.parentId)??null:null,name:`${group.name} copy`}));
  return { map:{...map,groups:[...(map.groups??[]),...copiedGroups],shapes:[...map.shapes,...copies],updatedAt:Date.now()}, ids:copies.map((shape)=>shape.id) };
}
