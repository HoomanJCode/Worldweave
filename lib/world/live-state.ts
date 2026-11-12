import { useSyncExternalStore } from "react";
import type { Point } from "./model";

export type LiveCursor = { id: string; name: string; color: string; cursor: Point | null; character?: Point | null };

let coordinate: Point = { x: 0, y: 0 };
let cursors: LiveCursor[] = [];
const serverCoordinate: Point = { x: 0, y: 0 };
const serverCursors: LiveCursor[] = [];
const coordinateListeners = new Set<() => void>();
const cursorListeners = new Set<() => void>();

function subscribe(listeners: Set<() => void>, listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishCoordinate(next: Point) {
  if (Math.abs(next.x - coordinate.x) < 0.5 && Math.abs(next.y - coordinate.y) < 0.5) return;
  coordinate = next;
  coordinateListeners.forEach((listener) => listener());
}

export function publishLiveCursors(next: LiveCursor[]) {
  if (next.length === cursors.length && next.every((item, index) => {
    const previous = cursors[index];
    return previous?.id === item.id && previous.name === item.name && previous.color === item.color && previous.cursor?.x === item.cursor?.x && previous.cursor?.y === item.cursor?.y && previous.character?.x === item.character?.x && previous.character?.y === item.character?.y;
  })) return;
  cursors = next;
  cursorListeners.forEach((listener) => listener());
}

export function useWorldCoordinate() {
  return useSyncExternalStore((listener) => subscribe(coordinateListeners, listener), () => coordinate, () => serverCoordinate);
}

export function useLiveCursors() {
  return useSyncExternalStore((listener) => subscribe(cursorListeners, listener), () => cursors, () => serverCursors);
}
