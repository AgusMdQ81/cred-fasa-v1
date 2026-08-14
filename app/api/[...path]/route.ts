import { env } from "cloudflare:workers";

type RoundKey = "clasificatoria" | "semifinal" | "final";

const rounds: Record<RoundKey, { label: string; active: number; boulders: number; minutes: number }> = {
  clasificatoria: { label: "Clasificatoria", active: 1, boulders: 5, minutes: 5 },
  semifinal: { label: "Semifinal", active: 1, boulders: 5, minutes: 4 },
  final: { label: "Final", active: 1, boulders: 4, minutes: 4 },
};

const judgePeople = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  first_name: ["Valeria", "Martin", "Laura", "Andres", "Camila", "Tomas", "Sofia", "Lucas"][index % 8],
  last_name: ["Gomez", "Costa", "Rivas", "Sosa", "Perez", "Diaz", "Molina", "Suarez"][index % 8],
  dni: String(28000000 + index * 913).slice(0, 8),
  mail: `juez${String(index + 1).padStart(2, "0")}@fasa.test`,
  phone: `2235${String(100000 + index).slice(0, 6)}`,
  club: ["AEBA", "CABA", "Andino", "Centro", "Cuyo", "Litoral"][index % 6],
  level: (index % 5) + 1,
  active: true,
  photo_url: "",
}));

const competitions = [
  {
    id: 1,
    name: "CRED Buenos Aires Boulder",
    event_date: "2026-09-12",
    competition_type: "CRED",
    modality: "Boulder",
    category: "Mayores",
    organizer_club: "AEBA",
    jury_president_id: 2,
    region: "Buenos Aires",
    jury_president: { ...judgePeople[1], password: judgePeople[1].mail },
    admin_user: { username: judgePeople[1].mail, password: judgePeople[1].mail },
    organizer_user: {
      dni: "30111222",
      first_name: "Agustin",
      last_name: "Lopez",
      display_name: "Agustin Lopez",
      username: "organizador@fasa.test",
      password: "organizador@fasa.test",
      club: "AEBA",
    },
  },
  {
    id: 2,
    name: "CRED Patagonia Norte",
    event_date: "2026-10-03",
    competition_type: "CRED",
    modality: "Boulder",
    category: "Juveniles",
    organizer_club: "Club Andino",
    jury_president_id: 5,
    region: "Patagonia Norte",
    jury_president: { ...judgePeople[4], password: judgePeople[4].mail },
    admin_user: { username: judgePeople[4].mail, password: judgePeople[4].mail },
    organizer_user: null,
  },
  {
    id: 3,
    name: "CAED Nacional",
    event_date: "2026-11-21",
    competition_type: "CAED",
    modality: "Dificultad",
    category: "Mayores",
    organizer_club: "FASA",
    jury_president_id: 8,
    region: "",
    jury_president: { ...judgePeople[7], password: judgePeople[7].mail },
    admin_user: { username: judgePeople[7].mail, password: judgePeople[7].mail },
    organizer_user: null,
  },
];

const competitors = Array.from({ length: 40 }, (_, index) => {
  const category = index % 3 === 0 ? "U17" : index % 3 === 1 ? "U19" : "mayor";
  const gender = index % 2 === 0 ? "Mujer" : "Hombre";
  return {
    id: index + 1,
    first_name: ["Sofia", "Mateo", "Camila", "Lucas", "Martina", "Tomas", "Julia", "Nicolas"][index % 8],
    last_name: ["Perez", "Gomez", "Costa", "Rivas", "Diaz", "Sosa", "Molina", "Suarez"][index % 8],
    email: `competidor${String(index + 1).padStart(2, "0")}@fasa.test`,
    password: "admin",
    phone: `2236${String(100000 + index).slice(0, 6)}`,
    dni: String(41000000 + index * 719).slice(0, 8),
    club: ["AEBA", "CABA", "Andino", "Centro", "Cuyo", "Litoral"][index % 6],
    address: "Direccion demo",
    province: ["Buenos Aires", "Cordoba", "Mendoza", "Neuquen"][index % 4],
    nationality: "Argentina",
    region: ["Buenos Aires", "Centro", "Cuyo", "Noa", "Litoral", "Patagonia Norte", "Patagonia Sur"][index % 7],
    photo_url: "",
    gender,
    birth_date: category === "mayor" ? "2000-04-14" : category === "U19" ? "2009-05-20" : "2011-03-11",
    bib_number: index + 1,
    category,
  };
});

let timerState = {
  id: 1,
  round: "clasificatoria",
  boulder: 1,
  timer_schema: 3,
  mode: "manual",
  genders: ["Mujer", "Hombre"],
  armed: false,
  scheduled_start_at: null as string | null,
  phase: "prep",
  prep_seconds: 15,
  cycle: 1,
  duration_seconds: 300,
  remaining_seconds: 300,
  running: false,
  started_at: null as number | null,
  updated_at: Date.now(),
};

let savedScores = competitors.slice(0, 12).flatMap((competitor, index) =>
  (["clasificatoria", "semifinal", "final"] as RoundKey[]).flatMap((round) =>
    Array.from({ length: rounds[round].boulders }, (_, boulderIndex) => {
      const attempts = (index + boulderIndex) % 4 + 1;
      const top = (index + boulderIndex) % 3 === 0 ? attempts : null;
      const zone = top || ((index + boulderIndex) % 2 === 0 ? attempts : null);
      return {
        competitor_id: competitor.id,
        round,
        boulder: boulderIndex + 1,
        attempts,
        zone_attempt: zone,
        top_attempt: top,
        score: calculateScore(zone, top),
        judge_name: "Juez demo",
        judge_username: "juez01@fasa.test",
        judge_role: "principal",
        official: true,
        bib_number: competitor.bib_number,
        first_name: competitor.first_name,
        last_name: competitor.last_name,
      };
    })
  )
);

function calculateScore(zone: number | null, top: number | null) {
  if (top) return Number((25 - Math.max(0, top - 1) * 0.1).toFixed(1));
  if (zone) return Number((10 - Math.max(0, zone - 1) * 0.1).toFixed(1));
  return 0;
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

async function ensureDirectoryTable() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS directory_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type TEXT NOT NULL,
    record_key TEXT NOT NULL,
    data TEXT NOT NULL
  )`).run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS directory_records_type_key_idx ON directory_records(record_type, record_key)").run();
}

async function ensureFasaTables() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fasa_profiles (
      fasa_id TEXT PRIMARY KEY, dni TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      nationality TEXT NOT NULL DEFAULT 'Argentina', club TEXT NOT NULL DEFAULT '', birth_date TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', photo_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS fasa_profiles_email_unique ON fasa_profiles(email) WHERE email <> ''"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fasa_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fasa_id TEXT NOT NULL, role_type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(fasa_id, role_type)
    )`),
    ...["athlete_profiles", "judge_profiles", "route_setter_profiles", "chief_route_setter_profiles", "jury_president_profiles", "regional_representative_profiles", "organizer_profiles", "administrator_profiles"].map((table) =>
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, fasa_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL DEFAULT '{}')`)
    ),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS competition_participations (id INTEGER PRIMARY KEY AUTOINCREMENT, competition_id INTEGER NOT NULL, fasa_id TEXT NOT NULL, role_type TEXT NOT NULL, role_label TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(competition_id,fasa_id,role_type))`),
  ]);
}

function cleanDni(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function makeFasaId(dni: string) {
  return `FASA-${dni.padStart(8, "0")}`;
}

function commonProfile(record: Record<string, unknown>) {
  const dni = cleanDni(record.dni);
  return {
    fasa_id: String(record.fasa_id || makeFasaId(dni)), dni,
    first_name: String(record.first_name || ""), last_name: String(record.last_name || ""),
    nationality: String(record.nationality || "Argentina"), club: String(record.club || ""),
    birth_date: String(record.birth_date || ""), email: String(record.email || record.mail || "").trim().toLowerCase(),
    password: String(record.password || ""), phone: String(record.phone || ""), address: String(record.address || ""),
    province: String(record.province || ""), region: String(record.region || ""), photo_url: String(record.photo_url || ""),
  };
}

async function upsertFasaProfile(record: Record<string, unknown>) {
  await ensureFasaTables();
  const profile = commonProfile(record);
  if (!profile.dni) throw new Error("El DNI es obligatorio para vincular el Perfil FASA.");
  const existing = await env.DB.prepare("SELECT fasa_id, password FROM fasa_profiles WHERE dni = ? OR fasa_id = ? LIMIT 1").bind(profile.dni, profile.fasa_id).first<{ fasa_id: string; password: string }>();
  profile.fasa_id = existing?.fasa_id || profile.fasa_id;
  profile.password = profile.password || existing?.password || "";
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO fasa_profiles
    (fasa_id,dni,first_name,last_name,nationality,club,birth_date,email,password,phone,address,province,region,photo_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(fasa_id) DO UPDATE SET dni=excluded.dni,first_name=excluded.first_name,last_name=excluded.last_name,
    nationality=excluded.nationality,club=excluded.club,birth_date=excluded.birth_date,email=excluded.email,password=excluded.password,
    phone=excluded.phone,address=excluded.address,province=excluded.province,region=excluded.region,photo_url=excluded.photo_url,updated_at=excluded.updated_at`)
    .bind(profile.fasa_id,profile.dni,profile.first_name,profile.last_name,profile.nationality,profile.club,profile.birth_date,
      profile.email,profile.password,profile.phone,profile.address,profile.province,profile.region,profile.photo_url,now,now).run();
  return profile;
}

async function assignRole(fasaId: string, roleType: string, details: Record<string, unknown> = {}) {
  await ensureFasaTables();
  const detailTable = roleDetailTable(roleType);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO fasa_roles (fasa_id,role_type,active) VALUES (?,?,1) ON CONFLICT(fasa_id,role_type) DO UPDATE SET active=1").bind(fasaId, roleType),
    env.DB.prepare(`INSERT INTO ${detailTable} (fasa_id,data) VALUES (?,?) ON CONFLICT(fasa_id) DO UPDATE SET data=excluded.data`).bind(fasaId, JSON.stringify(details)),
  ]);
}

function roleDetailTable(roleType: string) {
  const tables: Record<string, string> = {
    competitor: "athlete_profiles", athlete: "athlete_profiles",
    judge: "judge_profiles", judge_portal: "judge_profiles",
    route_setter: "route_setter_profiles", chief_route_setter: "chief_route_setter_profiles",
    competition_admin: "jury_president_profiles", jury_president: "jury_president_profiles",
    regional_representative: "regional_representative_profiles",
    organizer: "organizer_profiles",
    general_admin: "administrator_profiles", administrator: "administrator_profiles",
  };
  return tables[roleType] || "athlete_profiles";
}

async function loadRoleDirectory(roleType: string, fallback: Array<Record<string, unknown>>) {
  await ensureFasaTables();
  const detailTable = roleDetailTable(roleType);
  const result = await env.DB.prepare(`SELECT p.*, d.data FROM fasa_profiles p
    JOIN fasa_roles r ON r.fasa_id=p.fasa_id AND r.role_type=? AND r.active=1
    LEFT JOIN ${detailTable} d ON d.fasa_id=p.fasa_id ORDER BY p.last_name,p.first_name`)
    .bind(roleType).all<Record<string, unknown> & { data?: string }>();
  if (!result.results.length) return fallback;
  return result.results.map((row) => {
    const details = row.data ? JSON.parse(String(row.data)) : {};
    const { data: _data, password: _password, created_at: _created, updated_at: _updated, ...profile } = row;
    return { ...profile, mail: profile.email, ...details };
  });
}

async function saveRoleDirectory(roleType: string, records: Array<Record<string, unknown>>) {
  const saved = [];
  for (const record of records) {
    const profile = await upsertFasaProfile(record);
    const commonKeys = new Set(["fasa_id","dni","first_name","last_name","nationality","club","birth_date","email","mail","password","phone","address","province","region","photo_url"]);
    const details = Object.fromEntries(Object.entries(record).filter(([key]) => !commonKeys.has(key)));
    await assignRole(profile.fasa_id, roleType, details);
    saved.push({ ...record, ...profile, mail: profile.email });
  }
  return saved;
}

async function ensureCompetitionRecords() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS competition_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'approved',
    creator_role TEXT NOT NULL DEFAULT '',
    creator_fasa_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

async function seedTestFasaData() {
  await ensureFasaTables();
  const roleTables = ["athlete_profiles","judge_profiles","route_setter_profiles","chief_route_setter_profiles","jury_president_profiles","regional_representative_profiles","organizer_profiles","administrator_profiles"];
  await env.DB.batch([env.DB.prepare("DELETE FROM competition_participations"), env.DB.prepare("DELETE FROM fasa_roles"), ...roleTables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)), env.DB.prepare("DELETE FROM fasa_profiles"), env.DB.prepare("DELETE FROM directory_records")]);
  const maleNames = ["Mateo","Lucas","Tomas","Nicolas","Bruno","Franco","Santiago","Joaquin","Benjamin","Bautista","Lautaro","Agustin","Facundo","Martin","Ignacio","Felipe","Valentin","Ramiro","Gonzalo","Leandro","Emiliano","Federico","Marcos","Sebastian","Maximo","Thiago","Dante","Simon","Juan Cruz","Pedro","Manuel","Alejo","Salvador","Jeremias","Lisandro","Nahuel","Ezequiel","Renzo","Luciano","Cristobal"];
  const femaleNames = ["Sofia","Camila","Martina","Julia","Valentina","Malena","Catalina","Delfina","Lucia","Victoria","Renata","Juana","Pilar","Emilia","Mora","Paula","Carolina","Antonella","Milagros","Abril","Clara","Agustina","Lola","Josefina","Candela","Bianca","Florencia","Micaela","Rocio","Lara","Elena","Aitana","Alma","Olivia","Ines","Noelia","Mariana","Daniela","Sol","Celeste"];
  const lastNames = ["Perez","Gomez","Costa","Rivas","Diaz","Sosa","Molina","Suarez","Fernandez","Lopez","Romero","Acosta","Navarro","Vega","Herrera","Castro","Medina","Aguirre","Benitez","Cabrera","Dominguez","Farias","Gimenez","Ibarra","Luna","Mendez","Nuñez","Ortega","Ponce","Quiroga","Ramirez","Silva","Torres","Vargas","Villalba","Alvarez","Blanco","Campos","Correa","Duarte","Escobar","Ferreyra","Godoy","Ledesma","Mansilla","Peralta","Reyes","Roldan","Santillan","Zarate","Andrada","Barrios","Bustamante","Cardozo","Carrizo","Cejas","Contreras","Delgado","Farina","Flores","Franco","Gauna","Juarez","Leiva","Lucero","Maldonado","Marquez","Miranda","Montenegro","Morales","Muñoz","Ojeda","Olmedo","Paez","Palacios","Paredes","Paz","Pereyra","Ramos","Rivero","Robledo","Rojas","Ruiz","Salinas","Sandoval","Toledo","Valdez","Velazquez","Vera","Zamora"];
  const specs: Array<{ count: number; roles: Array<{ type: string; data: Record<string, unknown> }>; gender?: string }> = [
    { count: 40, gender: "Hombre", roles: [{ type: "competitor", data: { category: "mayor", gender: "Hombre", public_profile: true } }] },
    { count: 20, gender: "Mujer", roles: [{ type: "competitor", data: { category: "mayor", gender: "Mujer", public_profile: true } }] },
    { count: 20, roles: [{ type: "judge", data: {} }] }, { count: 20, roles: [{ type: "route_setter", data: {} }] },
    { count: 20, roles: [{ type: "judge", data: {} }, { type: "route_setter", data: {} }] },
    { count: 3, roles: [{ type: "general_admin", data: {} }] }, { count: 20, roles: [] },
  ];
  const allFirstNames = [...maleNames, ...femaleNames];
  const firstNameCounts = new Map<string, number>(); const lastNameCounts = new Map<string, number>();
  const usedFullNames = new Set<string>(); const statements = [];
  const pickLeastUsed = (pool: string[], counts: Map<string, number>, start: number, pairedFirst?: string) => {
    const available = pool
      .map((value, offset) => ({ value, offset, count: counts.get(value) || 0 }))
      .filter(({ value, count }) => count < 2 && (!pairedFirst || !usedFullNames.has(`${pairedFirst}|${value}`)))
      .sort((a, b) => a.count - b.count || ((a.offset - start + pool.length) % pool.length) - ((b.offset - start + pool.length) % pool.length));
    if (!available.length) throw new Error("No hay suficientes nombres únicos para generar los perfiles FASA ID");
    const selected = available[0].value; counts.set(selected, (counts.get(selected) || 0) + 1); return selected;
  };
  let index = 0;
  for (const spec of specs) for (let local = 0; local < spec.count; local++) {
    index++; const dni = String(30000000 + index); const fasaId = makeFasaId(dni); const now = new Date().toISOString();
    const namePool = spec.gender === "Mujer" ? femaleNames : spec.gender === "Hombre" ? maleNames : allFirstNames;
    const first = pickLeastUsed(namePool, firstNameCounts, index - 1);
    const last = pickLeastUsed(lastNames, lastNameCounts, index - 1, first);
    usedFullNames.add(`${first}|${last}`);
    const photo = spec.gender === "Mujer" ? "/assets/female-athlete-demo.png" : spec.gender === "Hombre" ? "/assets/admin-demo-portrait.png" : "";
    const isAdministrator = spec.roles.some((role) => role.type === "general_admin");
    const testPassword = isAdministrator ? "admin" : "1234";
    statements.push(env.DB.prepare(`INSERT INTO fasa_profiles (fasa_id,dni,first_name,last_name,nationality,club,birth_date,email,password,phone,address,province,region,photo_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(fasaId,dni,first,last,"Argentina",["AEBA","CABA","Club Andino","Centro","Cuyo","Litoral"][index%6],"1998-05-12",`persona${index}@fasa.test`,testPassword,`11${String(40000000+index)}`,"Direccion de prueba",["Buenos Aires","Cordoba","Mendoza","Neuquen"][index%4],["Buenos Aires","Centro","Cuyo","Noa","Litoral","Patagonia Norte","Patagonia Sur"][index%7],photo,now,now));
    for (const role of spec.roles) {
      const level = role.type === "judge" || role.type === "route_setter" ? (local % 5) + 1 : undefined;
      const data = { ...role.data, ...(level ? { level } : {}), ...(role.type === "competitor" ? { instagram: `@${first.toLowerCase()}.climbs`, discipline: "Boulder" } : {}) };
      statements.push(env.DB.prepare("INSERT INTO fasa_roles (fasa_id,role_type,active) VALUES (?,?,1)").bind(fasaId,role.type));
      statements.push(env.DB.prepare(`INSERT INTO ${roleDetailTable(role.type)} (fasa_id,data) VALUES (?,?)`).bind(fasaId,JSON.stringify(data)));
    }
  }
  for (let i=0;i<statements.length;i+=75) await env.DB.batch(statements.slice(i,i+75));
  return { profiles: index, athletes: 60, judges: 20, route_setters: 20, dual: 20, administrators: 3, without_roles: 20 };
}

async function loadDirectoryRecords(recordType: string, fallback: unknown[]) {
  await ensureDirectoryTable();
  const result = await env.DB.prepare("SELECT data FROM directory_records WHERE record_type = ? ORDER BY id").bind(recordType).all<{ data: string }>();
  if (!result.results.length) return fallback;
  return result.results.map((row) => JSON.parse(row.data));
}

async function saveDirectoryRecords(recordType: string, records: Array<Record<string, unknown>>) {
  await ensureDirectoryTable();
  const normalized = records.map((record, index) => ({ ...record, id: record.id || Date.now() + index }));
  const statements = [env.DB.prepare("DELETE FROM directory_records WHERE record_type = ?").bind(recordType)];
  normalized.forEach((record) => statements.push(
    env.DB.prepare("INSERT INTO directory_records (record_type, record_key, data) VALUES (?, ?, ?)")
      .bind(recordType, String(record.id), JSON.stringify(record))
  ));
  await env.DB.batch(statements);
  return normalized;
}

function pathFrom(request: Request) {
  return new URL(request.url).pathname.replace(/^\/api\/?/, "");
}

function getJudges() {
  return judgePeople.slice(0, 5).map((person, index) => ({
    id: index + 1,
    competition_id: 1,
    judge_person_id: person.id,
    display_name: `${person.first_name} ${person.last_name}`,
    username: person.mail,
    password: person.mail,
    active: true,
    assignments: { clasificatoria: index + 1, semifinal: index + 1, final: Math.min(index + 1, 4) },
    roles: { clasificatoria: "principal", semifinal: "principal", final: "principal" },
    person,
  }));
}

function competitionById(competitionId: number) {
  return competitions.find((item) => item.id === competitionId) || competitions[0];
}

function registeredCompetitors(competitionId: number, gender = "Mujer", category = "mayor") {
  const competition = competitionById(competitionId);
  return competitors
    .filter((competitor) => competitor.gender === gender)
    .filter((competitor) => {
      if (competition.category === "Mayores") return competitor.category !== "U17";
      if (competition.category === "Juveniles") return competitor.category === category && category !== "mayor";
      return competitor.category === category;
    })
    .map((competitor) => ({
      ...competitor,
      competition_id: competition.id,
      category: competition.category === "Mayores" ? "mayor" : competitor.category,
      original_category: competitor.category,
    }));
}

function leaderboard(url: URL) {
  const round = (url.searchParams.get("round") || "clasificatoria") as RoundKey;
  const category = url.searchParams.get("category") || "mayor";
  const gender = url.searchParams.get("gender") || "Mujer";
  const competitionId = Number(url.searchParams.get("competition_id") || 1);
  return registeredCompetitors(competitionId, gender, category)
    .map((competitor) => {
      const rows = savedScores.filter((score) => score.competitor_id === competitor.id && score.round === round);
      const boulderDetails = Array.from({ length: rounds[round].boulders }, (_, index) => {
        const row = rows.find((score) => score.boulder === index + 1);
        return {
          score: row?.score || 0,
          zone_attempt: row?.zone_attempt || null,
          top_attempt: row?.top_attempt || null,
        };
      });
      const boulders = boulderDetails.map((detail) => detail.score);
      return {
        rank: 0,
        bib_number: competitor.bib_number,
        first_name: competitor.first_name,
        last_name: competitor.last_name,
        club: competitor.club,
        total_score: boulders.reduce((sum, value) => sum + value, 0),
        tops: rows.filter((row) => row.top_attempt).length,
        zones: rows.filter((row) => row.zone_attempt).length,
        attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
        boulders,
        boulder_details: boulderDetails,
      };
    })
    .sort((a, b) => b.total_score - a.total_score)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = pathFrom(request);
  if (path === "config") return json({ rounds });
  if (path === "competitions") {
    await ensureCompetitionRecords();
    const saved = await env.DB.prepare("SELECT id,data,status,creator_role,creator_fasa_id,created_at,updated_at FROM competition_records ORDER BY id").all<{ id: number; data: string; status: string; creator_role: string; creator_fasa_id: string; created_at: string; updated_at: string }>();
    return json([...competitions.map((item) => ({ ...item, status: "approved", creator_role: "general_admin" })), ...saved.results.map((row) => ({ ...JSON.parse(row.data), id: row.id + 1000, record_id: row.id, status: row.status, creator_role: row.creator_role, creator_fasa_id: row.creator_fasa_id, created_at: row.created_at, updated_at: row.updated_at }))]);
  }
  if (path === "judge-people") return json(await loadRoleDirectory("judge", []));
  if (path === "route-setter-people") return json(await loadRoleDirectory("route_setter", []));
  if (path === "administrators") return json(await loadRoleDirectory("general_admin", []));
  if (path === "regional-representatives") return json(await loadRoleDirectory("regional_representative", []));
  if (path === "fasa-profiles") {
    await ensureFasaTables();
    const result = await env.DB.prepare(`SELECT p.fasa_id,p.dni,p.first_name,p.last_name,p.nationality,p.club,p.birth_date,p.email,p.phone,p.address,p.province,p.region,p.photo_url,
      COALESCE(GROUP_CONCAT(CASE WHEN r.active=1 THEN r.role_type END), '') AS roles
      FROM fasa_profiles p LEFT JOIN fasa_roles r ON r.fasa_id=p.fasa_id GROUP BY p.fasa_id ORDER BY p.last_name,p.first_name`).all();
    return json(result.results);
  }
  if (path === "public-athlete-rankings") {
    const type = String(url.searchParams.get("type") || "argentine"); const region = String(url.searchParams.get("region") || "");
    const gender = String(url.searchParams.get("gender") || "Mujer"); const category = String(url.searchParams.get("category") || "mayor"); const discipline = String(url.searchParams.get("discipline") || "Boulder");
    const athletes = await loadRoleDirectory("competitor", []);
    const rows = athletes.filter((person) => person.public_profile === true && person.gender === gender && person.category === category && String(person.discipline || "Boulder") === discipline)
      .filter((person) => type !== "regional" || person.region === region)
      .map((person, index) => ({ ...person, name: `${person.first_name} ${person.last_name}`, points: 3100 - index * 37 }))
      .sort((a,b) => Number(b.points)-Number(a.points)).map((person,index) => ({ ...person, rank:index+1 }));
    return json(rows);
  }
  if (path === "fasa-cv") {
    await ensureFasaTables();
    const fasaId = String(url.searchParams.get("fasa_id") || "");
    const roles = await env.DB.prepare("SELECT role_type FROM fasa_roles WHERE fasa_id=? AND active=1 ORDER BY id").bind(fasaId).all<{ role_type: string }>();
    const details: Record<string, unknown> = {};
    for (const row of roles.results) {
      const item = await env.DB.prepare(`SELECT data FROM ${roleDetailTable(row.role_type)} WHERE fasa_id=? LIMIT 1`).bind(fasaId).first<{ data: string }>();
      details[row.role_type] = item?.data ? JSON.parse(item.data) : {};
    }
    const history = await env.DB.prepare("SELECT competition_id,role_type,role_label,created_at FROM competition_participations WHERE fasa_id=? ORDER BY competition_id DESC").bind(fasaId).all<Record<string, unknown>>();
    return json({ roles: roles.results.map((row) => row.role_type), role_details: details, history: history.results.map((item) => ({ ...item, competition: competitionById(Number(item.competition_id)) })) });
  }
  if (path === "competition-route-setters") {
    await ensureFasaTables();
    const competitionId = Number(url.searchParams.get("competition_id") || 1);
    const people = await loadRoleDirectory("route_setter", []);
    const assigned = await env.DB.prepare("SELECT fasa_id,role_type FROM competition_participations WHERE competition_id=? AND role_type IN ('route_setter','chief_route_setter')").bind(competitionId).all();
    return json({ people, assigned: assigned.results });
  }
  if (path === "fasa-profile") {
    await ensureFasaTables();
    const key = String(url.searchParams.get("id") || url.searchParams.get("email") || "").trim().toLowerCase();
    const profile = await env.DB.prepare("SELECT * FROM fasa_profiles WHERE lower(email)=? OR fasa_id=? OR dni=? LIMIT 1").bind(key, key.toUpperCase(), cleanDni(key)).first<Record<string, unknown>>();
    if (!profile) return json({ error: "Perfil FASA no encontrado." }, { status: 404 });
    const roles = await env.DB.prepare("SELECT role_type FROM fasa_roles WHERE fasa_id=? AND active=1 ORDER BY id").bind(profile.fasa_id).all<{ role_type: string }>();
    const { password: _password, created_at: _created, updated_at: _updated, ...safeProfile } = profile;
    return json({ profile: safeProfile, roles: roles.results.map((row) => row.role_type) });
  }
  if (path === "seed-test-data") return json({ error: "Usá POST para regenerar los datos." }, { status: 405 });
  if (path === "regional-representative-assignment") {
    await ensureFasaTables();
    const fasaId = String(payload.fasa_id || "");
    const region = String(payload.region || "");
    const profile = await env.DB.prepare("SELECT * FROM fasa_profiles WHERE fasa_id=? LIMIT 1").bind(fasaId).first<Record<string, unknown>>();
    if (!profile) return json({ error: "La persona seleccionada no tiene un FASA ID válido." }, { status: 404 });
    if (!region) return json({ error: "Seleccioná una región." }, { status: 400 });
    await assignRole(fasaId, "regional_representative", { region, active: true });
    return json({ ok: true, fasa_id: fasaId, region });
  }
  if (path === "judge-role-batch") {
    await ensureFasaTables();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const apply = payload.apply === true;
    const results = [];
    for (const item of rows) {
      const dni = cleanDni(item.dni);
      const level = Number(item.level);
      if (!dni) {
        results.push({ dni, level: item.level, valid: false, message: "Ingresá un DNI." });
        continue;
      }
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        results.push({ dni, level: item.level, valid: false, message: "El nivel de juez debe ser un número entre 1 y 5." });
        continue;
      }
      const profile = await env.DB.prepare("SELECT fasa_id,dni,first_name,last_name,email,club,phone,photo_url FROM fasa_profiles WHERE dni=? LIMIT 1").bind(dni).first<Record<string, unknown>>();
      if (!profile) {
        results.push({ dni, level, valid: false, message: "Este DNI no tiene una FASA ID creada." });
        continue;
      }
      if (apply) await assignRole(String(profile.fasa_id), "judge", { level, active: true });
      results.push({ ...profile, mail: profile.email, level, active: true, valid: true, applied: apply, message: apply ? "Rol de juez asignado." : "FASA ID encontrado." });
    }
    return json({ rows: results, valid_count: results.filter((row) => row.valid).length, invalid_count: results.filter((row) => !row.valid).length });
  }
  if (path === "judges") return json(getJudges());
  if (path === "timer") return json(timerState);
  if (path === "competitors") {
    const category = url.searchParams.get("category") || "mayor";
    const gender = url.searchParams.get("gender") || "Mujer";
    const competitionId = Number(url.searchParams.get("competition_id") || 0);
    if (competitionId) return json(registeredCompetitors(competitionId, gender, category));
    return json(competitors.filter((competitor) => competitor.category === category && competitor.gender === gender));
  }
  if (path === "competition-registrants") {
    const category = url.searchParams.get("category") || "mayor";
    const gender = url.searchParams.get("gender") || "Mujer";
    const competitionId = Number(url.searchParams.get("competition_id") || 1);
    return json(registeredCompetitors(competitionId, gender, category).slice(0, 18).map((competitor, index) => {
      const payment_validated = index % 3 !== 0;
      return {
        registration_id: index + 1,
        ...competitor,
        payment_validated,
        accredited: payment_validated && index % 4 !== 0,
        registered_at: "2026-08-10",
      };
    }));
  }
  if (path === "leaderboard") return json(leaderboard(url));
  if (path === "scores") {
    const round = url.searchParams.get("round") || "clasificatoria";
    const boulder = Number(url.searchParams.get("boulder") || 0);
    return json(savedScores.filter((score) => score.round === round && (!boulder || score.boulder === boulder)));
  }
  if (path === "export.csv") {
    const body = "puesto,nro,competidor,total\n" + leaderboard(url).map((row) => `${row.rank},${row.bib_number},${row.last_name} ${row.first_name},${row.total_score}`).join("\n");
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8" } });
  }
  return json({ error: "No encontrado" }, { status: 404 });
}

export async function POST(request: Request) {
  const path = pathFrom(request);
  const payload = await request.json().catch(() => ({}));
  if (path === "unified-login") {
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!username || !password) return json({ error: "Ingresá usuario y contraseña." }, { status: 400 });

    await ensureFasaTables();
    const stored = await env.DB.prepare("SELECT * FROM fasa_profiles WHERE lower(email)=? OR dni=? LIMIT 1").bind(username, cleanDni(username)).first<Record<string, unknown>>();
    if (stored) {
      if (stored.password && String(stored.password) !== password) return json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
      const storedRoles = await env.DB.prepare("SELECT role_type FROM fasa_roles WHERE fasa_id=? AND active=1 ORDER BY id").bind(stored.fasa_id).all<{ role_type: string }>();
      const roles = storedRoles.results.map((row) => row.role_type);
      const roleDetails: Record<string, unknown> = {};
      for (const role of roles) {
        const item = await env.DB.prepare(`SELECT data FROM ${roleDetailTable(role)} WHERE fasa_id=? LIMIT 1`).bind(stored.fasa_id).first<{ data: string }>();
        roleDetails[role] = item?.data ? JSON.parse(item.data) : {};
      }
      const safeProfile = { ...stored, password: undefined, created_at: undefined, updated_at: undefined };
      return json({
        role: roles[0] || "competitor", roles: roles.length ? roles : ["competitor"],
        user: { ...safeProfile, display_name: `${stored.first_name} ${stored.last_name}`.trim(), username: stored.email, roles, role_details: roleDetails },
        judgePortal: { person: { ...safeProfile, mail: stored.email }, assignments: competitions },
        competitorPortal: { competitor: safeProfile, competitions, registrations: [] },
      });
    }

    let roles: string[] = ["competitor"];
    let displayName = "Atleta FASA";
    if (username === "admin") {
      if (password !== "admin") return json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
      roles = ["general_admin", "competition_admin", "organizer"];
      displayName = "Administrador general";
    } else if (username.includes("juez")) {
      roles = ["judge_portal", "judge"];
      displayName = "Juez FASA";
    } else if (username.includes("organizador")) {
      roles = ["organizer", "competitor"];
      displayName = "Organizador FASA";
    } else if (username.includes("referente")) {
      roles = ["regional_representative", "judge_portal"];
      displayName = "Referente regional";
    }

    const competitionId = Number(payload.competition_id || 1);
    return json({
      role: roles[0],
      roles,
      user: { display_name: displayName, username, competition_id: competitionId, roles },
      judgePortal: { person: judgePeople[0], assignments: competitions },
      competitorPortal: { competitor: competitors[1], competitions, registrations: [] },
    });
  }
  if (path === "login") {
    const username = String(payload.username || "").toLowerCase();
    const password = String(payload.password || "");
    if (username === "admin" && password === "admin") {
      return json({ role: "general_admin", user: { display_name: "Administrador general", username: "admin", competition_id: payload.competition_id || null } });
    }
    if (username === "organizador@fasa.test" || username.includes("organizador")) {
      return json({
        role: "organizer",
        user: {
          display_name: "Organizador demo",
          username,
          competition_id: payload.competition_id || 1,
          competition_name: competitions[0].name,
        },
      });
    }
    return json({ role: "competition_admin", user: { display_name: "Presidente demo", username, competition_id: payload.competition_id || 1, competition_name: competitions[0].name } });
  }
  if (path === "timer-authorize") return json({ ok: true, test_mode: true });
  if (path === "timer") {
    const round = (payload.round || timerState.round) as RoundKey;
    if (payload.state && typeof payload.state === "object") {
      const snapshot = payload.state as Record<string, unknown>;
      const snapshotRound = (snapshot.round || round) as RoundKey;
      timerState = {
        ...timerState,
        ...snapshot,
        round: snapshotRound,
        boulder: Number(snapshot.boulder || 1),
        timer_schema: 3,
        mode: String(snapshot.mode || "manual"),
        genders: Array.isArray(snapshot.genders) && snapshot.genders.length ? snapshot.genders.map(String) : ["Mujer", "Hombre"],
        armed: Boolean(snapshot.armed),
        scheduled_start_at: snapshot.scheduled_start_at ? String(snapshot.scheduled_start_at) : null,
        phase: snapshot.phase === "climb" ? "climb" : "prep",
        prep_seconds: Number(snapshot.prep_seconds || 15),
        duration_seconds: Number(snapshot.duration_seconds || rounds[snapshotRound].minutes * 60),
        remaining_seconds: Number(snapshot.remaining_seconds || 0),
        running: Boolean(snapshot.running),
        started_at: snapshot.started_at ? Number(snapshot.started_at) : null,
        cycle: Math.max(1, Number(snapshot.cycle || 1)),
        updated_at: Date.now(),
      };
      return json(timerState);
    }
    timerState = {
      ...timerState,
      round,
      boulder: Number(payload.boulder || 1),
      timer_schema: 3,
      phase: payload.action === "start" ? "prep" : timerState.phase,
      prep_seconds: 15,
      duration_seconds: rounds[round].minutes * 60,
      remaining_seconds: rounds[round].minutes * 60,
      running: payload.action === "start",
      started_at: payload.action === "start" ? Date.now() : null,
      updated_at: Date.now(),
    };
    return json(timerState);
  }
  if (path === "scores") {
    savedScores = savedScores.filter((score) => !(score.competitor_id === Number(payload.competitor_id) && score.round === payload.round && score.boulder === Number(payload.boulder) && score.judge_username === payload.judge_username));
    const competitor = competitors.find((item) => item.id === Number(payload.competitor_id)) || competitors[0];
    savedScores.push({
      competitor_id: competitor.id,
      round: payload.round,
      boulder: Number(payload.boulder),
      attempts: Number(payload.attempts || 0),
      zone_attempt: payload.zone_attempt ? Number(payload.zone_attempt) : null,
      top_attempt: payload.top_attempt ? Number(payload.top_attempt) : null,
      score: calculateScore(payload.zone_attempt ? Number(payload.zone_attempt) : null, payload.top_attempt ? Number(payload.top_attempt) : null),
      judge_name: payload.judge_name || "Juez demo",
      judge_username: payload.judge_username || "juez01@fasa.test",
      judge_role: "principal",
      official: payload.official !== false,
      bib_number: competitor.bib_number,
      first_name: competitor.first_name,
      last_name: competitor.last_name,
    });
    if (payload.judge_fasa_id) await env.DB.prepare("INSERT INTO competition_participations (competition_id,fasa_id,role_type,role_label,created_at) VALUES (?,?,?,?,?) ON CONFLICT(competition_id,fasa_id,role_type) DO UPDATE SET role_label=excluded.role_label").bind(Number(payload.competition_id || 1), String(payload.judge_fasa_id), "judge", "Juez", new Date().toISOString()).run();
    return json({ ok: true });
  }
  if (path === "config") return json({ rounds });
  if (path === "competitions") {
    await ensureCompetitionRecords();
    const creatorRole = String(payload.creator_role || "general_admin"); const status = creatorRole === "regional_representative" ? "pending" : "approved"; const now = new Date().toISOString();
    const data = { ...payload }; delete data.id; delete data.status;
    const result = await env.DB.prepare("INSERT INTO competition_records (data,status,creator_role,creator_fasa_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(JSON.stringify(data), status, creatorRole, String(payload.creator_fasa_id || ""), now, now).run();
    return json({ ok: true, id: Number(result.meta.last_row_id || 0) + 1000, status });
  }
  if (path === "competition-approval") {
    await ensureCompetitionRecords(); const recordId = Number(payload.record_id || 0); if (!recordId) return json({ error: "Competencia inválida." }, { status: 400 });
    await env.DB.prepare("UPDATE competition_records SET status='approved',updated_at=? WHERE id=?").bind(new Date().toISOString(), recordId).run(); return json({ ok: true, status: "approved" });
  }
  if (path === "competitors") return json({ ok: true, id: Date.now() });
  if (path === "seed") return json(competitors);
  if (path === "fasa-profile") {
    try {
      const profile = await upsertFasaProfile((payload.profile || payload) as Record<string, unknown>);
      let requestedRoles = Array.isArray(payload.roles) && payload.roles.length ? payload.roles.map(String) : [];
      if (payload.athlete_profile?.enabled && !requestedRoles.includes("competitor")) requestedRoles.push("competitor");
      if (!payload.athlete_profile?.enabled) requestedRoles = requestedRoles.filter((role: string) => role !== "competitor");
      for (const role of requestedRoles) await assignRole(profile.fasa_id, role);
      if (payload.athlete_profile?.enabled) await assignRole(profile.fasa_id, "competitor", { instagram: String(payload.athlete_profile.instagram || ""), public_profile: payload.athlete_profile.public_profile === true });
      else await env.DB.prepare("UPDATE fasa_roles SET active=0 WHERE fasa_id=? AND role_type='competitor'").bind(profile.fasa_id).run();
      const { password: _password, ...safeProfile } = profile;
      return json({ profile: safeProfile, roles: requestedRoles });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo guardar el Perfil FASA." }, { status: 400 });
    }
  }
  if (path === "admin-profile-update") {
    try { const profile = await upsertFasaProfile((payload.profile || payload) as Record<string, unknown>); const { password: _password, ...safeProfile } = profile; return json({ profile: safeProfile }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo actualizar la FASA ID." }, { status: 400 }); }
  }
  if (path === "profile-photo") {
    const fasaId = String(payload.fasa_id || ""); if (!fasaId) return json({ error: "FASA ID inválida." }, { status: 400 });
    await env.DB.prepare("UPDATE fasa_profiles SET photo_url=?,updated_at=? WHERE fasa_id=?").bind(String(payload.photo_url || ""), new Date().toISOString(), fasaId).run(); return json({ ok: true });
  }
  if (path === "seed-test-data") return json(await seedTestFasaData());
  if (path === "assign-person-role") {
    const fasaId = String(payload.fasa_id || ""); const role = String(payload.role || "");
    if (!fasaId || !["judge","route_setter","regional_representative","organizer","general_admin"].includes(role)) return json({ error: "Asignación inválida." }, { status: 400 });
    const person = await env.DB.prepare("SELECT fasa_id FROM fasa_profiles WHERE fasa_id=?").bind(fasaId).first();
    if (!person) return json({ error: "FASA ID no encontrada." }, { status: 404 });
    const details = role === "judge" || role === "route_setter" ? { level: Math.max(1,Math.min(5,Number(payload.level || 1))), active: true } : role === "regional_representative" ? { region: String(payload.region || ""), active: true } : { active: true };
    if (role === "regional_representative") {
      const current = await env.DB.prepare("SELECT fasa_id,data FROM regional_representative_profiles").all<{ fasa_id: string; data: string }>();
      const previous = current.results.find((item) => { try { return JSON.parse(item.data).region === details.region && item.fasa_id !== fasaId; } catch { return false; } });
      if (previous) await env.DB.prepare("UPDATE fasa_roles SET active=0 WHERE fasa_id=? AND role_type='regional_representative'").bind(previous.fasa_id).run();
    }
    await assignRole(fasaId, role, details); return json({ ok: true });
  }
  if (path === "update-role-detail") {
    const fasaId = String(payload.fasa_id || ""); const role = String(payload.role || "");
    if (!fasaId || !["judge", "route_setter"].includes(role)) return json({ error: "Actualización inválida." }, { status: 400 });
    const level = Math.max(1, Math.min(5, Number(payload.level || 1))); const active = payload.active !== false;
    await assignRole(fasaId, role, { level, active });
    if (!active) await env.DB.prepare("UPDATE fasa_roles SET active=0 WHERE fasa_id=? AND role_type=?").bind(fasaId, role).run();
    return json({ ok: true, level, active });
  }
  if (path === "administrator-status") {
    const fasaId = String(payload.fasa_id || ""); const active = payload.active === true;
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM fasa_roles WHERE role_type='general_admin' AND active=1").first<{ total: number }>();
    if (!active && Number(count?.total || 0) <= 2) return json({ error: "Nunca puede haber menos de dos administradores activos." }, { status: 400 });
    if (active) await assignRole(fasaId,"general_admin",{}); else await env.DB.prepare("UPDATE fasa_roles SET active=0 WHERE fasa_id=? AND role_type='general_admin'").bind(fasaId).run();
    return json({ ok: true });
  }
  if (path === "regional-representative-remove") {
    const fasaId = String(payload.fasa_id || ""); if (!fasaId) return json({ error: "Referente inválido." }, { status: 400 });
    await env.DB.prepare("UPDATE fasa_roles SET active=0 WHERE fasa_id=? AND role_type='regional_representative'").bind(fasaId).run(); return json({ ok: true });
  }
  if (path === "regional-representative-assignment") {
    const fasaId = String(payload.fasa_id || ""); const region = String(payload.region || "");
    const profile = await env.DB.prepare("SELECT fasa_id FROM fasa_profiles WHERE fasa_id=? LIMIT 1").bind(fasaId).first();
    if (!profile) return json({ error: "La persona seleccionada no tiene FASA ID." }, { status: 404 });
    await assignRole(fasaId, "regional_representative", { region, active: true }); return json({ ok: true });
  }
  if (path === "judge-role-batch" || path === "route-setter-role-batch") {
    const role = path === "judge-role-batch" ? "judge" : "route_setter";
    const roleLabel = role === "judge" ? "juez" : "aperturista";
    const rows = Array.isArray(payload.rows) ? payload.rows : []; const apply = payload.apply === true; const results = [];
    for (const item of rows) {
      const dni = cleanDni(item.dni); const level = Number(item.level);
      if (!dni) { results.push({ dni, level, valid: false, message: "Ingresá un DNI." }); continue; }
      if (!Number.isInteger(level) || level < 1 || level > 5) { results.push({ dni, level, valid: false, message: "El nivel debe ser un número entre 1 y 5." }); continue; }
      const profile = await env.DB.prepare("SELECT fasa_id,dni,first_name,last_name,email,club FROM fasa_profiles WHERE dni=? LIMIT 1").bind(dni).first<Record<string, unknown>>();
      if (!profile) { results.push({ dni, level, valid: false, message: "Este DNI no tiene una FASA ID creada." }); continue; }
      if (apply) await assignRole(String(profile.fasa_id), role, { level, active: true });
      results.push({ ...profile, mail: profile.email, level, active: true, valid: true, message: apply ? `Rol de ${roleLabel} asignado.` : "FASA ID encontrada." });
    }
    return json({ rows: results, valid_count: results.filter((row) => row.valid).length, invalid_count: results.filter((row) => !row.valid).length });
  }
  if (path === "competition-route-setters") {
    const competitionId = Number(payload.competition_id || 1); const chiefId = String(payload.chief_fasa_id || "");
    const team = Array.isArray(payload.team_fasa_ids) ? payload.team_fasa_ids.map(String) : [];
    if (chiefId) { await assignRole(chiefId, "chief_route_setter", {}); await env.DB.prepare("INSERT INTO competition_participations (competition_id,fasa_id,role_type,role_label,created_at) VALUES (?,?,?,?,?) ON CONFLICT(competition_id,fasa_id,role_type) DO UPDATE SET role_label=excluded.role_label").bind(competitionId, chiefId, "chief_route_setter", "Jefe de Aperturistas", new Date().toISOString()).run(); }
    for (const fasaId of team) await env.DB.prepare("INSERT INTO competition_participations (competition_id,fasa_id,role_type,role_label,created_at) VALUES (?,?,?,?,?) ON CONFLICT(competition_id,fasa_id,role_type) DO UPDATE SET role_label=excluded.role_label").bind(competitionId, fasaId, "route_setter", "Aperturista", new Date().toISOString()).run();
    return json({ ok: true });
  }
  if (path === "judge-people") return json(await saveRoleDirectory("judge", Array.isArray(payload.people) ? payload.people : []));
  if (path === "route-setter-people") return json(await saveRoleDirectory("route_setter", Array.isArray(payload.people) ? payload.people : []));
  if (path === "judges") return json(getJudges());
  if (path === "regional-representatives") return json(await saveRoleDirectory("regional_representative", Array.isArray(payload.representatives) ? payload.representatives : []));
  if (path === "judge-portal-login") return json({ profile: judgePeople[0], assignments: competitions });
  if (path === "judge-portal-profile") return json({ profile: payload.profile || judgePeople[0], assignments: competitions });
  if (path === "competitor-register") {
    try {
      const profile = await upsertFasaProfile(payload as Record<string, unknown>);
      const createAthlete = payload.create_athlete_profile === "on" || payload.create_athlete_profile === true;
      const age = new Date().getUTCFullYear() - Number(String(payload.birth_date || "2000").slice(0, 4));
      const category = age <= 16 ? "U17" : age <= 18 ? "U19" : "mayor";
      if (createAthlete) await assignRole(profile.fasa_id, "competitor", { category, gender: payload.gender || "", instagram: String(payload.instagram || ""), public_profile: payload.public_athlete_profile === "on" || payload.public_athlete_profile === true });
      const { password: _password, ...safeProfile } = profile;
      return json({ competitor: { ...safeProfile, instagram: payload.instagram || "", gender: payload.gender || "", category }, competitions, registrations: [], roles: createAthlete ? ["competitor"] : [] });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo crear el Perfil FASA." }, { status: 400 });
    }
  }
  if (path === "competitor-login" || path === "competitor-profile") return json({ competitor: competitors[1], competitions, registrations: [] });
  if (path === "competition-registrations") return json({ competitor: competitors[1], competitions, registrations: [{ competition_id: payload.competition_id }] });
  if (path === "competition-registration-status") return json({ ok: true });
  return json({ ok: true });
}

export async function DELETE() {
  return json({ ok: true });
}
