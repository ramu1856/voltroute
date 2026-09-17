CREATE TABLE `community_flags` (
	`report` text NOT NULL,
	`owner` text NOT NULL,
	`reported_at` integer NOT NULL,
	PRIMARY KEY(`report`, `owner`),
	FOREIGN KEY (`report`) REFERENCES `community_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `community_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`station` text NOT NULL,
	`status` text NOT NULL,
	`day` text NOT NULL,
	`reported_at` integer NOT NULL,
	`visibility` text DEFAULT 'shared' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_one_daily` ON `community_reports` (`owner`,`station`,`day`);--> statement-breakpoint
CREATE INDEX `community_station_time` ON `community_reports` (`station`,`reported_at`);--> statement-breakpoint
CREATE TABLE `station_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`station` text NOT NULL,
	`status` text NOT NULL,
	`reported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_owner_station` ON `station_history` (`owner`,`station`,`reported_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO station_history(id,owner,station,status,reported_at)
SELECT 'legacy:' || owner || ':' || id,owner,
json_extract(payload,'$.sourceId'),json_extract(payload,'$.status'),updated
FROM saved_items
WHERE kind='report' AND json_valid(payload)
AND json_extract(payload,'$.sourceId') IS NOT NULL
AND json_extract(payload,'$.status') IN ('working','busy','broken');
