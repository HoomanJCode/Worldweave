CREATE TABLE `room_presence` (
	`room_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`display_name` text NOT NULL,
	`color` text NOT NULL,
	`cursor_json` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`room_id`, `participant_id`)
);
