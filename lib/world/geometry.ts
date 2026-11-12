import type { Point } from "./model";

export type Camera = { x: number; y: number; zoom: number };
export type Size = { width: number; height: number };
export type Matrix = [number, number, number, number, number, number];

export function worldToScreen(point: Point, camera: Camera, size: Size): Point {
  return { x: (point.x - camera.x) * camera.zoom + size.width / 2, y: (point.y - camera.y) * camera.zoom + size.height / 2 };
}

export function screenToWorld(point: Point, camera: Camera, size: Size): Point {
  return { x: (point.x - size.width / 2) / camera.zoom + camera.x, y: (point.y - size.height / 2) / camera.zoom + camera.y };
}

export function zoomAt(camera: Camera, screen: Point, size: Size, nextZoom: number): Camera {
  const anchor = screenToWorld(screen, camera, size);
  const zoom = Math.min(4, Math.max(0.12, nextZoom));
  return { zoom, x: anchor.x - (screen.x - size.width / 2) / zoom, y: anchor.y - (screen.y - size.height / 2) / zoom };
}

export function transformPoint(point: Point, anchor: Point, scaleX: number, scaleY: number, rotation: number): Point {
  const x=(point.x-anchor.x)*scaleX,y=(point.y-anchor.y)*scaleY,cos=Math.cos(rotation),sin=Math.sin(rotation);
  return {x:anchor.x+x*cos-y*sin,y:anchor.y+x*sin+y*cos};
}

export function fitCamera(points: Point[], size: Size, padding = 72): Camera {
  if (!points.length) return { x: 0, y: 0, zoom: 1 };
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.min(4, Math.max(0.12, Math.min((size.width - padding * 2) / Math.max(1, maxX - minX), (size.height - padding * 2) / Math.max(1, maxY - minY)))) };
}

export function invertMatrix([a,b,c,d,e,f]: Matrix): Matrix | null {
  const determinant = a*d-b*c;
  if (Math.abs(determinant) < 1e-12) return null;
  return [d/determinant,-b/determinant,-c/determinant,a/determinant,(c*f-d*e)/determinant,(b*e-a*f)/determinant];
}

export function applyMatrix([a,b,c,d,e,f]: Matrix, point: Point): Point {
  return { x: a*point.x+c*point.y+e, y: b*point.x+d*point.y+f };
}

export function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  const [a,b,c,d,e,f] = left, [g,h,i,j,k,l] = right;
  return [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x-start.x, dy = end.y-start.y;
  const length = dx*dx+dy*dy;
  const t = length ? Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/length)) : 0;
  return Math.hypot(point.x-(start.x+t*dx),point.y-(start.y+t*dy));
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if ((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

export function splitCubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): [Point[], Point[]] {
  const lerp=(a:Point,b:Point):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const p01=lerp(p0,p1),p12=lerp(p1,p2),p23=lerp(p2,p3),p012=lerp(p01,p12),p123=lerp(p12,p23),p=lerp(p012,p123);
  return [[p0,p01,p012,p],[p,p123,p23,p3]];
}

export function pathBounds(points: Point[]): { minX:number;minY:number;maxX:number;maxY:number } {
  return { minX:Math.min(...points.map(p=>p.x)), minY:Math.min(...points.map(p=>p.y)), maxX:Math.max(...points.map(p=>p.x)), maxY:Math.max(...points.map(p=>p.y)) };
}
