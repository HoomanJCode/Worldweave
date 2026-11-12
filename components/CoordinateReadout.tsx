"use client";

import { useWorldCoordinate } from "@/lib/world/live-state";

export function CoordinateReadout() {
  const coordinate = useWorldCoordinate();
  return <span className="coords">X <b>{Math.round(coordinate.x)}</b><i/>Y <b>{Math.round(coordinate.y)}</b></span>;
}
