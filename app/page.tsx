"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Role = "publico" | "admin" | "referente" | "juez" | "competidor";
type RoundKey = "clasificatoria" | "semifinal" | "final";

type Competition = {
  id: number;
  name: string;
  date: string;
  type: "CRED" | "CAED";
  modality: "Boulder" | "Dificultad" | "Velocidad";
  category: "Juveniles" | "Mayores";
  region: string;
  club: string;
  president: string;
};

type Competitor = {
  dni: string;
  bib: number;
  firstName: string;
  lastName: string;
  club: string;
  category: "U17" | "U19" | "Mayor";
  gender: "Hombre" | "Mujer";
  region: string;
  paid: boolean;
  accredited: boolean;
  score: number;
};

const regions = ["Buenos Aires", "Centro", "Cuyo", "Noa", "Litoral", "Patagonia Norte", "Patagonia Sur"];

const rounds: Record<RoundKey, { label: string; seconds: number; boulders: number }> = {
  clasificatoria: { label: "Clasificatoria", seconds: 300, boulders: 5 },
  semifinal: { label: "Semifinal", seconds: 240, boulders: 5 },
  final: { label: "Final", seconds: 240, boulders: 4 },
};

const initialCompetitions: Competition[] = [
  { id: 1, name: "CRED Buenos Aires Boulder", date: "2026-09-12", type: "CRED", modality: "Boulder", category: "Mayores", region: "Buenos Aires", club: "AEBA", president: "Valeria Gomez" },
  { id: 2, name: "CRED Patagonia Norte", date: "2026-10-03", type: "CRED", modality: "Boulder", category: "Juveniles", region: "Patagonia Norte", club: "Club Andino", president: "Martin Costa" },
  { id: 3, name: "CAED Nacional", date: "2026-11-21", type: "CAED", modality: "Dificultad", category: "Mayores", region: "Centro", club: "FASA", president: "Laura Rivas" },
];

const initialCompetitors: Competitor[] = Array.from({ length: 24 }, (_, index) => {
  const gender = index % 2 === 0 ? "Mujer" : "Hombre";
  const category = index % 3 === 0 ? "U17" : index % 3 === 1 ? "U19" : "Mayor";
  return {
    dni: String(41000000 + index).padStart(8, "0"),
    bib: index + 1,
    firstName: ["Sofia", "Mateo", "Camila", "Lucas", "Martina", "Tomas"][index % 6],
    lastName: ["Perez", "Gomez", "Costa", "Rivas", "Diaz", "Sosa"][index % 6],
    club: ["AEBA", "CABA", "Andino", "Centro", "Cuyo"][index % 5],
    category,
    gender,
    region: regions[index % regions.length],
    paid: index % 4 !== 0,
    accredited: index % 5 !== 0,
    score: Number((Math.max(0, 124 - index * 3.7)).toFixed(1)),
  };
});

const initialJudges = [
  { dni: "28900111", name: "Valeria Gomez", mail: "valeria.gomez@fasa.test", club: "AEBA", level: 2, region: "Buenos Aires" },
  { dni: "30111222", name: "Martin Costa", mail: "martin.costa@fasa.test", club: "Andino", level: 3, region: "Patagonia Norte" },
  { dni: "31222333", name: "Laura Rivas", mail: "laura.rivas@fasa.test", club: "FASA", level: 4, region: "Centro" },
  { dni: "32333444", name: "Andres Sosa", mail: "andres.sosa@fasa.test", club: "Cuyo", level: 1, region: "Cuyo" },
];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const [role, setRole] = useState<Role>("publico");
  const [view, setView] = useState("calendario");
  const [login, setLogin] = useState({ user: "", password: "" });
  const [competitions, setCompetitions] = useState<Competition[]>(initialCompetitions);
  const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors);
  const [activeCompetition, setActiveCompetition] = useState<Competition>(initialCompetitions[0]);
  const [filters, setFilters] = useState({ type: "", modality: "", category: "", region: "", gender: "", compCategory: "" });
  const [round, setRound] = useState<RoundKey>("clasificatoria");
  const [timer, setTimer] = useState({ phase: "prep" as "prep" | "climb", remaining: 15, running: false, startedAt: 0, cycle: 1 });
  const audioRef = useRef<AudioContext | null>(null);
  const lastAlarm = useRef<{ phase: string; remaining: number; cycle: number } | null>(null);
  const marks = useRef(new Set<string>());

  useEffect(() => {
    setCompetitions(loadJson("cred-sites-competitions", initialCompetitions));
    setCompetitors(loadJson("cred-sites-competitors", initialCompetitors));
  }, []);

  useEffect(() => {
    localStorage.setItem("cred-sites-competitions", JSON.stringify(competitions));
  }, [competitions]);

  useEffect(() => {
    localStorage.setItem("cred-sites-competitors", JSON.stringify(competitors));
  }, [competitors]);

  const visibleCompetitions = useMemo(() => competitions.filter((competition) =>
    (!filters.type || competition.type === filters.type) &&
    (!filters.modality || competition.modality === filters.modality) &&
    (!filters.category || competition.category === filters.category) &&
    (!filters.region || competition.region === filters.region)
  ), [competitions, filters]);

  const visibleCompetitors = useMemo(() => competitors.filter((competitor) =>
    (!filters.gender || competitor.gender === filters.gender) &&
    (!filters.compCategory || competitor.category === filters.compCategory)
  ), [competitors, filters.gender, filters.compCategory]);

  function beep(freq = 880, repeats = 1) {
    try {
      audioRef.current = audioRef.current || new AudioContext();
      if (audioRef.current.state === "suspended") void audioRef.current.resume();
      for (let index = 0; index < repeats; index += 1) {
        const osc = audioRef.current.createOscillator();
        const gain = audioRef.current.createGain();
        const start = audioRef.current.currentTime + index * 0.25;
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.connect(gain).connect(audioRef.current.destination);
        osc.start(start);
        osc.stop(start + 0.22);
      }
    } catch {
      return;
    }
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      setTimer((current) => {
        if (!current.running) return current;
        const phaseSeconds = current.phase === "prep" ? 15 : rounds[round].seconds;
        const elapsed = Math.floor((Date.now() - current.startedAt) / 1000);
        if (elapsed >= phaseSeconds) {
          const nextPhase = current.phase === "prep" ? "climb" : "prep";
          const next = {
            phase: nextPhase as "prep" | "climb",
            remaining: nextPhase === "prep" ? 15 : rounds[round].seconds,
            running: true,
            startedAt: Date.now(),
            cycle: current.phase === "climb" ? current.cycle + 1 : current.cycle,
          };
          if (current.phase === "prep") beep(920, 3);
          if (current.phase === "climb") beep(440, 4);
          lastAlarm.current = next;
          return next;
        }
        const next = { ...current, remaining: phaseSeconds - elapsed };
        const previous = lastAlarm.current;
        const crossed = (target: number) => previous && previous.phase === next.phase && previous.cycle === next.cycle && previous.remaining > target && next.remaining <= target;
        const once = (key: string, fn: () => void) => {
          const mark = `${next.cycle}-${next.phase}-${key}`;
          if (!marks.current.has(mark)) {
            marks.current.add(mark);
            fn();
          }
        };
        if (next.phase === "climb" && crossed(60)) once("60", () => beep(660, 2));
        [3, 2, 1].forEach((second) => {
          if (next.phase === "climb" && crossed(second)) once(String(second), () => beep(1040, 1));
        });
        lastAlarm.current = next;
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [round]);

  function enterDemo() {
    if (login.user === "admin" && login.password === "admin") {
      setRole("admin");
      setView("competencias");
      return;
    }
    setRole("publico");
  }

  function startPauseTimer() {
    audioRef.current = audioRef.current || new AudioContext();
    setTimer((current) => {
      if (current.running) return { ...current, running: false };
      const phaseSeconds = current.phase === "prep" ? 15 : rounds[round].seconds;
      const elapsed = phaseSeconds - current.remaining;
      marks.current.clear();
      lastAlarm.current = { ...current };
      beep(740, 2);
      return { ...current, running: true, startedAt: Date.now() - elapsed * 1000 };
    });
  }

  function stopTimer() {
    marks.current.clear();
    lastAlarm.current = null;
    setTimer({ phase: "prep", remaining: 15, running: false, startedAt: 0, cycle: 1 });
  }

  function addCompetition() {
    const next: Competition = {
      id: Date.now(),
      name: `Nueva competencia ${competitions.length + 1}`,
      date: "2026-12-01",
      type: "CRED",
      modality: "Boulder",
      category: "Juveniles",
      region: "Buenos Aires",
      club: "Club organizador",
      president: "Sin asignar",
    };
    setCompetitions([next, ...competitions]);
    setActiveCompetition(next);
  }

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">Competencias FASA</p>
          <h1>Competencias de Escalada Deportiva</h1>
        </div>
        <img src="/assets/fasa-logo-manual.png" alt="FASA" />
      </section>

      <section className="access">
        <div>
          <p className="eyebrow">Acceso</p>
          <div className="buttonRow">
            <button onClick={() => setRole("publico")}>Resultados</button>
            <button onClick={() => setView("login")}>Administrador</button>
            <button onClick={() => { setRole("referente"); setView("competencias"); }}>Referente Regional</button>
            <button onClick={() => { setRole("juez"); setView("juez"); }}>Juez</button>
            <button onClick={() => { setRole("competidor"); setView("competidores"); }}>Competidor</button>
          </div>
        </div>
        {role !== "publico" && <strong>{role === "admin" ? "Modo test admin" : `Rol: ${role}`}</strong>}
      </section>

      {view === "login" && (
        <section className="panel compact">
          <h2>Ingreso administrador</h2>
          <div className="grid2">
            <label>Usuario<input value={login.user} onChange={(event) => setLogin({ ...login, user: event.target.value })} /></label>
            <label>Contrasena<input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} /></label>
          </div>
          <button className="primary" onClick={enterDemo}>Entrar</button>
          <p className="hint">Modo test: admin / admin habilita todas las funciones.</p>
        </section>
      )}

      <nav className="tabs">
        {["calendario", "competencias", "computos", "resultados", "competidores", "jueces", "juez"].map((item) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
        ))}
      </nav>

      {view === "calendario" && (
        <section className="panel">
          <div className="sectionHead"><h2>Calendario de competencias</h2></div>
          <div className="filters">
            <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">Tipo</option><option>CRED</option><option>CAED</option></select>
            <select value={filters.modality} onChange={(event) => setFilters({ ...filters, modality: event.target.value })}><option value="">Disciplina</option><option>Boulder</option><option>Dificultad</option><option>Velocidad</option></select>
            <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="">Categoria</option><option>Juveniles</option><option>Mayores</option></select>
            <select value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })}><option value="">Region</option>{regions.map((region) => <option key={region}>{region}</option>)}</select>
          </div>
          <div className="calendarGrid">
            {visibleCompetitions.map((competition) => (
              <article key={competition.id} onClick={() => { setActiveCompetition(competition); setView("resultados"); }}>
                <strong>{competition.date}</strong>
                <h3>{competition.name}</h3>
                <p>{competition.type} / {competition.modality} / {competition.category}</p>
                <span>{competition.region}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "competencias" && (
        <section className="panel">
          <div className="sectionHead"><h2>Competencias creadas</h2><button className="primary" onClick={addCompetition}>Crear competencia demo</button></div>
          <table><thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Disciplina</th><th>Region</th><th>PJ</th><th></th></tr></thead>
            <tbody>{competitions.map((competition) => (
              <tr key={competition.id}><td>{competition.date}</td><td>{competition.name}</td><td>{competition.type}</td><td>{competition.modality}</td><td>{competition.region}</td><td>{competition.president}</td><td><button onClick={() => { setActiveCompetition(competition); setView("computos"); }}>Abrir</button></td></tr>
            ))}</tbody></table>
        </section>
      )}

      {view === "computos" && (
        <section className="panel">
          <div className="sectionHead"><h2>Computos: {activeCompetition.name}</h2><span>{rounds[round].label}</span></div>
          <div className="timerBox">
            <select value={round} onChange={(event) => { setRound(event.target.value as RoundKey); stopTimer(); }}>
              {Object.entries(rounds).map(([key, data]) => <option key={key} value={key}>{data.label}</option>)}
            </select>
            <strong>{formatTime(timer.remaining)}</strong>
            <span>{timer.phase === "prep" ? "Preparacion" : "Escalada"} / intervalo {timer.cycle}</span>
            <div className="buttonRow"><button className="primary" onClick={startPauseTimer}>{timer.running ? "Pause" : "Play"}</button><button onClick={stopTimer}>Stop</button></div>
          </div>
        </section>
      )}

      {(view === "resultados" || role === "publico") && (
        <section className="panel">
          <div className="sectionHead"><h2>Resultados en vivo</h2><strong>{activeCompetition.name}</strong></div>
          <div className="filters">
            <select value={filters.gender} onChange={(event) => setFilters({ ...filters, gender: event.target.value })}><option value="">Genero</option><option>Hombre</option><option>Mujer</option></select>
            <select value={filters.compCategory} onChange={(event) => setFilters({ ...filters, compCategory: event.target.value })}><option value="">Categoria</option><option>U17</option><option>U19</option><option>Mayor</option></select>
          </div>
          <table><thead><tr><th>#</th><th>Competidor</th><th>Genero</th><th>Categoria</th><th>Club</th><th>Total</th></tr></thead>
            <tbody>{visibleCompetitors.sort((a, b) => b.score - a.score).map((competitor, index) => (
              <tr key={competitor.dni}><td>{index + 1}</td><td>{competitor.lastName}, {competitor.firstName}</td><td>{competitor.gender}</td><td>{competitor.category}</td><td>{competitor.club}</td><td><strong>{competitor.score.toFixed(1)}</strong></td></tr>
            ))}</tbody></table>
        </section>
      )}

      {view === "competidores" && (
        <section className="panel">
          <div className="sectionHead"><h2>Competidores</h2></div>
          <table><thead><tr><th>DNI</th><th>Nro</th><th>Nombre</th><th>Region</th><th>Pago</th><th>Acreditado</th></tr></thead>
            <tbody>{competitors.map((competitor) => (
              <tr key={competitor.dni}><td>{competitor.dni}</td><td>{competitor.bib}</td><td>{competitor.lastName}, {competitor.firstName}</td><td>{competitor.region}</td><td>{competitor.paid ? "Si" : "No"}</td><td>{competitor.accredited ? "Si" : "No"}</td></tr>
            ))}</tbody></table>
        </section>
      )}

      {view === "jueces" && (
        <section className="panel">
          <div className="sectionHead"><h2>Base de jueces</h2></div>
          <table><thead><tr><th>DNI</th><th>Nombre</th><th>Mail</th><th>Club</th><th>Nivel</th><th>Region</th></tr></thead>
            <tbody>{initialJudges.map((judge) => <tr key={judge.dni}><td>{judge.dni}</td><td>{judge.name}</td><td>{judge.mail}</td><td>{judge.club}</td><td>{judge.level}</td><td>{judge.region}</td></tr>)}</tbody></table>
        </section>
      )}

      {view === "juez" && (
        <section className="panel">
          <div className="sectionHead"><h2>Mesa de juez</h2><span>{rounds[round].label}</span></div>
          <div className="scoring">
            <strong>{formatTime(timer.remaining)}</strong>
            <button>+ Intento</button>
            <button>Zona</button>
            <button>Top</button>
            <button className="primary">Guardar puntaje demo</button>
          </div>
        </section>
      )}
    </main>
  );
}
