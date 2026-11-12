export type Point = { x: number; y: number };
export type CollisionMode = "none" | "wall" | "solid";
export type Tool = "select" | "pan" | "line" | "pen" | "rectangle" | "ellipse" | "polygon";
export type RegionKind = "wheat"|"corn"|"forest"|"vegetation";
export type RegionRecipe = { kind:RegionKind;density:number;spacing:number;rotation:number;patternDirection?:number;randomness:number;seed:number;scale:number;edgePadding:number;cluster:number;templateId?:string };
export type BezierHandles = { incoming?:Point;outgoing?:Point };

export type Style = {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  dash: "solid" | "dashed" | "dotted";
};

export type Shape = {
  id: string;
  name: string;
  kind: "path" | "rectangle" | "ellipse";
  points: Point[];
  smooth?: boolean;
  closed: boolean;
  style: Style;
  collision: CollisionMode;
  collisionThickness: number;
  visible: boolean;
  locked: boolean;
  revision: number;
  createdAt: number;
  parentId: string | null;
  generator?: RegionRecipe;
  handles?: (BezierHandles|null)[];
};

export type MapGroup = { id:string;name:string;parentId:string|null;visible:boolean;locked:boolean };
export type MapTemplate = { id:string;name:string;shapes:Shape[];groups?:MapGroup[] };

export type WorldMap = {
  formatVersion: 1;
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  restrictCharacterToBounds?: boolean;
  grid: number;
  snap: boolean;
  backgroundColor?: string;
  shapes: Shape[];
  groups?: MapGroup[];
  templates?: MapTemplate[];
  updatedAt: number;
};

export type MapShelf = { activeMapId: string; maps: WorldMap[] };

export const colors = {
  ink: "#e5e7eb",
  muted: "#88919f",
  dim: "#515c6c",
  panel: "#151a22",
  panelRaised: "#1b222c",
  line: "#29313d",
  canvas: "#10151c",
  accent: "#b6f36b",
  violet: "#a98bfa",
  water: "#214968",
  land: "#25372f",
  field: "#9a7938",
} as const;

export const defaultStyle: Style = {
  stroke: "#c9d6d0",
  fill: "transparent",
  strokeWidth: 3,
  opacity: 1,
  dash: "solid",
};

const now = Date.now();
const shape = (id: string, name: string, points: Point[], style: Partial<Style>, extras: Partial<Shape> = {}): Shape => ({
  id, name, kind: "path", points, closed: false, style: { ...defaultStyle, ...style }, collision: "none",
  smooth: false, collisionThickness: 14, visible: true, locked: false, revision: 1, createdAt: now, parentId: null, ...extras,
});

export function createSampleMap(): WorldMap {
  const shapes: Shape[] = [
    shape("river", "Silverwater river", [{ x: -410, y: -74 }, { x: -260, y: -34 }, { x: -80, y: 10 }, { x: 100, y: -30 }, { x: 350, y: 45 }, { x: 435, y: 70 }], { stroke: colors.water, strokeWidth: 38 }, { collision: "none" }),
    shape("ridge", "North ridge", [{ x: -420, y: -250 }, { x: -250, y: -185 }, { x: -80, y: -205 }, { x: 105, y: -160 }, { x: 300, y: -188 }, { x: 430, y: -148 }], { stroke: "#56624d", strokeWidth: 6, dash: "dotted" }, { collision: "wall", collisionThickness: 16 }),
    shape("main-road", "Old road", [{ x: -430, y: 190 }, { x: -285, y: 130 }, { x: -145, y: 152 }, { x: -30, y: 114 }, { x: 110, y: 138 }, { x: 250, y: 106 }, { x: 420, y: 132 }], { stroke: "#8c7b63", strokeWidth: 20 }, { collision: "none" }),
    shape("wall", "Outer wall", [{ x: -195, y: -80 }, { x: -65, y: -102 }, { x: -50, y: 2 }, { x: -178, y: 25 }], { stroke: "#d0c1a2", fill: "#665b4b", strokeWidth: 4 }, { kind: "path", closed: true, collision: "solid" }),
    shape("hall", "Old watch hall", [{ x: -150, y: -63 }, { x: -96, y: -72 }, { x: -90, y: -20 }, { x: -142, y: -11 }], { stroke: "#e4d4ad", fill: "#4b5146", strokeWidth: 3 }, { closed: true, collision: "solid" }),
    shape("farm-wheat", "Wheat field", [{ x: 92, y: 184 }, { x: 330, y: 180 }, { x: 344, y: 295 }, { x: 105, y: 312 }], { stroke: "#d4ad55", fill: "#64552c55", strokeWidth: 2 }, { closed: true, collision: "none" }),
    shape("farm-corn", "Corn plot", [{ x: 15, y: 203 }, { x: 78, y: 190 }, { x: 88, y: 305 }, { x: 24, y: 315 }], { stroke: "#84a460", fill: "#40533a99", strokeWidth: 2 }, { closed: true, collision: "none" }),
    shape("forest-edge", "Pinewood boundary", [{ x: -358, y: -94 }, { x: -282, y: -142 }, { x: -206, y: -125 }, { x: -235, y: -48 }, { x: -329, y: -34 }], { stroke: "#668a66", fill: "#334a3c99", strokeWidth: 2 }, { closed: true, collision: "none" }),
    shape("boulder", "Boundary boulder", [{ x: 230, y: -25 }, { x: 265, y: -43 }, { x: 300, y: -18 }, { x: 288, y: 16 }, { x: 251, y: 23 }, { x: 223, y: 1 }], { stroke: "#a8a3a0", fill: "#535860", strokeWidth: 3 }, { closed: true, collision: "solid" }),
    shape("spawn", "Camp spawn", [{ x: 0, y: 172 }], { stroke: "#b6f36b", fill: "#b6f36b", strokeWidth: 2 }),
  ];
  // Hand-placed editable vector trees make the map immediately useful without raster assets.
  const treeSites: Point[] = [
    {x:-328,y:-82},{x:-302,y:-106},{x:-279,y:-77},{x:-252,y:-112},{x:-232,y:-80},{x:-319,y:-52},
    {x:-290,y:-50},{x:-266,y:-92},{x:-239,y:-58},{x:-344,y:-91},{x:-212,y:-99},{x:-306,y:-128},
    {x:322,y:-85},{x:286,y:-66},{x:351,y:-57},{x:248,y:-80},{x:339,y:-116},{x:292,y:-115},
  ];
  for (const [index, point] of treeSites.entries()) {
    shapes.push(shape(`tree-${index}`, `Pine tree ${index + 1}`, [{ x: point.x, y: point.y }, { x: point.x + 10, y: point.y + 8 }, { x: point.x - 10, y: point.y + 8 }], { stroke: "#829e6d", fill: "#456244", strokeWidth: 2 }, { closed: true, collision: "none" }));
  }
  return { formatVersion: 1, id: crypto.randomUUID(), name: "The Quiet Reach", width: null, height: null, restrictCharacterToBounds:false, grid: 24, snap: true, backgroundColor:"#263e30", shapes, updatedAt: now };
}

export function createBlankMap(name = "Untitled map"): WorldMap {
  const base = createSampleMap();
  return { ...base, id: crypto.randomUUID(), name, shapes: [], updatedAt: Date.now() };
}

export function newShape(kind: Shape["kind"], points: Point[], name: string, closed = false): Shape {
  return {
    id: crypto.randomUUID(), name, kind, points, closed, style: { ...defaultStyle }, collision: "none",
    smooth: false, collisionThickness: 14, visible: true, locked: false, revision: 1, createdAt: Date.now(), parentId: null,
  };
}

export function defaultBezierHandles(points:Point[],closed=false): (BezierHandles|null)[] {
  return points.map((point,index)=>{const previous=closed?points[(index-1+points.length)%points.length]:points[Math.max(0,index-1)],next=closed?points[(index+1)%points.length]:points[Math.min(points.length-1,index+1)],dx=(next.x-previous.x)/6,dy=(next.y-previous.y)/6;return{...(closed||index>0?{incoming:{x:point.x-dx,y:point.y-dy}}:{}),...(closed||index<points.length-1?{outgoing:{x:point.x+dx,y:point.y+dy}}:{})}});
}

export function validateMapData(input: unknown): WorldMap {
  if (!input || typeof input !== "object") throw new Error("The file is not a Worldweave map.");
  const value = input as Partial<WorldMap>;
  if (value.formatVersion !== 1 || !Array.isArray(value.shapes) || typeof value.name !== "string") {
    throw new Error("Unsupported or malformed map file. Worldweave format version 1 is required.");
  }
  const ids = new Set<string>();
  const shapes = value.shapes.map((candidate) => {
    const item = candidate as Shape;
    if (!item || typeof item.id !== "string" || ids.has(item.id) || !Array.isArray(item.points) || item.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      throw new Error("Map contains an invalid shape or duplicate ID.");
    }
    ids.add(item.id);
    return { ...item, points: item.points.map((p) => ({ x: p.x, y: p.y })) };
  });
  const sourceGroups=Array.isArray(value.groups)?value.groups.filter(group=>group&&typeof group.id==="string"&&typeof group.name==="string"):[];
  if(sourceGroups.length>2000)throw new Error("Map contains too many groups.");
  const sourceGroupIds=new Set<string>();for(const group of sourceGroups){if(sourceGroupIds.has(group.id))throw new Error("Map contains duplicate group IDs.");sourceGroupIds.add(group.id);}
  const groupParents=new Map(sourceGroups.map(group=>[group.id,group.parentId]));
  for(const group of sourceGroups){const visited=new Set<string>([group.id]);let parent=group.parentId;while(parent){if(visited.has(parent))throw new Error("Map contains a group cycle.");visited.add(parent);parent=groupParents.get(parent)??null;}}
  const groupIds=new Map(sourceGroups.map(group=>[group.id,crypto.randomUUID()]));
  return {
    formatVersion: 1, id: crypto.randomUUID(), name: value.name, width: value.width ?? null, height: value.height ?? null, restrictCharacterToBounds:value.restrictCharacterToBounds===true,
    grid: Math.max(4, Math.min(256, Number(value.grid) || 24)), snap: Boolean(value.snap), backgroundColor:typeof value.backgroundColor==="string"&&/^#[0-9a-f]{6}$/i.test(value.backgroundColor)?value.backgroundColor:"#263e30",
    shapes: shapes.map((item)=>({...item,id:crypto.randomUUID(),revision:1,parentId:item.parentId?groupIds.get(item.parentId)??null:null})),
    groups:sourceGroups.map(group=>({id:groupIds.get(group.id)!,name:group.name,parentId:group.parentId?groupIds.get(group.parentId)??null:null,visible:group.visible!==false,locked:Boolean(group.locked)})),
    templates:Array.isArray(value.templates)?value.templates.filter((template):template is MapTemplate=>Boolean(template&&typeof template.id==="string"&&typeof template.name==="string"&&Array.isArray(template.shapes))).map(template=>{const groups=template.groups??[],ids=new Map(groups.map(group=>[group.id,crypto.randomUUID()]));return{...template,id:crypto.randomUUID(),groups:groups.map(group=>({...group,id:ids.get(group.id)!,parentId:group.parentId?ids.get(group.parentId)??null:null})),shapes:template.shapes.map(item=>({...item,id:crypto.randomUUID(),revision:1,parentId:item.parentId?ids.get(item.parentId)??null:null}))}}):[],updatedAt: Date.now(),
  };
}
