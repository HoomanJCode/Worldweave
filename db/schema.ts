import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sharedRooms = sqliteTable("shared_rooms", {
  id: text("id").primaryKey(),
  accessHash: text("access_hash").notNull(),
  mapJson: text("map_json").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

export const roomPresence = sqliteTable("room_presence", {
  roomId: text("room_id").notNull(),
  participantId: text("participant_id").notNull(),
  displayName: text("display_name").notNull(),
  color: text("color").notNull(),
  cursorJson: text("cursor_json"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [primaryKey({ columns: [table.roomId, table.participantId] })]);
