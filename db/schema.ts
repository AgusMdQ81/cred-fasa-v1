import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const directoryRecords = sqliteTable("directory_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordType: text("record_type").notNull(),
  recordKey: text("record_key").notNull(),
  data: text("data").notNull(),
});

export const fasaProfiles = sqliteTable("fasa_profiles", {
  fasaId: text("fasa_id").primaryKey(),
  dni: text("dni").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  nationality: text("nationality").notNull().default("Argentina"),
  club: text("club").notNull().default(""),
  birthDate: text("birth_date").notNull().default(""),
  email: text("email").notNull().default(""),
  password: text("password").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  province: text("province").notNull().default(""),
  region: text("region").notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  dniUnique: uniqueIndex("fasa_profiles_dni_unique").on(table.dni),
}));

export const fasaRoles = sqliteTable("fasa_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fasaId: text("fasa_id").notNull(),
  roleType: text("role_type").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (table) => ({
  personRoleUnique: uniqueIndex("fasa_roles_person_role_unique").on(table.fasaId, table.roleType),
}));

function roleTable(name: string) {
  return sqliteTable(name, {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fasaId: text("fasa_id").notNull(),
    data: text("data").notNull().default("{}"),
  }, (table) => ({ personUnique: uniqueIndex(`${name}_person_unique`).on(table.fasaId) }));
}

export const athleteProfiles = roleTable("athlete_profiles");
export const judgeProfiles = roleTable("judge_profiles");
export const juryPresidentProfiles = roleTable("jury_president_profiles");
export const regionalRepresentativeProfiles = roleTable("regional_representative_profiles");
export const organizerProfiles = roleTable("organizer_profiles");
export const administratorProfiles = roleTable("administrator_profiles");
