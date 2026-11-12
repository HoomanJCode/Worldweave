import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sharedRooms } from "@/db/schema";

export const runtime = "edge";

type Cursor = { x: number; y: number };
type PresencePayload = { cursor?: Cursor | null; character?: Cursor | null };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readToken(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : "";
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorize(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const token = readToken(request);
  const [room] = await getDb().select({ accessHash: sharedRooms.accessHash }).from(sharedRooms).where(eq(sharedRooms.id, id)).limit(1);
  if (!room) return null;
  if(room.accessHash===await hashToken("worldweave-public-room-v1"))return{id,token:""};
  if (token.length < 32 || room.accessHash !== await hashToken(token)) return null;
  return { id, token };
}

export async function GET(request: Request) {
  if (!env.DB) return errorResponse("Shared storage is unavailable right now.", 503);
  const room = await authorize(request);
  if (!room) return errorResponse("This share link is invalid.", 404);
  const { results } = await env.DB.prepare(
    "SELECT participant_id, display_name, color, cursor_json FROM room_presence WHERE room_id = ? AND updated_at >= unixepoch() - 5",
  ).bind(room.id).all<{ participant_id: string; display_name: string; color: string; cursor_json: string | null }>();
  const participants = results.map((row) => {
    let payload: PresencePayload = {};
    try { const parsed = row.cursor_json ? JSON.parse(row.cursor_json) as Cursor | PresencePayload : null; if (parsed && "x" in parsed) payload = { cursor: parsed }; else payload = parsed ?? {}; } catch { payload = {}; }
    return { id: row.participant_id, name: row.display_name, color: row.color, cursor: payload.cursor ?? null, character: payload.character ?? null };
  });
  return Response.json({ participants });
}

export async function POST(request: Request) {
  if (!env.DB) return errorResponse("Shared storage is unavailable right now.", 503);
  let body: { id?: string; participantId?: string; name?: string; color?: string; cursor?: Cursor | null; character?: Cursor | null };
  try {
    const text = await request.text();
    if (text.length > 1200) return errorResponse("Presence update is too large.", 413);
    body = JSON.parse(text) as typeof body;
  } catch {
    return errorResponse("Presence update could not be read.", 400);
  }
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id) || !body.participantId || !/^[0-9a-f-]{36}$/i.test(body.participantId)) return errorResponse("Presence update is not valid.", 400);
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 24 || /[\u0000-\u001f]/.test(body.name) || !body.color || !/^#[0-9a-f]{6}$/i.test(body.color)) return errorResponse("Presence profile is not valid.", 400);
  if (body.cursor !== null && body.cursor !== undefined && (!Number.isFinite(body.cursor.x) || !Number.isFinite(body.cursor.y) || Math.abs(body.cursor.x) > 1_000_000 || Math.abs(body.cursor.y) > 1_000_000)) return errorResponse("Cursor coordinates are not valid.", 400);
  if (body.character !== null && body.character !== undefined && (!Number.isFinite(body.character.x) || !Number.isFinite(body.character.y) || Math.abs(body.character.x) > 1_000_000 || Math.abs(body.character.y) > 1_000_000)) return errorResponse("Character coordinates are not valid.", 400);

  const room = await authorize(request);
  if (!room || room.id !== body.id) return errorResponse("This share link is invalid.", 404);
  await env.DB.prepare(
    `INSERT INTO room_presence (room_id, participant_id, display_name, color, cursor_json, updated_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT (room_id, participant_id) DO UPDATE SET
       display_name = excluded.display_name,
       color = excluded.color,
       cursor_json = excluded.cursor_json,
       updated_at = unixepoch()`,
  ).bind(room.id, body.participantId, body.name, body.color, body.cursor || body.character ? JSON.stringify({ cursor: body.cursor ?? null, character: body.character ?? null }) : null).run();
  return Response.json({ ok: true });
}
