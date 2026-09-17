CREATE TABLE `provider_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`next` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_items` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
