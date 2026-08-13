CREATE TABLE `directory_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_type` text NOT NULL,
	`record_key` text NOT NULL,
	`data` text NOT NULL
);
