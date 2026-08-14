CREATE TABLE `chief_route_setter_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chief_route_setter_profiles_person_unique` ON `chief_route_setter_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `competition_participations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition_id` integer NOT NULL,
	`fasa_id` text NOT NULL,
	`role_type` text NOT NULL,
	`role_label` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `competition_participations_unique` ON `competition_participations` (`competition_id`,`fasa_id`,`role_type`);--> statement-breakpoint
CREATE TABLE `route_setter_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `route_setter_profiles_person_unique` ON `route_setter_profiles` (`fasa_id`);