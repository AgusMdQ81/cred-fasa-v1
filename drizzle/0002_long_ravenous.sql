CREATE TABLE `administrator_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `administrator_profiles_person_unique` ON `administrator_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `athlete_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `athlete_profiles_person_unique` ON `athlete_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `judge_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `judge_profiles_person_unique` ON `judge_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `jury_president_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jury_president_profiles_person_unique` ON `jury_president_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `organizer_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizer_profiles_person_unique` ON `organizer_profiles` (`fasa_id`);--> statement-breakpoint
CREATE TABLE `regional_representative_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_representative_profiles_person_unique` ON `regional_representative_profiles` (`fasa_id`);--> statement-breakpoint
DROP TABLE `fasa_role_details`;