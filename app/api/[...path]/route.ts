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
  duration_seconds: 300,
  remaining_seconds: 300,
  running: false,
  started_at: null as number | null,
  updated_at: new Date().toISOString(),
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

function leaderboard(url: URL) {
  const round = (url.searchParams.get("round") || "clasificatoria") as RoundKey;
  const category = url.searchParams.get("category") || "mayor";
  const gender = url.searchParams.get("gender") || "Mujer";
  return competitors
    .filter((competitor) => !category || competitor.category === category)
    .filter((competitor) => !gender || competitor.gender === gender)
    .map((competitor) => {
      const rows = savedScores.filter((score) => score.competitor_id === competitor.id && score.round === round);
      const boulders = Array.from({ length: rounds[round].boulders }, (_, index) => rows.find((row) => row.boulder === index + 1)?.score || 0);
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
      };
    })
    .sort((a, b) => b.total_score - a.total_score)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = pathFrom(request);
  if (path === "config") return json({ rounds });
  if (path === "competitions") return json(competitions);
  if (path === "judge-people") return json(judgePeople);
  if (path === "regional-representatives") return json([]);
  if (path === "judges") return json(getJudges());
  if (path === "timer") return json(timerState);
  if (path === "competitors") {
    const category = url.searchParams.get("category") || "mayor";
    const gender = url.searchParams.get("gender") || "Mujer";
    return json(competitors.filter((competitor) => competitor.category === category && competitor.gender === gender));
  }
  if (path === "competition-registrants") {
    const category = url.searchParams.get("category") || "mayor";
    const gender = url.searchParams.get("gender") || "Mujer";
    const competitionId = Number(url.searchParams.get("competition_id") || 1);
    const competition = competitions.find((item) => item.id === competitionId) || competitions[0];
    const eligible = competitors.filter((competitor) => {
      if (competitor.gender !== gender) return false;
      if (competition.category === "Mayores") return competitor.category !== "U17";
      if (competition.category === "Juveniles") return competitor.category === category && category !== "mayor";
      return competitor.category === category;
    });
    return json(eligible.slice(0, 18).map((competitor, index) => {
      const payment_validated = index % 3 !== 0;
      return {
        registration_id: index + 1,
        competition_id: competition.id,
        ...competitor,
        category: competition.category === "Mayores" ? "mayor" : competitor.category,
        original_category: competitor.category,
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
    timerState = {
      ...timerState,
      round,
      boulder: Number(payload.boulder || 1),
      duration_seconds: rounds[round].minutes * 60,
      remaining_seconds: rounds[round].minutes * 60,
      running: payload.action === "start",
      started_at: payload.action === "start" ? Date.now() / 1000 : null,
      updated_at: new Date().toISOString(),
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
    return json({ ok: true });
  }
  if (path === "config") return json({ rounds });
  if (path === "competitions") return json({ ok: true, id: Date.now() });
  if (path === "competitors") return json({ ok: true, id: Date.now() });
  if (path === "seed") return json(competitors);
  if (path === "judge-people") return json(judgePeople);
  if (path === "judges") return json(getJudges());
  if (path === "regional-representatives") return json([]);
  if (path === "judge-portal-login") return json({ profile: judgePeople[0], assignments: competitions });
  if (path === "judge-portal-profile") return json({ profile: payload.profile || judgePeople[0], assignments: competitions });
  if (path === "competitor-login" || path === "competitor-register" || path === "competitor-profile") return json({ competitor: competitors[1], competitions, registrations: [] });
  if (path === "competition-registrations") return json({ competitor: competitors[1], competitions, registrations: [{ competition_id: payload.competition_id }] });
  if (path === "competition-registration-status") return json({ ok: true });
  return json({ ok: true });
}

export async function DELETE() {
  return json({ ok: true });
}
