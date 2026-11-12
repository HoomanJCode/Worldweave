import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { sharedRooms } from "@/db/schema";
import { createSampleMap } from "@/lib/world/model";
import { applyMapOperations, diffMaps, type SyncOperation } from "@/lib/sync/patches";

export const runtime = "edge";

const MAX_MAP_BYTES = 350_000;
const MAX_SYNC_OPS = 2_000;
const EVENT_HISTORY = 160;
export const PUBLIC_ROOM_ID = "00000000-0000-4000-8000-000000000001";
type RoomEvent = { revision: number; participantId?: string; operations: SyncOperation[] };
type StoredRoom = { marker: "worldweave-room-v1"; map: Record<string, unknown>; events: RoomEvent[] };

function decodeRoom(raw: string, roomId?: string) {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const map=value.marker === "worldweave-room-v1" && value.map && typeof value.map === "object" ? value.map as Record<string,unknown> : value;
  return { map: roomId ? {...map,id:roomId} : map, events: value.marker === "worldweave-room-v1" && Array.isArray(value.events) ? value.events as RoomEvent[] : [] as RoomEvent[] };
}

function validOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  if (op.type === "shape.upsert") return validMap({ formatVersion: 1, id: "x", name: "x", shapes: [op.shape] }) && (op.expectedRevision === null || Number.isInteger(op.expectedRevision));
  if (op.type === "shape.delete") return typeof op.shapeId === "string" && Number.isInteger(op.expectedRevision);
  if (op.type === "map.patch") return Boolean(op.changes && typeof op.changes === "object" && !Array.isArray(op.changes) && op.expected && typeof op.expected === "object" && !Array.isArray(op.expected) && Object.keys(op.changes as object).every((key) => ["name", "width", "height", "restrictCharacterToBounds", "grid", "snap", "backgroundColor", "groups", "templates", "shapeOrder"].includes(key)));
  return false;
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readToken(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : "";
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const map = value as Record<string, unknown>;
  if (map.formatVersion !== 1 || typeof map.id !== "string" || typeof map.name !== "string" || !Array.isArray(map.shapes)) return false;
  if (map.shapes.length > 5000) return false;
  return map.shapes.every((item) => {
    if (!item || typeof item !== "object") return false;
    const shape = item as Record<string, unknown>;
    return typeof shape.id === "string" && Array.isArray(shape.points) && shape.points.length <= 5000 && shape.points.every((point) => {
      if (!point || typeof point !== "object") return false;
      const coordinates = point as Record<string, unknown>;
      return Number.isFinite(coordinates.x) && Number.isFinite(coordinates.y);
    });
  });
}

export async function POST(request: Request) {
  let body: { map?: unknown; global?: boolean };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MAP_BYTES) return errorResponse("This map is too large to share.", 413);
    body = JSON.parse(text) as { map?: unknown; global?: boolean };
  } catch {
    return errorResponse("The map data could not be read.", 400);
  }
  if (!validMap(body.map)) return errorResponse("This map is not valid.", 400);

  const id = body.global ? (body.map as Record<string,unknown>).id as string : crypto.randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorResponse("The map ID is not valid.", 400);
  const map={...(body.map as Record<string,unknown>),id};
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const accessHash=body.global?await hashToken("worldweave-public-room-v1"):await hashToken(token);
  const [room] = await getDb().insert(sharedRooms).values({ id, accessHash, mapJson: JSON.stringify(map), revision: 1 }).returning({ revision: sharedRooms.revision });
  return Response.json({ id, token:body.global?"":token, map, revision: room.revision }, { status: 201 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const publicHash=await hashToken("worldweave-public-room-v1");
  if(searchParams.get("list")==="global"){
    const rows=await getDb().select().from(sharedRooms);
    const maps=rows.filter(row=>row.accessHash===publicHash).map(row=>({map:decodeRoom(row.mapJson,row.id).map,revision:row.revision}));
    return Response.json({maps});
  }
  if (id === PUBLIC_ROOM_ID) {
    if (!env.DB) return errorResponse("Shared storage is unavailable right now.", 503);
    let [room] = await getDb().select().from(sharedRooms).where(eq(sharedRooms.id, PUBLIC_ROOM_ID)).limit(1);
    if (!room) {
      const map = createSampleMap();
      const accessHash = await hashToken("worldweave-public-room-v1");
      await env.DB.prepare("INSERT INTO shared_rooms (id, access_hash, map_json, revision, updated_at) VALUES (?, ?, ?, 1, unixepoch()) ON CONFLICT (id) DO NOTHING").bind(PUBLIC_ROOM_ID, accessHash, JSON.stringify(map)).run();
      [room] = await getDb().select().from(sharedRooms).where(eq(sharedRooms.id, PUBLIC_ROOM_ID)).limit(1);
    }
    if (!room) return errorResponse("The shared workspace could not be initialized.", 503);
    const snapshot = decodeRoom(room.mapJson,room.id), since = Number(searchParams.get("since"));
    if (Number.isInteger(since) && since === room.revision) return Response.json({ revision: room.revision, events: [], incremental: true });
    if (Number.isInteger(since) && since >= 0 && since < room.revision && snapshot.events.length && since >= snapshot.events[0].revision - 1) return Response.json({ revision: room.revision, events: snapshot.events.filter((event) => event.revision > since), incremental: true });
    return Response.json({ map: snapshot.map, revision: room.revision, updatedAt: room.updatedAt });
  }
  const token = readToken(request);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorResponse("This share link is invalid.", 400);
  const [room] = await getDb().select().from(sharedRooms).where(eq(sharedRooms.id, id)).limit(1);
  if (!room || (room.accessHash !== publicHash && (token.length < 32 || room.accessHash !== await hashToken(token)))) return errorResponse("This share link is invalid or revoked.", 404);
  const snapshot = decodeRoom(room.mapJson,room.id), since = Number(searchParams.get("since"));
  if (Number.isInteger(since) && since === room.revision) return Response.json({ revision: room.revision, events: [], incremental: true });
  if (Number.isInteger(since) && since >= 0 && since < room.revision && snapshot.events.length && since >= snapshot.events[0].revision - 1) return Response.json({ revision: room.revision, events: snapshot.events.filter((event) => event.revision > since), incremental: true });
  return Response.json({ map: snapshot.map, revision: room.revision, updatedAt: room.updatedAt });
}

export async function PUT(request: Request) {
  const token = readToken(request);
  let body: { id?: string; map?: unknown; operations?: unknown; participantId?: string; revision?: number };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MAP_BYTES) return errorResponse("This map is too large to sync.", 413);
    body = JSON.parse(text) as typeof body;
  } catch {
    return errorResponse("The map data could not be read.", 400);
  }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.revision !== "number" || !Number.isInteger(body.revision)) return errorResponse("The update is not valid.", 400);
  if (body.operations !== undefined && (!Array.isArray(body.operations) || body.operations.length > MAX_SYNC_OPS || !body.operations.every(validOperation))) return errorResponse("The edit operations are not valid.", 400);
  if (body.map !== undefined && !validMap(body.map)) return errorResponse("The map data is not valid.", 400);
  if (body.operations === undefined && body.map === undefined) return errorResponse("No map changes were supplied.", 400);
  const db = getDb();
  if (!env.DB) return errorResponse("Shared storage is unavailable right now.", 503);
  const [current] = await db.select({ accessHash: sharedRooms.accessHash, mapJson: sharedRooms.mapJson, revision: sharedRooms.revision }).from(sharedRooms).where(eq(sharedRooms.id, body.id)).limit(1);
  const publicHash=await hashToken("worldweave-public-room-v1");
  if(current?.accessHash!==publicHash&&token.length<32)return errorResponse("A valid share link is required.",401);
  const accessHash = current?.accessHash===publicHash ? publicHash : await hashToken(token);
  if (!current || current.accessHash !== accessHash) return errorResponse("This share link is invalid or revoked.", 404);
  const decoded = decodeRoom(current.mapJson,body.id), currentMap = decoded.map as unknown as import("@/lib/world/model").WorldMap;
  if (current.revision !== body.revision) return Response.json({ error: "conflict", map: currentMap, revision: current.revision }, { status: 409 });
  const operations = body.operations as SyncOperation[] | undefined;
  const finalOperations = operations ?? diffMaps(currentMap, body.map as import("@/lib/world/model").WorldMap);
  if (!finalOperations.length) return Response.json({ revision: current.revision, unchanged: true });
  for (const operation of finalOperations) {
    if (operation.type === "shape.upsert") {
      const existing = currentMap.shapes.find((shape) => shape.id === operation.shape.id);
      if (operation.expectedRevision === null ? Boolean(existing) : existing?.revision !== operation.expectedRevision) return Response.json({ error: "shape_conflict", map: currentMap, revision: current.revision }, { status: 409 });
    } else if (operation.type === "shape.delete") {
      const existing = currentMap.shapes.find((shape) => shape.id === operation.shapeId);
      if (existing?.revision !== operation.expectedRevision) return Response.json({ error: "shape_conflict", map: currentMap, revision: current.revision }, { status: 409 });
    } else {
      for (const [key, expected] of Object.entries(operation.expected)) {
        const actual = key === "shapeOrder" ? currentMap.shapes.map((shape) => shape.id) : (currentMap as unknown as Record<string, unknown>)[key];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) return Response.json({ error: "map_conflict", map: currentMap, revision: current.revision }, { status: 409 });
      }
    }
  }
  const nextMap = applyMapOperations(currentMap, finalOperations);
  if (!validMap(nextMap)) return errorResponse("The resulting map is invalid.", 400);
  const nextRevision = current.revision + 1;
  const event: RoomEvent = { revision: nextRevision, ...(body.participantId ? { participantId: body.participantId } : {}), operations: finalOperations };
  const stored: StoredRoom = { marker: "worldweave-room-v1", map: nextMap as unknown as Record<string, unknown>, events: [...decoded.events, event].slice(-EVENT_HISTORY) };
  // Client sends only changed shapes and map fields. D1 applies the patch against a versioned snapshot.
  const result = await env.DB.prepare(
    "UPDATE shared_rooms SET map_json = ?, revision = revision + 1, updated_at = unixepoch() WHERE id = ? AND access_hash = ? AND revision = ?",
  ).bind(JSON.stringify(stored), body.id, accessHash, body.revision).run();
  if (result.meta.changes === 1) return Response.json({ revision: nextRevision });
  const [latest] = await db.select({ mapJson: sharedRooms.mapJson, revision: sharedRooms.revision }).from(sharedRooms).where(eq(sharedRooms.id, body.id)).limit(1);
  if (!latest) return errorResponse("This share link is invalid or revoked.", 404);
  return Response.json({ error: "conflict", map: decodeRoom(latest.mapJson,body.id).map, revision: latest.revision }, { status: 409 });
}

export async function DELETE(request:Request){
  const id=new URL(request.url).searchParams.get("id")??"";
  if(!/^[0-9a-f-]{36}$/i.test(id)||id===PUBLIC_ROOM_ID)return errorResponse("Keep the default shared map as the workspace entry point.",400);
  if(!env.DB)return errorResponse("Shared storage is unavailable right now.",503);
  const [room]=await getDb().select({accessHash:sharedRooms.accessHash}).from(sharedRooms).where(eq(sharedRooms.id,id)).limit(1);
  const publicHash=await hashToken("worldweave-public-room-v1"),token=readToken(request);
  if(!room||(room.accessHash!==publicHash&&(token.length<32||room.accessHash!==await hashToken(token))))return errorResponse("This shared map cannot be deleted with this access.",404);
  await env.DB.prepare("DELETE FROM shared_rooms WHERE id = ? AND access_hash = ?").bind(id,room.accessHash).run();
  return Response.json({ok:true});
}
