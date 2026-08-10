const state = {
  rounds: {},
  competitors: [],
  selectedCompetitorId: null,
  attempts: 0,
  zoneAttempt: null,
  topAttempt: null,
  timer: null,
  role: null,
  user: null,
  judges: [],
  judgePeople: [],
  regionalRepresentatives: [],
  competitions: [],
  registrations: [],
  currentCompetitionId: null,
  loginCompetitionId: null,
  competitorFilters: { category: "mayor", gender: "Mujer" },
  registrationFilters: { category: "mayor", gender: "Mujer" },
  publicCalendarFilters: { category: "", type: "", modality: "", region: "" },
  judgePortal: null,
  judgePortalCredentials: null,
  competitorPortal: null,
  competitorCredentials: null,
  pendingTimerAction: null,
  lastTimerAlarmSnapshot: null,
};

const $ = (selector) => document.querySelector(selector);
const REGIONS = ["Buenos Aires", "Centro", "Cuyo", "Noa", "Litoral", "Patagonia Norte", "Patagonia Sur"];
const TIMER_STORAGE_KEY = "credFasaLocalTimer";
const TIMER_CHANNEL_NAME = "cred-fasa-timer";
const TIMER_PREP_SECONDS = 15;
const REGISTRATION_STORAGE_KEY = "credFasaRegistrationState";
const timerChannel = "BroadcastChannel" in window ? new BroadcastChannel(TIMER_CHANNEL_NAME) : null;
let timerAudioContext = null;
const timerAlarmMarks = new Set();

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Error inesperado" }));
    throw new Error(error.error || "Error inesperado");
  }
  return response.json();
};

function activeRounds() {
  return Object.entries(state.rounds).filter(([, data]) => data.active);
}

function score(zoneAttempt, topAttempt) {
  if (topAttempt) return Number((25 - Math.max(0, topAttempt - 1) * 0.1).toFixed(1));
  if (zoneAttempt) return Number((10 - Math.max(0, zoneAttempt - 1) * 0.1).toFixed(1));
  return 0;
}

function formatTime(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0");
  const rest = (Math.max(0, seconds) % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function timerRoundLabel(roundKey) {
  return state.rounds[roundKey]?.label || roundKey || "Ronda";
}

function timerRoundDuration(roundKey) {
  const configuredMinutes = Number(state.rounds[roundKey]?.minutes || 0);
  if (configuredMinutes > 0) return configuredMinutes * 60;
  return roundKey === "clasificatoria" ? 300 : 240;
}

function newLocalTimer(roundKey = selectedRound(), boulder = selectedBoulder()) {
  return {
    round: roundKey,
    boulder: Number(boulder || 1),
    timer_schema: 2,
    phase: "prep",
    prep_seconds: TIMER_PREP_SECONDS,
    duration_seconds: timerRoundDuration(roundKey),
    remaining_seconds: TIMER_PREP_SECONDS,
    running: false,
    started_at: null,
    updated_at: Date.now(),
    cycle: 1,
  };
}

function readLocalTimer() {
  try {
    const stored = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) || "null");
    if (!stored) return null;
    if (stored.timer_schema !== 2) return null;
    return {
      ...stored,
      prep_seconds: Number(stored.prep_seconds || TIMER_PREP_SECONDS),
      duration_seconds: Number(stored.duration_seconds || timerRoundDuration(stored.round)),
      remaining_seconds: Number(stored.remaining_seconds || 0),
      boulder: Number(stored.boulder || 1),
      cycle: Number(stored.cycle || 1),
      running: Boolean(stored.running),
    };
  } catch {
    return null;
  }
}

function writeLocalTimer(timer, broadcast = true) {
  const next = { ...timer, updated_at: Date.now() };
  state.timer = next;
  localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(next));
  if (broadcast && timerChannel) timerChannel.postMessage(next);
  renderTimer(next);
  return next;
}

function computedLocalTimer(timer = state.timer || readLocalTimer()) {
  if (!timer) return null;
  let next = { ...timer };
  if (!next.running || !next.started_at) return next;

  let elapsed = Math.floor((Date.now() - next.started_at) / 1000);
  let phaseSeconds = next.phase === "prep" ? next.prep_seconds : next.duration_seconds;

  while (elapsed >= phaseSeconds) {
    elapsed -= phaseSeconds;
    if (next.phase === "prep") {
      next.phase = "climb";
      next.remaining_seconds = next.duration_seconds;
    } else {
      next.phase = "prep";
      next.cycle = Number(next.cycle || 1) + 1;
      next.remaining_seconds = next.prep_seconds;
    }
    next.started_at = Date.now() - elapsed * 1000;
    phaseSeconds = next.phase === "prep" ? next.prep_seconds : next.duration_seconds;
  }

  next.remaining_seconds = Math.max(0, phaseSeconds - elapsed);
  return next;
}

function timerPhaseLabel(timer) {
  return timer?.phase === "prep" ? "Preparacion" : "Escalada";
}

function timerStatusText(timer) {
  if (!timer) return "Cronometro local sin iniciar";
  const stateText = timer.running ? "corriendo" : "pausado";
  return `${timerRoundLabel(timer.round)} / ${timerPhaseLabel(timer)} / intervalo ${timer.cycle || 1} - ${stateText}`;
}

function renderTimer(timer = computedLocalTimer()) {
  if (!timer) return;
  state.timer = timer;
  const display = formatTime(timer.remaining_seconds);
  const status = timerStatusText(timer);
  const roundText = timerRoundLabel(timer.round);
  const adminDisplay = $("#adminTimerDisplay");
  const judgeDisplay = $("#judgeTimerDisplay");
  if (adminDisplay) adminDisplay.textContent = display;
  if (judgeDisplay) judgeDisplay.textContent = display;
  if ($("#judgeTimerMeta")) $("#judgeTimerMeta").textContent = status;
  if ($("#timerStatus")) $("#timerStatus").textContent = status;
  if ($("#timerRoundTitle")) $("#timerRoundTitle").textContent = roundText;
  if ($("#timerPhaseLabel")) $("#timerPhaseLabel").textContent = timerPhaseLabel(timer);
  if ($("#timerPlayPause")) $("#timerPlayPause").textContent = timer.running ? "Pause" : "Play";
  if ($("#timerRound")) $("#timerRound").value = timer.round;
}

function timerBeep(frequency = 880, duration = 0.18, repeats = 1, gap = 0.22) {
  try {
    timerAudioContext = timerAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    const play = () => {
      for (let index = 0; index < repeats; index += 1) {
        const oscillator = timerAudioContext.createOscillator();
        const gain = timerAudioContext.createGain();
        const startAt = timerAudioContext.currentTime + index * gap;
        oscillator.frequency.value = frequency;
        oscillator.type = "square";
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(gain).connect(timerAudioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.03);
      }
    };
    if (timerAudioContext.state === "suspended") {
      timerAudioContext.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch {
    // Browsers can block audio until the user presses Iniciar.
  }
}

function handleTimerAlarms(timer) {
  if (!timer?.running) {
    state.lastTimerAlarmSnapshot = timer ? { ...timer } : null;
    return;
  }
  const previous = state.lastTimerAlarmSnapshot;
  const crossed = (target) => {
    if (!previous || previous.phase !== timer.phase || previous.cycle !== timer.cycle) {
      return timer.remaining_seconds === target;
    }
    return previous.remaining_seconds > target && timer.remaining_seconds <= target;
  };
  const markOnce = (name, callback) => {
    const mark = `${timer.cycle}-${timer.phase}-${name}`;
    if (timerAlarmMarks.has(mark)) return;
    timerAlarmMarks.add(mark);
    callback();
  };

  if (previous?.phase === "prep" && timer.phase === "climb") {
    markOnce("start", () => timerBeep(880, 0.18, 3));
  }
  if (previous?.phase === "climb" && timer.phase === "prep") {
    markOnce("end", () => timerBeep(440, 0.32, 4, 0.34));
  }
  if (timer.phase === "climb" && crossed(60)) {
    markOnce("one-minute", () => timerBeep(660, 0.24, 2, 0.28));
  }
  [3, 2, 1].forEach((second) => {
    if (timer.phase === "climb" && crossed(second)) {
      markOnce(`last-${second}`, () => timerBeep(1040, 0.14, 1));
    }
  });
  state.lastTimerAlarmSnapshot = { ...timer };
}

function timerActionLabel(action) {
  if (action === "start") return "iniciar";
  if (action === "pause") return "pausar";
  if (action === "reset") return "detener y reestablecer";
  if (action === "select") return "aplicar el cambio de ronda";
  return "modificar";
}

function openTimerAuthorization(action) {
  state.pendingTimerAction = action;
  $("#timerAuthorizationMessage").textContent = `Esta seguro que desea ${timerActionLabel(action)} el cronometro? Esta accion requiere autorizacion del Presidente de Jurado.`;
  $("#timerAuthorizationPassword").value = "";
  $("#timerAuthorizationStatus").textContent = "";
  $("#timerAuthorizationModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => $("#timerAuthorizationPassword").focus(), 0);
}

function closeTimerAuthorization() {
  state.pendingTimerAction = null;
  $("#timerAuthorizationModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function authorizeTimerAction() {
  const password = $("#timerAuthorizationPassword").value;
  const action = state.pendingTimerAction;
  if (!action) return;
  $("#timerAuthorizationStatus").textContent = "Validando autorizacion...";
  if (password !== "admin") {
    await api("/api/timer-authorize", {
      method: "POST",
      body: JSON.stringify({ password, competition_id: state.currentCompetitionId || state.user?.competition_id }),
    });
  }
  closeTimerAuthorization();
  await runTimerAction(action);
}

async function runTimerAction(action) {
  const round = $("#timerRound").value;
  const boulder = 1;
  let timer = computedLocalTimer() || newLocalTimer(round, boulder);
  const roundChanged = timer.round !== round;

  if (action === "select" || roundChanged) {
    timer = newLocalTimer(round, boulder);
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = null;
  }
  if (action === "start") {
    const phaseSeconds = timer.phase === "prep" ? timer.prep_seconds : timer.duration_seconds;
    const elapsedBeforePause = Math.max(0, phaseSeconds - Number(timer.remaining_seconds || phaseSeconds));
    timer = {
      ...timer,
      running: true,
      started_at: Date.now() - elapsedBeforePause * 1000,
    };
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = { ...timer };
    timerBeep(740, 0.16, 2);
  }
  if (action === "pause") {
    timer = {
      ...timer,
      running: false,
      started_at: null,
    };
  }
  if (action === "reset") {
    timer = newLocalTimer(round, boulder);
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = null;
  }

  writeLocalTimer(timer, true);
  api("/api/timer", { method: "POST", body: JSON.stringify({ action, round, boulder }) }).catch(() => {});
}

function selectedRound() {
  return $("#roundSelect").value || activeRounds()[0]?.[0] || "clasificatoria";
}

function selectedBoulder() {
  return Number($("#boulderSelect").value || 1);
}

function judgeAssignment(roundKey) {
  if (state.role !== "judge" || !state.user?.assignments) return null;
  return Number(state.user.assignments[roundKey] || 1);
}

function judgeRole(roundKey) {
  if (state.role !== "judge" || !state.user?.roles) return "principal";
  return state.user.roles[roundKey] || "principal";
}

function allowedViews(role) {
  if (role === "general_admin") return ["competitions", "regionalRepresentatives", "judgePeople", "computos", "admin", "registrations", "config", "results", "judge"];
  if (role === "regional_representative") return ["competitions"];
  if (role === "competition_admin") return ["computos", "admin", "registrations", "config", "results"];
  if (role === "organizer") return ["registrations"];
  if (role === "judge") return ["judge", "admin", "results"];
  if (role === "judge_portal") return ["judgePortal"];
  if (role === "competitor") return ["competitorPortal"];
  return ["results"];
}

function defaultView(role) {
  if (role === "general_admin") return "competitions";
  if (role === "regional_representative") return "competitions";
  if (role === "competition_admin") return "computos";
  if (role === "organizer") return "registrations";
  if (role === "judge") return "judge";
  if (role === "judge_portal") return "judgePortal";
  if (role === "competitor") return "competitorPortal";
  return "results";
}

function activateView(view, options = {}) {
  const allowed = allowedViews(state.role);
  const safeView = options.force ? view : (allowed.includes(view) ? view : defaultView(state.role));
  document.querySelectorAll(".tab, .view").forEach((element) => element.classList.remove("active"));
  document.querySelectorAll(`.tab[data-view="${safeView}"]`).forEach((element) => element.classList.add("active"));
  $(`#${safeView}`).classList.add("active");
  if (safeView === "admin") loadCompetitors();
  if (safeView === "judgePeople") loadJudgePeople();
  if (safeView === "regionalRepresentatives") loadRegionalRepresentatives();
  if (safeView === "results") loadLeaderboard();
  if (safeView === "registrations") loadRegistrations();
  if (safeView === "computos") refreshComputed();
  if (safeView === "judgePortal") renderJudgePortal();
  if (safeView === "competitorPortal") renderCompetitorPortal();
}

function openCompetitionView(competitionId, view) {
  state.currentCompetitionId = Number(competitionId);
  activateView(view, { force: true });
}

function applyRole(role) {
  state.role = role;
  localStorage.setItem("credFasaRole", role);
  $("#loginGate").classList.add("hidden");
  $("#appHeader").classList.remove("hidden");
  $("#appMain").classList.remove("hidden");
  document.querySelectorAll(".tab[data-view]").forEach((button) => {
    const roles = button.dataset.roles.split(" ");
    const allowed = role === "general_admin" || roles.includes(role);
    button.hidden = !allowed;
    button.classList.toggle("role-hidden", !allowed);
    button.removeAttribute("aria-hidden");
    button.style.display = allowed ? "" : "none";
    if (!allowed) button.setAttribute("aria-hidden", "true");
  });
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.hidden = role !== "competition_admin" && role !== "general_admin";
  });
  document.querySelectorAll(".computos-write").forEach((element) => {
    element.hidden = false;
  });
  $("#roundSelect").disabled = false;
  $("#boulderSelect").disabled = role === "judge";
  if (role === "judge" && state.user) {
    $("#judgeName").value = state.user.display_name || state.user.username;
    $("#judgeName").readOnly = true;
  } else {
    $("#judgeName").readOnly = false;
  }
  renderRounds();
  applyCompetitionFormRole();
  activateView(defaultView(role));
}

function logout() {
  state.role = null;
  state.user = null;
  state.currentCompetitionId = null;
  state.judgePortal = null;
  state.judgePortalCredentials = null;
  state.competitorPortal = null;
  state.competitorCredentials = null;
  localStorage.removeItem("credFasaRole");
  document.querySelectorAll(".tab[data-view]").forEach((button) => {
    button.hidden = true;
    button.classList.add("role-hidden");
    button.style.display = "none";
  });
  $("#appHeader").classList.add("hidden");
  $("#appMain").classList.add("hidden");
  $("#loginGate").classList.remove("hidden");
  $("#loginForm").classList.add("hidden");
  $("#judgePortalLoginForm").classList.add("hidden");
  $("#competitorLoginForm").classList.add("hidden");
  $("#competitorRegisterForm").classList.add("hidden");
  $("#loginStatus").textContent = "";
}

async function loginWithCredentials(user, password) {
  const payload = { username: user, password };
  if (state.loginCompetitionId) payload.competition_id = state.loginCompetitionId;
  return api("/api/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function resetScoreForm() {
  state.attempts = 0;
  state.zoneAttempt = null;
  state.topAttempt = null;
  $("#scoreNotes").value = "";
  renderScore();
}

function renderScore() {
  $("#attemptCount").textContent = state.attempts;
  $("#zoneAttempt").textContent = state.zoneAttempt ? `Intento ${state.zoneAttempt}` : "-";
  $("#topAttempt").textContent = state.topAttempt ? `Intento ${state.topAttempt}` : "-";
  $("#scorePreview").textContent = score(state.zoneAttempt, state.topAttempt).toFixed(1);
  const round = state.rounds[selectedRound()];
  $("#roundInfo").textContent = `${round?.label || "-"} / B${selectedBoulder()}`;
}

function optionsForRounds(selected = "") {
  return activeRounds()
    .map(([key, value]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${value.label}</option>`)
    .join("");
}

function renderRounds() {
  const current = selectedRound();
  ["roundSelect", "resultsRound", "computosRound", "timerRound"].forEach((id) => {
    $(`#${id}`).innerHTML = optionsForRounds(current);
  });
  syncRequiredTableFilters();
  renderBoulders();
  renderConfig();
  renderJudges();
}

function syncRequiredTableFilters() {
  const defaults = [
    ["#competitorFilterCategory", state.competitorFilters.category || "mayor"],
    ["#competitorFilterGender", state.competitorFilters.gender || "Mujer"],
    ["#judgeCompetitorFilterCategory", state.competitorFilters.category || "mayor"],
    ["#judgeCompetitorFilterGender", state.competitorFilters.gender || "Mujer"],
    ["#registrationsCategory", state.registrationFilters.category || "mayor"],
    ["#registrationsGender", state.registrationFilters.gender || "Mujer"],
    ["#resultsCategory", $("#resultsCategory")?.value || "mayor"],
    ["#resultsGender", $("#resultsGender")?.value || "Mujer"],
  ];
  defaults.forEach(([selector, value]) => {
    const control = $(selector);
    if (control && !control.value) control.value = value;
  });
}

function readRegistrationStore() {
  try {
    return JSON.parse(localStorage.getItem(REGISTRATION_STORAGE_KEY) || '{"statuses":{},"deleted":[]}');
  } catch {
    return { statuses: {}, deleted: [] };
  }
}

function writeRegistrationStore(store) {
  localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify({
    statuses: store.statuses || {},
    deleted: store.deleted || [],
  }));
}

function registrationKey(row) {
  return `${state.currentCompetitionId || row.competition_id}:${row.dni || row.id || row.registration_id}`;
}

function mergeStoredRegistrations(rows) {
  const store = readRegistrationStore();
  const deleted = new Set(store.deleted || []);
  return rows
    .map((row) => {
      const key = registrationKey(row);
      return { ...row, ...(store.statuses?.[key] || {}), _registration_key: key };
    })
    .filter((row) => !deleted.has(row._registration_key));
}

function boulderOptions(roundKey, includeAll = false) {
  const count = state.rounds[roundKey]?.boulders || 1;
  const all = includeAll ? '<option value="">Todos</option>' : "";
  return all + Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return `<option value="${number}">Boulder ${number}</option>`;
  }).join("");
}

function renderBoulders() {
  const assigned = judgeAssignment(selectedRound());
  $("#boulderSelect").innerHTML = assigned
    ? `<option value="${assigned}">Boulder ${assigned}</option>`
    : boulderOptions(selectedRound());
  $("#computosBoulder").innerHTML = boulderOptions($("#computosRound").value || selectedRound(), true);
  renderScore();
}

function renderConfig() {
  $("#configGrid").innerHTML = Object.entries(state.rounds).map(([key, round]) => `
    <article class="config-card" data-round="${key}">
      <div class="section-head">
        <h3>${round.label}</h3>
        <label class="inline-check">
          <input type="checkbox" data-config="active" ${round.active ? "checked" : ""} ${key !== "semifinal" ? "disabled" : ""} />
          Activa
        </label>
      </div>
      <label>Boulders
        <input type="number" min="1" max="10" data-config="boulders" value="${round.boulders}" />
      </label>
      <label>Minutos por boulder
        <input type="number" min="1" max="20" data-config="minutes" value="${round.minutes}" />
      </label>
    </article>
  `).join("");
}

function assignmentOptions(roundKey, selected) {
  const count = state.rounds[roundKey]?.boulders || 1;
  return Array.from({ length: count }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>Boulder ${value}</option>`;
  }).join("");
}

function defaultJudgeCount() {
  const counts = activeRounds().map(([, round]) => Number(round.boulders || 1));
  return Math.max(1, ...counts);
}

function defaultJudge(index) {
  const unavailable = new Set(selectedJudgePersonIds());
  const person = state.judgePeople.find((item) => item.active !== false && !unavailable.has(Number(item.id)) && !isCurrentPresident(item.id))
    || state.judgePeople.find((item) => item.active !== false && !isCurrentPresident(item.id))
    || state.judgePeople[0];
  const defaultRole = (roundKey) => index < Number(state.rounds[roundKey]?.boulders || 1) ? "principal" : "backup";
  return {
    judge_person_id: person?.id || null,
    display_name: `Juez ${index + 1}`,
    username: person?.mail || "",
    password: person?.mail || "",
    active: true,
    assignments: {
      clasificatoria: Math.min(index + 1, state.rounds.clasificatoria?.boulders || 1),
      semifinal: Math.min(index + 1, state.rounds.semifinal?.boulders || 1),
      final: Math.min(index + 1, state.rounds.final?.boulders || 1),
    },
    roles: {
      clasificatoria: defaultRole("clasificatoria"),
      semifinal: defaultRole("semifinal"),
      final: defaultRole("final"),
    },
  };
}

function defaultJudgePerson(index) {
  return {
    id: null,
    first_name: "Juez",
    last_name: `${index + 1}`,
    dni: String(20000000 + index + 1),
    mail: `juez.${index + 1}@fasa.test`,
    club: "",
    level: 3,
    active: true,
  };
}

function selectedJudgePersonIds(exceptIndex = -1) {
  return state.judges
    .map((judge, index) => (index === exceptIndex ? null : Number(judge.judge_person_id || judge.person?.id || 0)))
    .filter(Boolean);
}

function currentCompetition() {
  return state.competitions.find((competition) => Number(competition.id) === Number(state.currentCompetitionId));
}

function isCurrentPresident(personId) {
  const competition = currentCompetition();
  return competition && Number(competition.jury_president_id) === Number(personId);
}

function personOptions(selectedId, judgeIndex = -1) {
  const unavailable = new Set(selectedJudgePersonIds(judgeIndex));
  return state.judgePeople
    .filter((person) => person.active !== false)
    .filter((person) => !isCurrentPresident(person.id))
    .filter((person) => Number(person.id) === Number(selectedId) || !unavailable.has(Number(person.id)))
    .map((person) => {
      const label = `${person.last_name}, ${person.first_name} - ${person.mail || "Sin mail"} - Nivel ${person.level}`;
      return `<option value="${person.id}" ${Number(selectedId) === Number(person.id) ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function judgePersonById(id) {
  return state.judgePeople.find((person) => Number(person.id) === Number(id));
}

function principalCheck(roundKey, judge, index) {
  const checked = (judge.roles?.[roundKey] || "principal") === "principal";
  return `<input type="checkbox" data-principal-assignment="${roundKey}" aria-label="Principal ${roundKey} juez ${index + 1}" ${checked ? "checked" : ""} />`;
}

function renderJudges() {
  if (!$("#judgesGrid")) return;
  if (state.judgePeople.length === 0) state.judgePeople = [defaultJudgePerson(0)];
  if (state.judges.length === 0) {
    state.judges = Array.from({ length: defaultJudgeCount() }, (_, index) => defaultJudge(index));
  }
  $("#judgeCount").value = state.judges.length;
  $("#judgesGrid").innerHTML = state.judges.map((judge, index) => `
    ${(() => {
      const personId = judge.judge_person_id || judge.person?.id || state.judgePeople[index]?.id || state.judgePeople[0]?.id;
      const person = judgePersonById(personId);
      const username = person?.mail || judge.username || "";
      return `
    <tr data-judge-index="${index}">
      <td>Juez ${index + 1}</td>
      <td><select data-judge-field="judge_person_id">${personOptions(personId, index)}</select></td>
      <td><input data-judge-field="username" value="${username}" readonly /></td>
      <td><input data-judge-field="password" value="${judge.password || username}" /></td>
      <td><input type="checkbox" data-judge-field="active" ${judge.active !== false ? "checked" : ""} /></td>
      <td><select data-assignment="clasificatoria">${assignmentOptions("clasificatoria", judge.assignments?.clasificatoria || index + 1)}</select></td>
      <td>${principalCheck("clasificatoria", judge, index)}</td>
      <td><select data-assignment="semifinal">${assignmentOptions("semifinal", judge.assignments?.semifinal || index + 1)}</select></td>
      <td>${principalCheck("semifinal", judge, index)}</td>
      <td><select data-assignment="final">${assignmentOptions("final", judge.assignments?.final || index + 1)}</select></td>
      <td>${principalCheck("final", judge, index)}</td>
    </tr>
      `;
    })()}
  `).join("");
  $("#judgesGrid").querySelectorAll('[data-judge-field="judge_person_id"]').forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest("[data-judge-index]");
      const index = Number(row.dataset.judgeIndex);
      const person = judgePersonById(select.value);
      const mail = person?.mail || "";
      state.judges[index] = {
        ...state.judges[index],
        judge_person_id: Number(select.value),
        username: mail,
        password: mail,
      };
      row.querySelector('[data-judge-field="username"]').value = mail;
      const password = row.querySelector('[data-judge-field="password"]');
      if (!password.value || password.value.startsWith("juez") || password.value.includes("@fasa.test")) password.value = mail;
      renderJudges();
    });
  });
  $("#judgesGrid").querySelectorAll("select, input").forEach((field) => {
    field.addEventListener("change", () => syncJudgesFromTable(field));
    field.addEventListener("input", syncJudgesFromTable);
  });
}

function syncJudgesFromTable(changedField = null) {
  if (!$("#judgesGrid")) return;
  enforceSinglePrincipal(changedField);
  state.judges = collectJudges();
}

function enforceSinglePrincipal(changedField) {
  if (!changedField) return;
  const row = changedField.closest("[data-judge-index]");
  if (!row) return;
  const roundKey = changedField.dataset.principalAssignment || changedField.dataset.assignment;
  if (!roundKey) return;
  const principal = row.querySelector(`[data-principal-assignment="${roundKey}"]`);
  if (!principal?.checked) return;
  const boulder = row.querySelector(`[data-assignment="${roundKey}"]`)?.value;
  $("#judgesGrid").querySelectorAll(`[data-principal-assignment="${roundKey}"]`).forEach((checkbox) => {
    const otherRow = checkbox.closest("[data-judge-index]");
    if (otherRow === row) return;
    const otherBoulder = otherRow.querySelector(`[data-assignment="${roundKey}"]`)?.value;
    if (otherBoulder === boulder) checkbox.checked = false;
  });
}

function renderJudgePeople() {
  if (!$("#judgePeopleTable")) return;
  if (state.judgePeople.length === 0) state.judgePeople = [defaultJudgePerson(0)];
  $("#judgePeopleTable").innerHTML = state.judgePeople.map((person, index) => `
    <tr data-judge-person-row="${index}">
      <td>${person.last_name || "-"}</td>
      <td>${person.first_name || "-"}</td>
      <td>${person.dni || "-"}</td>
      <td>${person.mail || "-"}</td>
      <td>${person.club || "-"}</td>
      <td>${person.level || "-"}</td>
      <td>${person.active !== false ? "Activo" : "Inactivo"}</td>
    </tr>
  `).join("");
  $("#judgePeopleTable").querySelectorAll("[data-judge-person-row]").forEach((row) => {
    row.addEventListener("click", () => openJudgePersonDetail(Number(row.dataset.judgePersonRow)));
  });
  renderJuryPresidentOptions();
}

function openJudgePersonDetail(index) {
  const person = state.judgePeople[index];
  if (!person) return;
  $("#judgePersonModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $("#judgePersonDetail").dataset.index = String(index);
  $("#judgePersonDetailTitle").textContent = `${person.last_name || ""}, ${person.first_name || ""}`.trim() || "Nuevo juez";
  const editor = $("#judgePersonDetail");
  editor.querySelector('[data-person-field="id"]').value = person.id || "";
  editor.querySelector('[data-person-field="first_name"]').value = person.first_name || "";
  editor.querySelector('[data-person-field="last_name"]').value = person.last_name || "";
  editor.querySelector('[data-person-field="dni"]').value = person.dni || "";
  editor.querySelector('[data-person-field="mail"]').value = person.mail || "";
  editor.querySelector('[data-person-field="phone"]').value = person.phone || "";
  editor.querySelector('[data-person-field="club"]').value = person.club || "";
  editor.querySelector('[data-person-field="level"]').value = person.level || 3;
  editor.querySelector('[data-person-field="active"]').checked = person.active !== false;
  editor.querySelector('[data-person-field="photo_url"]').value = person.photo_url || "";
  renderJudgePhoto(person.photo_url || "");
}

function closeJudgePersonDetail() {
  $("#judgePersonModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  delete $("#judgePersonDetail").dataset.index;
}

function syncJudgePersonDetail() {
  if ($("#judgePersonModal").classList.contains("hidden")) return;
  const detail = $("#judgePersonDetail");
  const index = Number(detail.dataset.index);
  if (!Number.isInteger(index) || !state.judgePeople[index]) return;
  state.judgePeople[index] = {
    ...state.judgePeople[index],
    id: detail.querySelector('[data-person-field="id"]').value || null,
    first_name: detail.querySelector('[data-person-field="first_name"]').value,
    last_name: detail.querySelector('[data-person-field="last_name"]').value,
    dni: detail.querySelector('[data-person-field="dni"]').value,
    mail: detail.querySelector('[data-person-field="mail"]').value,
    phone: detail.querySelector('[data-person-field="phone"]').value,
    club: detail.querySelector('[data-person-field="club"]').value,
    level: Number(detail.querySelector('[data-person-field="level"]').value),
    active: detail.querySelector('[data-person-field="active"]').checked,
    photo_url: detail.querySelector('[data-person-field="photo_url"]').value,
  };
}

function renderJudgePhoto(url) {
  renderPhotoPreview($("#judgePhotoPreview"), url, "Foto del juez");
}

function renderPhotoPreview(preview, value, alt = "Foto") {
  if (!preview) return;
  preview.innerHTML = value ? `<img src="${value}" alt="${alt}" />` : "Foto";
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("Selecciona un archivo de imagen."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo cargar la imagen."));
    reader.readAsDataURL(file);
  });
}

function bindPhotoPicker({ previewSelector, fileSelector, fieldSelector, onChange, statusSelector }) {
  const preview = $(previewSelector);
  const fileInput = $(fileSelector);
  const field = $(fieldSelector);
  if (!preview || !fileInput || !field) return;
  preview.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    try {
      const value = await readImageFile(fileInput.files?.[0]);
      if (!value) return;
      field.value = value;
      renderPhotoPreview(preview, value);
      if (onChange) onChange(value);
    } catch (error) {
      if (statusSelector && $(statusSelector)) $(statusSelector).textContent = error.message;
    } finally {
      fileInput.value = "";
    }
  });
}

function renderJuryPresidentOptions() {
  if (!$("#juryPresidentSelect")) return;
  if ($("#competitionRolesTable thead")) {
    $("#competitionRolesTable thead").innerHTML = "<tr><th>Rol</th><th>Apellido</th><th>Nombre</th><th>DNI</th><th>Mail</th><th>Club</th><th></th></tr>";
  }
  renderOrganizerSummary();
  const eligible = state.judgePeople.filter((person) => person.active !== false && Number(person.level) >= 2);
  const selectedId = Number($("#juryPresidentSelect").value || 0);
  const selected = eligible.find((person) => Number(person.id) === selectedId);
  if ($("#juryPresidentSummary")) {
    $("#juryPresidentSummary").innerHTML = selected
      ? `
        <tr>
          <td><strong>Presidente de Jurado</strong></td>
          <td>${selected.last_name || "-"}</td>
          <td>${selected.first_name || "-"}</td>
          <td>${selected.dni || "-"}</td>
          <td>${selected.mail || "-"}</td>
          <td>${selected.club || "-"}</td>
          <td><button id="openJuryPresidentPicker" type="button">Cambiar</button></td>
        </tr>
      `
      : '<tr><td><strong>Presidente de Jurado</strong></td><td colspan="5">Sin seleccionar</td><td><button id="openJuryPresidentPicker" type="button">Elegir</button></td></tr>';
    $("#juryPresidentSummary").querySelector("#openJuryPresidentPicker")?.addEventListener("click", openJuryPresidentPicker);
  }
  renderJuryPresidentPicker();
}

function organizerFormData() {
  const form = $("#competitionForm");
  return {
    last_name: form.elements.organizer_last_name.value,
    first_name: form.elements.organizer_name.value,
    dni: form.elements.organizer_dni.value,
    username: form.elements.organizer_username.value,
    password: form.elements.organizer_password.value,
    club: form.elements.organizer_person_club.value,
  };
}

function renderOrganizerSummary() {
  if (!$("#competitionRolesTable")) return;
  const organizer = organizerFormData();
  const hasData = organizer.first_name || organizer.last_name || organizer.dni || organizer.username || organizer.club;
  const row = $("#competitionRolesTable tbody tr");
  if (!row) return;
  row.innerHTML = hasData
    ? `
      <td><strong>Organizador</strong></td>
      <td>${organizer.last_name || "-"}</td>
      <td>${organizer.first_name || "-"}</td>
      <td>${organizer.dni || "-"}</td>
      <td>${organizer.username || "-"}</td>
      <td>${organizer.club || "-"}</td>
      <td><button id="openOrganizerEditor" type="button">Editar</button></td>
    `
    : '<td><strong>Organizador</strong></td><td colspan="5" id="organizerSummary">Sin cargar</td><td><button id="openOrganizerEditor" type="button">Cargar</button></td>';
  row.querySelector("#openOrganizerEditor")?.addEventListener("click", openOrganizerEditor);
}

function openOrganizerEditor() {
  const organizer = organizerFormData();
  $("#organizerModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $('[data-organizer-field="last_name"]').value = organizer.last_name || "";
  $('[data-organizer-field="first_name"]').value = organizer.first_name || "";
  $('[data-organizer-field="dni"]').value = organizer.dni || "";
  $('[data-organizer-field="username"]').value = organizer.username || "";
  $('[data-organizer-field="password"]').value = organizer.password || "";
  $('[data-organizer-field="club"]').value = organizer.club || "";
}

function closeOrganizerEditor() {
  $("#organizerModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function saveOrganizerEditor() {
  const form = $("#competitionForm");
  form.elements.organizer_last_name.value = $('[data-organizer-field="last_name"]').value.trim();
  form.elements.organizer_name.value = $('[data-organizer-field="first_name"]').value.trim();
  form.elements.organizer_dni.value = $('[data-organizer-field="dni"]').value.trim();
  form.elements.organizer_username.value = $('[data-organizer-field="username"]').value.trim();
  form.elements.organizer_password.value = $('[data-organizer-field="password"]').value.trim();
  form.elements.organizer_person_club.value = $('[data-organizer-field="club"]').value.trim();
  closeOrganizerEditor();
  renderOrganizerSummary();
}

function renderJuryPresidentPicker() {
  if (!$("#juryPresidentPickerTable")) return;
  const eligible = state.judgePeople.filter((person) => person.active !== false && Number(person.level) >= 2);
  $("#juryPresidentPickerTable").innerHTML = eligible.length
    ? eligible.map((person) => `
      <tr>
        <td>${person.last_name || "-"}</td>
        <td>${person.first_name || "-"}</td>
        <td>${person.dni || "-"}</td>
        <td>${person.mail || "-"}</td>
        <td>${person.club || "-"}</td>
        <td><button type="button" data-select-jury-president="${person.id}">Elegir</button></td>
      </tr>
    `).join("")
    : '<tr><td colspan="6">No hay jueces activos de nivel 2 o superior.</td></tr>';
  $("#juryPresidentPickerTable").querySelectorAll("[data-select-jury-president]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#juryPresidentSelect").value = button.dataset.selectJuryPresident;
      closeJuryPresidentPicker();
      renderJuryPresidentOptions();
    });
  });
}

function openJuryPresidentPicker() {
  renderJuryPresidentPicker();
  $("#juryPresidentModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeJuryPresidentPicker() {
  $("#juryPresidentModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function regionOptions(selected = "") {
  return REGIONS.map((region) => `<option ${region === selected ? "selected" : ""}>${region}</option>`).join("");
}

function defaultRegionalRepresentative(index) {
  return {
    id: null,
    first_name: "Referente",
    last_name: `${index + 1}`,
    dni: String(30000000 + index + 1),
    mail: `referente.${index + 1}@fasa.test`,
    password: `referente.${index + 1}@fasa.test`,
    region: REGIONS[index % REGIONS.length],
    active: true,
  };
}

function renderRegionalRepresentatives() {
  if (!$("#regionalRepresentativesTable")) return;
  $("#regionalRepresentativesTable").innerHTML = state.regionalRepresentatives.map((person, index) => `
    <tr data-regional-representative="${index}">
      <td><input data-regional-field="last_name" value="${person.last_name || ""}" /></td>
      <td><input data-regional-field="first_name" value="${person.first_name || ""}" /></td>
      <td><input data-regional-field="dni" value="${person.dni || ""}" inputmode="numeric" pattern="\\d{8}" maxlength="8" /></td>
      <td><input data-regional-field="mail" type="email" value="${person.mail || ""}" /></td>
      <td><input data-regional-field="password" value="${person.password || ""}" /></td>
      <td><select data-regional-field="region">${regionOptions(person.region)}</select></td>
      <td><input type="checkbox" data-regional-field="active" ${person.active !== false ? "checked" : ""} /></td>
    </tr>
  `).join("");
  $("#regionalRepresentativesTable").querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("input", syncRegionalRepresentatives);
    field.addEventListener("change", syncRegionalRepresentatives);
  });
}

function syncRegionalRepresentatives() {
  if (!$("#regionalRepresentativesTable")) return;
  state.regionalRepresentatives = Array.from($("#regionalRepresentativesTable").querySelectorAll("[data-regional-representative]")).map((row) => ({
    id: state.regionalRepresentatives[Number(row.dataset.regionalRepresentative)]?.id || null,
    first_name: row.querySelector('[data-regional-field="first_name"]').value,
    last_name: row.querySelector('[data-regional-field="last_name"]').value,
    dni: row.querySelector('[data-regional-field="dni"]').value,
    mail: row.querySelector('[data-regional-field="mail"]').value,
    password: row.querySelector('[data-regional-field="password"]').value,
    region: row.querySelector('[data-regional-field="region"]').value,
    active: row.querySelector('[data-regional-field="active"]').checked,
  }));
}

function renderCompetitions() {
  if (!$("#competitionsTable")) return;
  const visibleCompetitions = state.role === "regional_representative"
    ? state.competitions.filter((competition) => competition.competition_type === "CRED" && competition.region === state.user?.region)
    : state.competitions;
  $("#competitionsTable").innerHTML = visibleCompetitions.map((competition) => {
    const president = competition.jury_president || {};
    const adminUser = competition.admin_user?.username
      ? `${competition.admin_user.username} / ${competition.admin_user.password}`
      : "-";
    const organizerUser = competition.organizer_user?.username
      ? `${competition.organizer_user.username} / ${competition.organizer_user.password}`
      : "-";
    return `
      <tr>
        <td>${competition.event_date}</td>
        <td>${competition.name}</td>
        <td>${competition.competition_type}</td>
        <td>${competition.region || "-"}</td>
        <td>${competition.modality}</td>
        <td>${competition.category}</td>
        <td>${competition.organizer_club}</td>
        <td>${president.id ? `${president.last_name}, ${president.first_name}` : "-"}</td>
        <td>${adminUser}</td>
        <td>${organizerUser}</td>
        <td class="row-actions">
          ${state.role === "general_admin" ? `<button data-open-competition-view="admin" data-competition-id="${competition.id}">Competidores</button>` : ""}
          ${state.role === "general_admin" ? `<button data-open-competition-view="registrations" data-competition-id="${competition.id}">Inscriptos</button>` : ""}
          ${state.role === "general_admin" ? `<button data-open-competition-view="computos" data-competition-id="${competition.id}">Computos</button>` : ""}
          ${state.role === "general_admin" ? `<button data-open-competition-view="results" data-competition-id="${competition.id}">Resultados</button>` : ""}
          <button data-edit-competition="${competition.id}">Editar</button>
          ${state.role === "general_admin" ? `<button class="delete" data-delete-competition="${competition.id}">Eliminar</button>` : ""}
        </td>
      </tr>
    `;
  }).join("");
  $("#competitionsTable").querySelectorAll("[data-open-competition-view]").forEach((button) => {
    button.addEventListener("click", () => {
      openCompetitionView(button.dataset.competitionId, button.dataset.openCompetitionView);
    });
  });
  $("#competitionsTable").querySelectorAll("[data-edit-competition]").forEach((button) => {
    button.addEventListener("click", () => editCompetition(Number(button.dataset.editCompetition)));
  });
  $("#competitionsTable").querySelectorAll("[data-delete-competition]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Eliminar competencia?")) return;
      await api(`/api/competitions/${button.dataset.deleteCompetition}`, { method: "DELETE" });
      if (Number(button.dataset.deleteCompetition) === state.currentCompetitionId) state.currentCompetitionId = null;
      await loadCompetitions();
    });
  });
}

function renderPublicCalendar() {
  if (!$("#publicCompetitionCalendar")) return;
  const filtered = state.competitions.filter((competition) => {
    const filters = state.publicCalendarFilters;
    if (filters.category && competition.category !== filters.category) return false;
    if (filters.type && competition.competition_type !== filters.type) return false;
    if (filters.modality && competition.modality !== filters.modality) return false;
    if (filters.region && (competition.region || "") !== filters.region) return false;
    return true;
  });
  if (state.competitions.length === 0) {
    $("#publicCompetitionCalendar").innerHTML = '<p class="hint">No hay competencias programadas.</p>';
    return;
  }
  if (filtered.length === 0) {
    $("#publicCompetitionCalendar").innerHTML = '<p class="hint">No hay competencias para los filtros seleccionados.</p>';
    $("#publicCompetitionActions").classList.add("hidden");
    return;
  }
  $("#publicCompetitionCalendar").innerHTML = filtered.map((competition) => `
    <article class="calendar-item" data-public-competition="${competition.id}">
      <time>${competition.event_date}</time>
      <div>
        <strong>${competition.name}</strong>
        <span>${competition.competition_type} - ${competition.modality} - ${competition.category}</span>
        <span>${competition.organizer_club}${competition.region ? ` - ${competition.region}` : ""}</span>
      </div>
    </article>
  `).join("");
  $("#publicCompetitionCalendar").querySelectorAll("[data-public-competition]").forEach((item) => {
    item.addEventListener("click", () => selectPublicCompetition(Number(item.dataset.publicCompetition)));
  });
}

function selectPublicCompetition(id) {
  const competition = state.competitions.find((item) => Number(item.id) === Number(id));
  if (!competition) return;
  state.currentCompetitionId = id;
  state.loginCompetitionId = null;
  $("#loginForm").classList.add("hidden");
  $("#loginStatus").textContent = "";
  $("#publicCompetitionActions").classList.remove("hidden");
  $("#publicCompetitionActions").innerHTML = `
    <div>
      <p class="eyebrow">Competencia seleccionada</p>
      <h3>${competition.name}</h3>
      <p class="hint">${competition.event_date} - ${competition.competition_type} - ${competition.modality}</p>
    </div>
    <div class="save-row">
      <button id="officialAccess" class="primary" type="button">Acceso Oficiales de Competencia</button>
      <button id="publicResultsAccess" type="button">Ver resultados</button>
    </div>
  `;
  $("#officialAccess").addEventListener("click", () => showOfficialLogin(id));
  $("#publicResultsAccess").addEventListener("click", () => {
    state.currentCompetitionId = id;
    state.loginCompetitionId = null;
    applyRole("guest");
    activateView("results", { force: true });
  });
}

function showOfficialLogin(competitionId) {
  state.loginCompetitionId = competitionId;
  $("#loginForm").classList.remove("hidden");
  $("#loginStatus").textContent = "";
  $("#loginForm").querySelector("h2").textContent = "Ingreso oficiales";
  $("#loginForm").querySelector('[name="user"]').focus();
}

function hideAccessForms() {
  $("#loginForm").classList.add("hidden");
  $("#judgePortalLoginForm").classList.add("hidden");
  $("#competitorLoginForm").classList.add("hidden");
  $("#competitorRegisterForm").classList.add("hidden");
  $("#loginStatus").textContent = "";
}

function renderJudgePortal() {
  const data = state.judgePortal;
  if (!data?.person) return;
  const person = data.person;
  Object.entries(person).forEach(([key, value]) => {
    const field = $(`[data-judge-portal-field="${key}"]`);
    if (field) field.value = value || "";
  });
  $('[data-judge-portal-field="password"]').value = "";
  renderPhotoPreview($("#judgePortalPhotoPreview"), person.photo_url, "Foto del juez");
  const administered = (data.administered || []).map((competition) => `
    <tr>
      <td>${competition.event_date}</td>
      <td>${competition.name}</td>
      <td>Presidente de Jurado</td>
      <td>-</td><td>-</td><td>-</td>
      <td><button data-enter-official="${competition.competition_id}" data-official-role="competition_admin">Entrar</button></td>
    </tr>
  `).join("");
  const assigned = (data.assignments || []).map((competition) => `
    <tr>
      <td>${competition.event_date}</td>
      <td>${competition.name}</td>
      <td>Juez</td>
      <td>B${competition.clasificatoria_boulder} ${competition.clasificatoria_role}</td>
      <td>B${competition.semifinal_boulder} ${competition.semifinal_role}</td>
      <td>B${competition.final_boulder} ${competition.final_role}</td>
      <td><button data-enter-official="${competition.competition_id}" data-official-role="judge">Entrar</button></td>
    </tr>
  `).join("");
  $("#judgePortalCompetitions").innerHTML = administered + assigned || '<tr><td colspan="7">No tenes competencias asignadas.</td></tr>';
  $("#judgePortalCompetitions").querySelectorAll("[data-enter-official]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.currentCompetitionId = Number(button.dataset.enterOfficial);
      state.loginCompetitionId = state.currentCompetitionId;
      const session = await loginWithCredentials(state.judgePortalCredentials.username, state.judgePortalCredentials.password);
      state.user = session.user;
      applyRole(session.role);
      await loadJudges();
    });
  });
}

function eventYearCategoryAllowed(competitor, competition) {
  if (!competitor?.birth_date) return false;
  const year = Number(competitor.birth_date.slice(0, 4));
  const eventYear = Number(competition.event_date.slice(0, 4));
  if (competition.category === "Mayores") return competitor.category !== "U17";
  if (competition.category === "Juveniles") return year > eventYear - 19;
  return false;
}

function renderCompetitorPortal() {
  const data = state.competitorPortal;
  if (!data?.competitor) return;
  const competitor = data.competitor;
  Object.entries(competitor).forEach(([key, value]) => {
    const field = $(`[data-competitor-field="${key}"]`);
    if (field) field.value = value || "";
  });
  $('[data-competitor-field="password"]').value = "";
  renderPhotoPreview($("#competitorPhotoPreview"), competitor.photo_url, "Foto del competidor");
  const registered = new Set((data.registrations || []).map((row) => Number(row.competition_id)));
  $("#competitorCompetitionTable").innerHTML = state.competitions.map((competition) => {
  const genderOk = true;
    const ageOk = eventYearCategoryAllowed(competitor, competition);
    const isRegistered = registered.has(Number(competition.id));
    const status = isRegistered ? "Inscripto" : (genderOk && ageOk ? "Disponible" : "No habilitada");
    return `
      <tr>
        <td>${competition.event_date}</td>
        <td>${competition.name}</td>
        <td>${competition.category}</td>
        <td>${status}</td>
        <td>${!isRegistered && genderOk && ageOk ? `<button data-register-competition="${competition.id}">Inscribirme</button>` : ""}</td>
      </tr>
    `;
  }).join("");
  $("#competitorCompetitionTable").querySelectorAll("[data-register-competition]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        state.competitorPortal = await api("/api/competition-registrations", {
          method: "POST",
          body: JSON.stringify({ competitor_id: competitor.id, competition_id: Number(button.dataset.registerCompetition) }),
        });
        $("#competitorPortalStatus").textContent = "Inscripcion registrada.";
        renderCompetitorPortal();
      } catch (error) {
        $("#competitorPortalStatus").textContent = error.message;
      }
    });
  });
}

function resetCompetitionForm() {
  $("#competitionForm").reset();
  $("#competitionForm").elements.id.value = "";
  $("#competitionForm").elements.jury_president_id.value = "";
  $("#competitionForm").elements.organizer_last_name.value = "";
  $("#competitionForm").elements.organizer_name.value = "";
  $("#competitionForm").elements.organizer_dni.value = "";
  $("#competitionForm").elements.organizer_username.value = "";
  $("#competitionForm").elements.organizer_password.value = "";
  $("#competitionForm").elements.organizer_person_club.value = "";
  $("#saveCompetitionButton").textContent = "Crear competencia";
  $("#cancelCompetitionEdit").hidden = true;
  $("#competitionStatus").textContent = "";
  applyCompetitionFormRole();
  renderJuryPresidentOptions();
  $("#competitionType").dispatchEvent(new Event("change"));
}

function applyCompetitionFormRole() {
  const form = $("#competitionForm");
  if (!form) return;
  const isRegional = state.role === "regional_representative";
  form.elements.competition_type.value = isRegional ? "CRED" : form.elements.competition_type.value;
  form.elements.region.value = isRegional ? state.user?.region || "" : form.elements.region.value;
  form.elements.competition_type.disabled = isRegional;
  form.elements.region.disabled = isRegional;
}

function editCompetition(id) {
  const competition = state.competitions.find((item) => Number(item.id) === Number(id));
  if (!competition) return;
  const form = $("#competitionForm");
  form.elements.id.value = competition.id;
  form.elements.name.value = competition.name;
  form.elements.event_date.value = competition.event_date;
  form.elements.competition_type.value = competition.competition_type;
  form.elements.region.value = competition.region || "Buenos Aires";
  form.elements.modality.value = competition.modality;
  form.elements.category.value = competition.category;
  form.elements.organizer_club.value = competition.organizer_club;
  form.elements.organizer_last_name.value = competition.organizer_user?.last_name || "";
  form.elements.organizer_name.value = competition.organizer_user?.first_name || competition.organizer_user?.display_name || competition.organizer_club;
  form.elements.organizer_dni.value = competition.organizer_user?.dni || "";
  form.elements.organizer_username.value = competition.organizer_user?.username || "";
  form.elements.organizer_password.value = competition.organizer_user?.password || "";
  form.elements.organizer_person_club.value = competition.organizer_user?.club || "";
  form.elements.jury_president_id.value = competition.jury_president_id || "";
  applyCompetitionFormRole();
  renderJuryPresidentOptions();
  $("#saveCompetitionButton").textContent = "Guardar cambios";
  $("#cancelCompetitionEdit").hidden = false;
  $("#competitionType").dispatchEvent(new Event("change"));
}

function collectJudges() {
  return Array.from($("#judgesGrid").querySelectorAll("[data-judge-index]")).map((card) => ({
    judge_person_id: Number(card.querySelector('[data-judge-field="judge_person_id"]').value),
    username: card.querySelector('[data-judge-field="username"]').value,
    password: card.querySelector('[data-judge-field="password"]').value,
    active: card.querySelector('[data-judge-field="active"]').checked,
    assignments: {
      clasificatoria: Number(card.querySelector('[data-assignment="clasificatoria"]').value),
      semifinal: Number(card.querySelector('[data-assignment="semifinal"]').value),
      final: Number(card.querySelector('[data-assignment="final"]').value),
    },
    roles: {
      clasificatoria: card.querySelector('[data-principal-assignment="clasificatoria"]').checked ? "principal" : "backup",
      semifinal: card.querySelector('[data-principal-assignment="semifinal"]').checked ? "principal" : "backup",
      final: card.querySelector('[data-principal-assignment="final"]').checked ? "principal" : "backup",
    },
  }));
}

function collectJudgePeople() {
  syncJudgePersonDetail();
  return state.judgePeople.map((person) => ({
    id: person.id || null,
    first_name: person.first_name || "",
    last_name: person.last_name || "",
    dni: person.dni || "",
    mail: person.mail || "",
    phone: person.phone || "",
    club: person.club || "",
    level: Number(person.level || 3),
    active: person.active !== false,
    photo_url: person.photo_url || "",
  }));
}

function renderCompetitors() {
  $("#competitorCount").textContent = state.competitors.length;
  syncCompetitorFilterControls();
  $("#competitorStrip").innerHTML = state.competitors.map((competitor) => `
    <button class="competitor-card ${competitor.id === state.selectedCompetitorId ? "active" : ""}" data-id="${competitor.id}">
      #${competitor.bib_number} ${competitor.last_name}, ${competitor.first_name}
      <span>${competitor.club || "Sin club"} - ${competitor.category} - ${competitor.gender}</span>
    </button>
  `).join("");
  $("#competitorTable").innerHTML = state.competitors.map((competitor) => `
    <tr>
      <td>${competitor.bib_number}</td>
      <td>${competitor.last_name}, ${competitor.first_name}</td>
      <td>${competitor.club || "-"}</td>
      <td>${competitor.region || "-"}</td>
      <td>${competitor.category}</td>
      <td>${competitor.gender}</td>
      <td>${state.role === "competition_admin" ? `<button class="delete" data-delete="${competitor.id}">Eliminar</button>` : ""}</td>
    </tr>
  `).join("");

  $("#competitorStrip").querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectCompetitor(Number(button.dataset.id)));
  });
  $("#competitorTable").querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Eliminar competidor y sus puntajes?")) return;
      await api(`/api/competitors/${button.dataset.delete}`, { method: "DELETE" });
      await refreshAll();
    });
  });

  if (state.selectedCompetitorId && !state.competitors.some((item) => item.id === state.selectedCompetitorId)) {
    state.selectedCompetitorId = null;
  }
  if (!state.selectedCompetitorId && state.competitors[0]) {
    selectCompetitor(state.competitors[0].id);
  } else {
    updateActiveCompetitorName();
  }
}

function syncCompetitorFilterControls() {
  [
    ["#competitorFilterCategory", "category"],
    ["#judgeCompetitorFilterCategory", "category"],
    ["#competitorFilterGender", "gender"],
    ["#judgeCompetitorFilterGender", "gender"],
  ].forEach(([selector, key]) => {
    const control = $(selector);
    if (control && control.value !== state.competitorFilters[key]) control.value = state.competitorFilters[key];
  });
}

async function updateCompetitorFilters(category, gender) {
  state.competitorFilters = { category, gender };
  state.selectedCompetitorId = null;
  await loadCompetitors();
}

function selectCompetitor(id) {
  state.selectedCompetitorId = id;
  resetScoreForm();
  renderCompetitors();
  updateActiveCompetitorName();
}

function updateActiveCompetitorName() {
  const competitor = state.competitors.find((item) => item.id === state.selectedCompetitorId);
  $("#activeCompetitorName").textContent = competitor
    ? `#${competitor.bib_number} ${competitor.last_name}, ${competitor.first_name}`
    : "Selecciona un competidor";
}

async function loadConfig() {
  const config = await api("/api/config");
  state.rounds = config.rounds;
  renderRounds();
}

async function loadJudges() {
  const query = state.currentCompetitionId ? `?competition_id=${state.currentCompetitionId}` : "";
  state.judges = await api(`/api/judges${query}`);
  renderJudges();
}

async function loadJudgePeople() {
  state.judgePeople = await api("/api/judge-people");
  renderJudgePeople();
}

async function loadRegionalRepresentatives() {
  state.regionalRepresentatives = await api("/api/regional-representatives");
  renderRegionalRepresentatives();
}

async function loadCompetitions() {
  state.competitions = await api("/api/competitions");
  renderCompetitions();
  renderPublicCalendar();
}

async function loadCompetitors() {
  const params = new URLSearchParams(state.competitorFilters);
  state.competitors = await api(`/api/competitors?${params}`);
  renderCompetitors();
}

async function loadRegistrations() {
  const competitionId = state.currentCompetitionId || state.user?.competition_id;
  if (!competitionId) {
    $("#registrationsTitle").textContent = "Inscriptos";
    $("#registrationsTable").innerHTML = '<tr><td colspan="12">Selecciona una competencia.</td></tr>';
    return;
  }
  state.currentCompetitionId = Number(competitionId);
  const competition = currentCompetition();
  applyRegistrationCategoryRules(competition);
  $("#registrationsTitle").textContent = competition ? `Inscriptos - ${competition.name}` : "Inscriptos";
  const params = new URLSearchParams({ competition_id: state.currentCompetitionId, ...state.registrationFilters });
  state.registrations = mergeStoredRegistrations(await api(`/api/competition-registrants?${params}`));
  $("#registrationsTable").innerHTML = state.registrations.length
    ? state.registrations.map((row) => `
      <tr data-registration-id="${row.registration_id}" data-registration-key="${row._registration_key}">
        <td>${row.bib_number}</td>
        <td>${row.last_name}, ${row.first_name}</td>
        <td>${row.dni}</td>
        <td>${row.email || "-"}</td>
        <td>${row.phone || "-"}</td>
        <td>${row.club || "-"}</td>
        <td>${row.region || "-"}</td>
        <td>${row.category}</td>
        <td>${row.gender}</td>
        <td><input type="checkbox" data-registration-field="payment_validated" ${row.payment_validated ? "checked" : ""} /></td>
        <td><input type="checkbox" data-registration-field="accredited" ${row.accredited ? "checked" : ""} ${row.payment_validated ? "" : "disabled"} /></td>
        <td>${row.registered_at || "-"}</td>
        <td><button class="delete" data-delete-registration>Eliminar</button></td>
      </tr>
    `).join("")
    : '<tr><td colspan="13">No hay inscriptos para los filtros seleccionados.</td></tr>';
  $("#registrationsTable").querySelectorAll("[data-registration-field]").forEach((control) => {
    control.addEventListener("change", () => saveRegistrationStatus(control.closest("[data-registration-id]")));
  });
  $("#registrationsTable").querySelectorAll("[data-delete-registration]").forEach((button) => {
    button.addEventListener("click", () => deleteRegistration(button.closest("[data-registration-id]")));
  });
}

function applyRegistrationCategoryRules(competition) {
  const categoryControl = $("#registrationsCategory");
  if (!categoryControl || !competition) return;
  if (competition.category === "Mayores") {
    state.registrationFilters.category = "mayor";
    categoryControl.value = "mayor";
    categoryControl.disabled = true;
    return;
  }
  categoryControl.disabled = false;
  if (competition.category === "Juveniles" && state.registrationFilters.category === "mayor") {
    state.registrationFilters.category = "U17";
    categoryControl.value = "U17";
  }
}

async function saveRegistrationStatus(row) {
  if (!row) return;
  const paid = row.querySelector('[data-registration-field="payment_validated"]');
  const accredited = row.querySelector('[data-registration-field="accredited"]');
  if (!paid.checked) {
    accredited.checked = false;
    accredited.disabled = true;
  } else {
    accredited.disabled = false;
  }
  if (accredited.checked && !paid.checked) {
    accredited.checked = false;
    return;
  }
  const store = readRegistrationStore();
  store.statuses = store.statuses || {};
  store.statuses[row.dataset.registrationKey] = {
    payment_validated: paid.checked,
    accredited: accredited.checked,
  };
  writeRegistrationStore(store);
  await api("/api/competition-registration-status", {
    method: "POST",
    body: JSON.stringify({
      competition_id: state.currentCompetitionId,
      registration_id: Number(row.dataset.registrationId),
      payment_validated: paid.checked,
      accredited: accredited.checked,
    }),
  });
}

function deleteRegistration(row) {
  if (!row) return;
  const store = readRegistrationStore();
  store.deleted = Array.from(new Set([...(store.deleted || []), row.dataset.registrationKey]));
  writeRegistrationStore(store);
  row.remove();
  if (!$("#registrationsTable").children.length) {
    $("#registrationsTable").innerHTML = '<tr><td colspan="13">No hay inscriptos para los filtros seleccionados.</td></tr>';
  }
}

async function loadLeaderboard() {
  applyResultsCategoryRules(currentCompetition());
  const round = $("#resultsRound").value || activeRounds()[0]?.[0] || "clasificatoria";
  const category = $("#resultsCategory").value;
  const gender = $("#resultsGender").value;
  const params = new URLSearchParams({ round, category, gender, competition_id: state.currentCompetitionId || state.user?.competition_id || 1 });
  const rows = await api(`/api/leaderboard?${params}`);
  const boulderCount = state.rounds[round]?.boulders || 1;
  $("#leaderboardHead").innerHTML = `
    <tr>
      <th>Puesto</th><th>Nro.</th><th>Competidor</th><th>Club</th><th>Total</th><th>Tops</th><th>Zonas</th><th>Intentos</th>
      ${Array.from({ length: boulderCount }, (_, index) => `<th>B${index + 1}</th>`).join("")}
    </tr>
  `;
  $("#leaderboardBody").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.rank}</td>
      <td>${row.bib_number}</td>
      <td>${row.last_name}, ${row.first_name}</td>
      <td>${row.club || "-"}</td>
      <td><strong>${Number(row.total_score).toFixed(1)}</strong></td>
      <td>${row.tops}</td>
      <td>${row.zones}</td>
      <td>${row.attempts}</td>
      ${row.boulders.map((value) => `<td>${Number(value).toFixed(1)}</td>`).join("")}
    </tr>
  `).join("");
  $("#exportCsv").href = `/api/export.csv?${params}`;
}

function applyResultsCategoryRules(competition) {
  const categoryControl = $("#resultsCategory");
  if (!categoryControl || !competition) return;
  if (competition.category === "Mayores") {
    categoryControl.value = "mayor";
    categoryControl.disabled = true;
    return;
  }
  categoryControl.disabled = false;
  if (competition.category === "Juveniles" && categoryControl.value === "mayor") {
    categoryControl.value = "U17";
  }
}

async function loadScores() {
  const round = $("#computosRound").value || activeRounds()[0]?.[0] || "clasificatoria";
  const boulder = $("#computosBoulder").value;
  const params = new URLSearchParams({ round, boulder });
  const rows = await api(`/api/scores?${params}`);
  const readonly = state.role === "general_admin";
  const disabled = readonly ? "disabled" : "";
  $("#scoresTable").innerHTML = rows.map((row) => `
    <tr data-score-row data-competitor="${row.competitor_id}" data-round="${row.round}" data-boulder="${row.boulder}" data-judge-username="${row.judge_username || ""}" data-official="${row.official ? 1 : 0}">
      <td>${row.bib_number}</td>
      <td>${row.last_name}, ${row.first_name}</td>
      <td>${state.rounds[row.round]?.label || row.round}</td>
      <td>${row.boulder}</td>
      <td><input type="number" min="0" data-field="attempts" value="${row.attempts}" ${disabled} /></td>
      <td><input type="number" min="1" data-field="zone_attempt" value="${row.zone_attempt || ""}" ${disabled} /></td>
      <td><input type="number" min="1" data-field="top_attempt" value="${row.top_attempt || ""}" ${disabled} /></td>
      <td><strong>${Number(row.score).toFixed(1)}</strong></td>
      <td>
        <input data-field="judge_name" value="${row.judge_name || ""}" ${disabled} />
        <span class="score-kind ${row.official ? "official" : "backup"}">${row.official ? "Oficial" : "Backup"}</span>
      </td>
      <td>${readonly ? "" : "<button data-save-score>Guardar</button>"}</td>
    </tr>
  `).join("");
  $("#scoresTable").querySelectorAll("[data-save-score]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("[data-score-row]");
      const payload = {
        competitor_id: Number(row.dataset.competitor),
        round: row.dataset.round,
        boulder: Number(row.dataset.boulder),
        attempts: Number(row.querySelector('[data-field="attempts"]').value || 0),
        zone_attempt: row.querySelector('[data-field="zone_attempt"]').value || null,
        top_attempt: row.querySelector('[data-field="top_attempt"]').value || null,
        judge_name: row.querySelector('[data-field="judge_name"]').value,
        judge_username: row.dataset.judgeUsername,
        official: row.dataset.official === "1",
      };
      await api("/api/scores", { method: "POST", body: JSON.stringify(payload) });
      await refreshComputed();
    });
  });
}

async function loadTimer() {
  let timer = computedLocalTimer();
  if (!timer) {
    const serverTimer = await api("/api/timer");
    timer = writeLocalTimer(newLocalTimer(serverTimer.round, 1), false);
  }
  if (timer.running) {
    handleTimerAlarms(timer);
    writeLocalTimer(timer, true);
  } else {
    renderTimer(timer);
  }
}

async function refreshComputed() {
  await Promise.all([loadScores(), loadLeaderboard()]);
}

async function refreshAll() {
  await Promise.all([loadCompetitors(), loadLeaderboard(), loadScores(), loadTimer(), loadCompetitions()]);
}

function bindEvents() {
  bindPhotoPicker({
    previewSelector: "#judgePhotoPreview",
    fileSelector: "#judgePhotoFile",
    fieldSelector: '[data-person-field="photo_url"]',
    statusSelector: "#judgePeopleStatus",
    onChange: () => {
      syncJudgePersonDetail();
      renderJudgePeople();
    },
  });
  bindPhotoPicker({
    previewSelector: "#judgePortalPhotoPreview",
    fileSelector: "#judgePortalPhotoFile",
    fieldSelector: '[data-judge-portal-field="photo_url"]',
    statusSelector: "#judgePortalStatus",
  });
  bindPhotoPicker({
    previewSelector: "#competitorPhotoPreview",
    fileSelector: "#competitorPhotoFile",
    fieldSelector: '[data-competitor-field="photo_url"]',
    statusSelector: "#competitorPortalStatus",
  });

  $("#showAdminLogin").addEventListener("click", () => {
    hideAccessForms();
    state.loginCompetitionId = null;
    $("#loginForm").querySelector("h2").textContent = "Ingreso administrador";
    $("#loginForm").classList.remove("hidden");
    $("#loginForm").querySelector('[name="user"]').focus();
  });
  $("#showRegionalLogin").addEventListener("click", () => {
    hideAccessForms();
    state.loginCompetitionId = null;
    $("#loginForm").querySelector("h2").textContent = "Ingreso referente regional";
    $("#loginForm").classList.remove("hidden");
    $("#loginForm").querySelector('[name="user"]').focus();
  });
  $("#showJudgePortalLogin").addEventListener("click", () => {
    hideAccessForms();
    $("#judgePortalLoginForm").classList.remove("hidden");
    $("#judgePortalLoginForm").querySelector('[name="username"]').focus();
  });
  $("#showCompetitorPortal").addEventListener("click", () => {
    hideAccessForms();
    $("#competitorLoginForm").classList.remove("hidden");
    $("#competitorLoginForm").querySelector('[name="email"]').focus();
  });
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    loginWithCredentials(data.get("user"), data.get("password"))
      .then((session) => {
        state.user = session.user;
        state.currentCompetitionId = session.user?.competition_id || state.currentCompetitionId;
        applyRole(session.role);
        loadJudges();
      })
      .catch((error) => {
        $("#loginStatus").textContent = error.message || "Usuario o contraseña incorrectos.";
      });
  });
  $("#judgePortalLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      state.judgePortalCredentials = { username: data.get("username"), password: data.get("password") };
      state.judgePortal = await api("/api/judge-portal-login", {
        method: "POST",
        body: JSON.stringify(state.judgePortalCredentials),
      });
      applyRole("judge_portal");
    } catch (error) {
      $("#loginStatus").textContent = error.message;
    }
  });
  $("#competitorLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      state.competitorCredentials = { email: data.get("email"), password: data.get("password") };
      state.competitorPortal = await api("/api/competitor-login", {
        method: "POST",
        body: JSON.stringify(state.competitorCredentials),
      });
      applyRole("competitor");
    } catch (error) {
      $("#loginStatus").textContent = error.message;
    }
  });
  $("#showCompetitorRegister").addEventListener("click", () => {
    $("#competitorLoginForm").classList.add("hidden");
    $("#competitorRegisterForm").classList.remove("hidden");
  });
  $("#competitorRegisterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      state.competitorCredentials = { email: payload.email, password: payload.password };
      state.competitorPortal = await api("/api/competitor-register", { method: "POST", body: JSON.stringify(payload) });
      applyRole("competitor");
    } catch (error) {
      $("#loginStatus").textContent = error.message;
    }
  });
  $("#logoutButton").addEventListener("click", logout);

  [
    ["#publicFilterCategory", "category"],
    ["#publicFilterType", "type"],
    ["#publicFilterModality", "modality"],
    ["#publicFilterRegion", "region"],
  ].forEach(([selector, key]) => {
    const control = $(selector);
    if (!control) return;
    control.addEventListener("change", () => {
      state.publicCalendarFilters[key] = control.value;
      renderPublicCalendar();
    });
  });

  function toggleRegionField() {
    $("#regionField").hidden = $("#competitionType").value !== "CRED";
  }
  $("#competitionType").addEventListener("change", toggleRegionField);
  toggleRegionField();
  $("#openOrganizerEditor")?.addEventListener("click", openOrganizerEditor);
  $("#closeOrganizerEditor").addEventListener("click", closeOrganizerEditor);
  $("#saveOrganizerEditor").addEventListener("click", saveOrganizerEditor);
  $("#organizerModal").addEventListener("click", (event) => {
    if (event.target.id === "organizerModal") closeOrganizerEditor();
  });
  $("#openJuryPresidentPicker")?.addEventListener("click", openJuryPresidentPicker);
  $("#closeJuryPresidentPicker").addEventListener("click", closeJuryPresidentPicker);
  $("#juryPresidentModal").addEventListener("click", (event) => {
    if (event.target.id === "juryPresidentModal") closeJuryPresidentPicker();
  });

  $("#competitionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const organizer = organizerFormData();
    const hasOrganizerData = organizer.first_name || organizer.last_name || organizer.dni || organizer.username || organizer.password || organizer.club;
    if (hasOrganizerData && (!organizer.first_name || !organizer.last_name || !organizer.dni || !organizer.username || !organizer.password)) {
      $("#competitionStatus").textContent = "Carga nombre, apellido, DNI, mail y contraseña del organizador.";
      return;
    }
    if (hasOrganizerData && !/^\d{8}$/.test(organizer.dni)) {
      $("#competitionStatus").textContent = "El DNI del organizador debe tener exactamente 8 digitos numericos.";
      return;
    }
    payload.sport_category = payload.category === "Mayores" ? "mayor" : "";
    if (state.role === "regional_representative") {
      payload.creator_role = "regional_representative";
      payload.representative_id = state.user.id;
      payload.representative_username = state.user.username;
      payload.competition_type = "CRED";
      payload.region = state.user.region;
    }
    if (!payload.id) delete payload.id;
    if (payload.competition_type !== "CRED") payload.region = "";
    try {
      await api("/api/competitions", { method: "POST", body: JSON.stringify(payload) });
      resetCompetitionForm();
      $("#competitionStatus").textContent = "Competencia guardada. El formulario quedo listo para crear una nueva.";
      await loadCompetitions();
    } catch (error) {
      $("#competitionStatus").textContent = error.message;
    }
  });
  $("#cancelCompetitionEdit").addEventListener("click", resetCompetitionForm);
  $("#refreshCompetitions").addEventListener("click", loadCompetitions);

  $("#addRegionalRepresentative").addEventListener("click", () => {
    syncRegionalRepresentatives();
    state.regionalRepresentatives.push(defaultRegionalRepresentative(state.regionalRepresentatives.length));
    renderRegionalRepresentatives();
  });

  $("#saveRegionalRepresentatives").addEventListener("click", async () => {
    try {
      syncRegionalRepresentatives();
      state.regionalRepresentatives = await api("/api/regional-representatives", {
        method: "POST",
        body: JSON.stringify({ representatives: state.regionalRepresentatives }),
      });
      $("#regionalRepresentativesStatus").textContent = "Referentes guardados.";
      renderRegionalRepresentatives();
    } catch (error) {
      $("#regionalRepresentativesStatus").textContent = error.message;
    }
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.dataset.view) return;
      activateView(button.dataset.view);
    });
  });

  $("#roundSelect").addEventListener("change", () => {
    renderBoulders();
    resetScoreForm();
  });
  $("#boulderSelect").addEventListener("change", resetScoreForm);
  [
    ["#competitorFilterCategory", "category"],
    ["#judgeCompetitorFilterCategory", "category"],
    ["#competitorFilterGender", "gender"],
    ["#judgeCompetitorFilterGender", "gender"],
  ].forEach(([selector, key]) => {
    const control = $(selector);
    if (!control) return;
    control.addEventListener("change", () => {
      updateCompetitorFilters(
        key === "category" ? control.value : state.competitorFilters.category,
        key === "gender" ? control.value : state.competitorFilters.gender,
      );
    });
  });
  [
    ["#registrationsCategory", "category"],
    ["#registrationsGender", "gender"],
  ].forEach(([selector, key]) => {
    const control = $(selector);
    if (!control) return;
    control.addEventListener("change", () => {
      state.registrationFilters[key] = control.value;
      loadRegistrations();
    });
  });
  $("#refreshRegistrations").addEventListener("click", loadRegistrations);
  $("#timerRound").addEventListener("change", renderBoulders);
  $("#computosRound").addEventListener("change", () => {
    renderBoulders();
    loadScores();
  });
  $("#computosBoulder").addEventListener("change", loadScores);
  $("#refreshScores").addEventListener("click", refreshComputed);

  $("#attemptPlus").addEventListener("click", () => {
    state.attempts += 1;
    renderScore();
  });
  $("#attemptMinus").addEventListener("click", () => {
    state.attempts = Math.max(0, state.attempts - 1);
    if (state.zoneAttempt && state.zoneAttempt > state.attempts) state.zoneAttempt = null;
    if (state.topAttempt && state.topAttempt > state.attempts) state.topAttempt = null;
    renderScore();
  });
  $("#zoneButton").addEventListener("click", () => {
    if (state.attempts === 0) state.attempts = 1;
    state.zoneAttempt = state.attempts;
    renderScore();
  });
  $("#topButton").addEventListener("click", () => {
    if (state.attempts === 0) state.attempts = 1;
    state.topAttempt = state.attempts;
    if (!state.zoneAttempt || state.zoneAttempt > state.topAttempt) state.zoneAttempt = state.topAttempt;
    renderScore();
  });
  $("#clearMilestones").addEventListener("click", () => {
    state.zoneAttempt = null;
    state.topAttempt = null;
    renderScore();
  });

  $("#saveScore").addEventListener("click", async () => {
    if (!state.selectedCompetitorId) {
      $("#saveStatus").textContent = "Primero selecciona un competidor.";
      return;
    }
    const payload = {
      competitor_id: state.selectedCompetitorId,
      round: selectedRound(),
      boulder: selectedBoulder(),
      attempts: state.attempts,
      zone_attempt: state.zoneAttempt,
      top_attempt: state.topAttempt,
      judge_name: $("#judgeName").value,
      judge_username: state.user?.username || $("#judgeName").value,
      judge_role: judgeRole(selectedRound()),
      official: judgeRole(selectedRound()) === "principal",
      notes: $("#scoreNotes").value,
    };
    try {
      await api("/api/scores", { method: "POST", body: JSON.stringify(payload) });
      $("#saveStatus").textContent = judgeRole(selectedRound()) === "principal"
        ? "Puntaje oficial guardado."
        : "Puntaje backup guardado para control.";
      await refreshComputed();
      const index = state.competitors.findIndex((item) => item.id === state.selectedCompetitorId);
      const next = state.competitors[index + 1];
      if (next) selectCompetitor(next.id);
    } catch (error) {
      $("#saveStatus").textContent = error.message;
    }
  });

  $("#competitorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api("/api/competitors", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      $("#formStatus").textContent = "Competidor agregado.";
      await refreshAll();
    } catch (error) {
      $("#formStatus").textContent = error.message;
    }
  });

  $("#seedCompetitors").addEventListener("click", async () => {
    const result = await api("/api/seed", { method: "POST", body: "{}" });
    $("#formStatus").textContent = `Demo cargada: ${result.total} competidores en base.`;
    await refreshAll();
  });

  $("#saveJudgePortalProfile").addEventListener("click", async () => {
    const profile = {};
    document.querySelectorAll("[data-judge-portal-field]").forEach((field) => {
      if (field.dataset.judgePortalField !== "level") profile[field.dataset.judgePortalField] = field.value;
    });
    try {
      state.judgePortal = await api("/api/judge-portal-profile", {
        method: "POST",
        body: JSON.stringify({ ...state.judgePortalCredentials, profile }),
      });
      state.judgePortalCredentials.username = profile.mail || state.judgePortalCredentials.username;
      if (profile.password) state.judgePortalCredentials.password = profile.password;
      $("#judgePortalStatus").textContent = "Datos guardados.";
      renderJudgePortal();
    } catch (error) {
      $("#judgePortalStatus").textContent = error.message;
    }
  });

  $("#saveCompetitorProfile").addEventListener("click", async () => {
    const profile = {};
    document.querySelectorAll("[data-competitor-field]").forEach((field) => {
      profile[field.dataset.competitorField] = field.value;
    });
    try {
      state.competitorPortal = await api("/api/competitor-profile", {
        method: "POST",
        body: JSON.stringify({ ...state.competitorCredentials, profile }),
      });
      state.competitorCredentials.email = profile.email || state.competitorCredentials.email;
      if (profile.password) state.competitorCredentials.password = profile.password;
      $("#competitorPortalStatus").textContent = "Datos guardados.";
      renderCompetitorPortal();
    } catch (error) {
      $("#competitorPortalStatus").textContent = error.message;
    }
  });

  $("#refreshCompetitorCalendar").addEventListener("click", async () => {
    await loadCompetitions();
    renderCompetitorPortal();
  });

  $("#saveConfig").addEventListener("click", async () => {
    const rounds = {};
    $("#configGrid").querySelectorAll("[data-round]").forEach((card) => {
      rounds[card.dataset.round] = {
        active: card.querySelector('[data-config="active"]').checked,
        boulders: Number(card.querySelector('[data-config="boulders"]').value),
        minutes: Number(card.querySelector('[data-config="minutes"]').value),
      };
    });
    const config = await api("/api/config", { method: "POST", body: JSON.stringify({ rounds }) });
    state.rounds = config.rounds;
    $("#configStatus").textContent = "Configuracion guardada.";
    renderRounds();
    await refreshAll();
  });

  $("#addJudgePerson").addEventListener("click", () => {
    syncJudgePersonDetail();
    state.judgePeople.push(defaultJudgePerson(state.judgePeople.length));
    renderJudgePeople();
    renderJudges();
    openJudgePersonDetail(state.judgePeople.length - 1);
  });
  $("#closeJudgePersonDetail").addEventListener("click", closeJudgePersonDetail);
  $("#judgePersonModal").addEventListener("click", (event) => {
    if (event.target.id === "judgePersonModal") closeJudgePersonDetail();
  });
  $("#judgePersonDetail").addEventListener("input", (event) => {
    syncJudgePersonDetail();
    renderJudgePeople();
  });
  $("#judgePersonDetail").addEventListener("change", () => {
    syncJudgePersonDetail();
    renderJudgePeople();
    renderJudges();
  });

  $("#saveJudgePeople").addEventListener("click", async () => {
    try {
      state.judgePeople = await api("/api/judge-people", {
        method: "POST",
        body: JSON.stringify({ people: collectJudgePeople() }),
      });
      $("#judgePeopleStatus").textContent = "Base de jueces guardada.";
      renderJudgePeople();
      renderJudges();
    } catch (error) {
      $("#judgePeopleStatus").textContent = error.message;
    }
  });

  $("#applyJudgeCount").addEventListener("click", () => {
    const count = Math.max(1, Math.min(20, Number($("#judgeCount").value || 1)));
    state.judges = Array.from({ length: count }, (_, index) => state.judges[index] || defaultJudge(index));
    renderJudges();
  });

  $("#saveJudges").addEventListener("click", async () => {
    if (!state.currentCompetitionId) {
      $("#judgesStatus").textContent = "Primero hay que ingresar como presidente de jurado de una competencia.";
      return;
    }
    try {
      state.judges = await api("/api/judges", {
        method: "POST",
        body: JSON.stringify({ competition_id: state.currentCompetitionId, judges: collectJudges() }),
      });
      $("#judgesStatus").textContent = "Jueces guardados.";
      await loadJudges();
      renderJudges();
    } catch (error) {
      $("#judgesStatus").textContent = error.message;
    }
  });

  ["resultsRound", "resultsCategory", "resultsGender"].forEach((id) => {
    $(`#${id}`).addEventListener("change", loadLeaderboard);
  });

  $("#timerSelect").addEventListener("click", () => openTimerAuthorization("select"));
  $("#timerPlayPause").addEventListener("click", () => {
    const timer = computedLocalTimer();
    openTimerAuthorization(timer?.running ? "pause" : "start");
  });
  $("#timerStop").addEventListener("click", () => openTimerAuthorization("reset"));
  $("#closeTimerAuthorization").addEventListener("click", closeTimerAuthorization);
  $("#confirmTimerAuthorization").addEventListener("click", () => {
    authorizeTimerAction().catch((error) => {
      $("#timerAuthorizationStatus").textContent = error.message;
    });
  });
  $("#timerAuthorizationPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      authorizeTimerAction().catch((error) => {
        $("#timerAuthorizationStatus").textContent = error.message;
      });
    }
    if (event.key === "Escape") closeTimerAuthorization();
  });
  $("#openProjectorTimer").addEventListener("click", () => {
    window.open("/timer.html", "_blank", "noopener,noreferrer");
  });
}

async function init() {
  await loadConfig();
  await loadJudgePeople();
  await loadJudges();
  await loadCompetitions();
  bindEvents();
  await refreshAll();
  localStorage.removeItem("credFasaRole");
  setInterval(loadTimer, 250);
  setInterval(refreshComputed, 5000);
}

if (timerChannel) {
  timerChannel.addEventListener("message", (event) => {
    if (!event.data) return;
    state.timer = event.data;
    renderTimer(computedLocalTimer(event.data));
  });
}

window.addEventListener("storage", (event) => {
  if (event.key !== TIMER_STORAGE_KEY) return;
  state.timer = readLocalTimer();
  renderTimer(computedLocalTimer());
});

init();
