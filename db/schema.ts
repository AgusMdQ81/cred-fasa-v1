import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const directoryRecords = sqliteTable("directory_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordType: text("record_type").notNull(),
  recordKey: text("record_key").notNull(),
  data: text("data").notNull(),
});
