CREATE TABLE `fasa_profiles` (
	`fasa_id` text PRIMARY KEY NOT NULL,
	`dni` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`nationality` text DEFAULT 'Argentina' NOT NULL,
	`club` text DEFAULT '' NOT NULL,
	`birth_date` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`password` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`province` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`photo_url` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fasa_profiles_dni_unique` ON `fasa_profiles` (`dni`);--> statement-breakpoint
CREATE TABLE `fasa_role_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`role_type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fasa_role_details_person_role_unique` ON `fasa_role_details` (`fasa_id`,`role_type`);--> statement-breakpoint
CREATE TABLE `fasa_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fasa_id` text NOT NULL,
	`role_type` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fasa_roles_person_role_unique` ON `fasa_roles` (`fasa_id`,`role_type`);