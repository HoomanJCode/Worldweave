import { pointInPolygon, pathBounds } from "./geometry";
import type { Point, RegionKind, RegionRecipe } from "./model";

export type GeneratedInstance = { x: number; y: number; rotation: number; scale: number; variant: number };

function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function insideWithPadding(point: Point, polygon: Point[], padding: number): boolean {
  if (!pointInPolygon(point, polygon)) return false;
  if (!padding) return true;
  // Eight radial probes keep the full proxy bounds of a generated template inside the region.
  for (let i=0;i<8;i++) { const angle=i*Math.PI/4; if (!pointInPolygon({x:point.x+Math.cos(angle)*padding,y:point.y+Math.sin(angle)*padding},polygon)) return false; }
  return true;
}

export function generateRegion(polygon: Point[], recipe: RegionRecipe, templateRadius = 8): GeneratedInstance[] {
  if (polygon.length < 3) return [];
  const bounds = pathBounds(polygon), random = randomStream(recipe.seed), spacing = Math.max(4, recipe.spacing), padding = Math.max(0,recipe.edgePadding)+templateRadius*Math.max(.2,recipe.scale);
  const area = Math.max(1,(bounds.maxX-bounds.minX)*(bounds.maxY-bounds.minY));
  const target = Math.min(10000,Math.floor(area/(spacing*spacing)*Math.max(.05,recipe.density)));
  const instances: GeneratedInstance[] = [];
  if (recipe.kind === "wheat" || recipe.kind === "corn") {
    const angle = recipe.patternDirection ?? 0, cos = Math.cos(angle), sin = Math.sin(angle);
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const local = polygon.map((point) => ({ x: (point.x-center.x)*cos + (point.y-center.y)*sin, y: -(point.x-center.x)*sin + (point.y-center.y)*cos }));
    const localBounds = pathBounds(local), adjustedSpacing = spacing / Math.sqrt(Math.max(.1, recipe.density));
    const rowStep = adjustedSpacing * (recipe.kind === "corn" ? 1.35 : .8), colStep = adjustedSpacing * (recipe.kind === "corn" ? 1.35 : .8);
    for (let y = localBounds.minY + rowStep/2; y <= localBounds.maxY && instances.length < target; y += rowStep) {
      for (let x = localBounds.minX + colStep/2; x <= localBounds.maxX && instances.length < target; x += colStep) {
        const jitter = (recipe.randomness ?? 0) * adjustedSpacing * .42;
        const lx=x+(random()-.5)*jitter, ly=y+(random()-.5)*jitter;
        const point={x:center.x+lx*cos-ly*sin,y:center.y+lx*sin+ly*cos};
        if (!insideWithPadding(point, polygon, padding)) continue;
        if (random() > Math.min(1, Math.max(.05, recipe.density))) continue;
        instances.push({x:point.x,y:point.y,rotation:recipe.rotation+(random()-.5)*(recipe.randomness??0)*.35,scale:recipe.scale*(.75+random()*.5),variant:Math.floor(random()*4)});
      }
    }
    return instances;
  }
  for (let tries=0;tries<target*12 && instances.length<target;tries++) {
    const x=bounds.minX+random()*(bounds.maxX-bounds.minX), y=bounds.minY+random()*(bounds.maxY-bounds.minY);
    if (!insideWithPadding({x,y},polygon,padding)) continue;
    if (recipe.kind === "forest" && random() > Math.max(.1,Math.min(1,recipe.cluster))) continue;
    instances.push({ x, y, rotation:recipe.rotation+(random()-.5)*recipe.randomness*2, scale:recipe.scale*(.75+random()*.5), variant:Math.floor(random()*4) });
  }
  return instances;
}
