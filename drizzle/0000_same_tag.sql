CREATE TABLE `shared_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`access_hash` text NOT NULL,
	`map_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
