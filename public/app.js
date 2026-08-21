const state = {
  rounds: {},
  competitors: [],
  selectedCompetitorId: null,
  attempts: 0,
  zoneAttempt: null,
  topAttempt: null,
  timer: null,
  role: null,
  roles: [],
  privateRoleOpen: false,
  user: null,
  judges: [],
  judgePeople: [],
  regionalRepresentatives: [],
  fasaProfiles: [],
  validatedJudgeBatch: [],
  routeSetterPeople: [],
  validatedRouteSetterBatch: [],
  competitions: [],
  registrations: [],
  currentCompetitionId: null,
  eventRoleActive: false,
  reviewCompetitionInternalId: null,
  loginCompetitionId: null,
  competitorFilters: { category: "mayor", gender: "Mujer" },
  registrationFilters: { category: "mayor", gender: "Mujer" },
  publicCalendarFilters: { category: "", type: "", modality: "", region: "", month: "" },
  publicRankingFilters: { type: "argentine", region: "Buenos Aires", category: "mayor", gender: "Mujer", discipline: "Boulder" },
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
let personPickerAction = null;
const REGISTRATION_STORAGE_KEY = "credFasaRegistrationState";
const ROUND_SCHEDULE_STORAGE_KEY = "credFasaRoundSchedules";
const START_ORDER_STORAGE_KEY = "credFasaStartOrders";
const ROUND_COMPLETION_STORAGE_KEY = "credFasaRoundCompletion";
const timerChannel = "BroadcastChannel" in window ? new BroadcastChannel(TIMER_CHANNEL_NAME) : null;
let timerAudioContext = null;
const timerAlarmMarks = new Set();
let lastTimerPublishAt = 0;
let lastRemoteTimerFetchAt = 0;
let remoteTimerFetchInFlight = false;

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

async function uploadInfosheet(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/infosheet-upload", { method: "POST", body: formData });
  const result = await response.json().catch(() => ({ error: "No se pudo subir el Infosheet." }));
  if (!response.ok) throw new Error(result.error || "No se pudo subir el Infosheet.");
  return result;
}

async function uploadOrganizerLogo(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/organizer-logo-upload", { method: "POST", body: formData });
  const result = await response.json().catch(() => ({ error: "No se pudo subir el logo del club." }));
  if (!response.ok) throw new Error(result.error || "No se pudo subir el logo del club.");
  return result;
}

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

function selectedTimerGenders() {
  const genders = [];
  if ($("#timerGenderWomen")?.checked) genders.push("Mujer");
  if ($("#timerGenderMen")?.checked) genders.push("Hombre");
  return genders.length ? genders : ["Mujer", "Hombre"];
}

function requestedTimerCycle(defaultCycle = 1) {
  const value = Number($("#timerCycle")?.value);
  if (!Number.isFinite(value) || value < 1) return Math.max(1, Number(defaultCycle || 1));
  return Math.floor(value);
}

function newLocalTimer(roundKey = selectedRound(), boulder = selectedBoulder()) {
  return {
    round: roundKey,
    boulder: Number(boulder || 1),
    timer_schema: 3,
    mode: $("#timerMode")?.value || "manual",
    genders: selectedTimerGenders(),
    armed: false,
    scheduled_start_at: null,
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

function normalizeTimerSnapshot(stored) {
  if (!stored) return null;
  if (stored.timer_schema && stored.timer_schema !== 2 && stored.timer_schema !== 3) return null;
  const startedAt = stored.started_at ? Number(stored.started_at) : null;
  return {
    ...stored,
    timer_schema: 3,
    mode: stored.mode || "manual",
    genders: Array.isArray(stored.genders) && stored.genders.length ? stored.genders : ["Mujer", "Hombre"],
    armed: Boolean(stored.armed),
    scheduled_start_at: stored.scheduled_start_at || null,
    phase: stored.phase || "prep",
    prep_seconds: Number(stored.prep_seconds || TIMER_PREP_SECONDS),
    duration_seconds: Number(stored.duration_seconds || timerRoundDuration(stored.round)),
    remaining_seconds: Number(stored.remaining_seconds || 0),
    boulder: Number(stored.boulder || 1),
    cycle: Number(stored.cycle || 1),
    running: Boolean(stored.running),
    started_at: startedAt && startedAt < 100000000000 ? startedAt * 1000 : startedAt,
  };
}

function readLocalTimer() {
  try {
    const stored = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) || "null");
    const normalized = normalizeTimerSnapshot(stored);
    if (!normalized) return null;
    return {
      ...normalized,
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

function roleControlsTimer() {
  return state.role === "competition_admin";
}

function shouldReadRemoteTimer() {
  return !roleControlsTimer();
}

function publishTimerSnapshot(timer, force = false) {
  if (!roleControlsTimer() || !timer) return;
  const now = Date.now();
  if (!force && now - lastTimerPublishAt < 1000) return;
  lastTimerPublishAt = now;
  api("/api/timer", {
    method: "POST",
    body: JSON.stringify({ action: "sync", round: timer.round, boulder: timer.boulder || 1, state: timer }),
  }).catch(() => {});
}

async function fetchRemoteTimerSnapshot(force = false) {
  const now = Date.now();
  if (!force && (remoteTimerFetchInFlight || now - lastRemoteTimerFetchAt < 1000)) return null;
  remoteTimerFetchInFlight = true;
  lastRemoteTimerFetchAt = now;
  try {
    return normalizeTimerSnapshot(await api("/api/timer"));
  } catch {
    return null;
  } finally {
    remoteTimerFetchInFlight = false;
  }
}

function computedLocalTimer(timer = state.timer || readLocalTimer()) {
  if (!timer) return null;
  let next = { ...timer };
  if (next.mode === "automatic" && next.armed && !next.running && next.scheduled_start_at) {
    const startAt = new Date(next.scheduled_start_at).getTime();
    if (Date.now() >= startAt) {
      next = {
        ...next,
        armed: false,
        running: true,
        started_at: startAt,
      };
    }
  }
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

function scheduledStartForTimer(roundKey) {
  const competitionId = scheduleCompetitionKey();
  const schedules = readRoundScheduleStore()[competitionId] || {};
  const stored = Object.values(schedules)
    .filter((item) => item?.round === roundKey && item.date && item.time)
    .sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`))[0];
  if (!stored?.date || !stored?.time) return null;
  const date = new Date(`${stored.date}T${stored.time}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function timerPhaseLabel(timer) {
  return timer?.phase === "prep" ? "Preparacion" : "Escalada";
}

function timerStatusText(timer) {
  if (!timer) return "Cronometro local sin iniciar";
  if (timer.mode === "automatic" && timer.armed && timer.scheduled_start_at) {
    return `${timerRoundLabel(timer.round)} / automatico armado / inicia ${formatDateTimeForPdf(new Date(timer.scheduled_start_at))}`;
  }
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
  if ($("#timerPlayPause") && timer.mode === "automatic" && timer.armed) $("#timerPlayPause").textContent = "Armado";
  if ($("#timerRound")) $("#timerRound").value = timer.round;
  if ($("#timerMode")) $("#timerMode").value = timer.mode || "manual";
  if ($("#timerCycle") && document.activeElement !== $("#timerCycle")) $("#timerCycle").value = Math.max(1, Number(timer.cycle || 1));
  if ($("#timerGenderWomen")) $("#timerGenderWomen").checked = (timer.genders || []).includes("Mujer");
  if ($("#timerGenderMen")) $("#timerGenderMen").checked = (timer.genders || []).includes("Hombre");
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
  const isSameClimbCycle = previous?.phase === "climb" && timer.phase === "climb" && previous.cycle === timer.cycle;
  const crossed = (target, firstReadTolerance = 0) => {
    if (!previous || previous.phase !== timer.phase || previous.cycle !== timer.cycle) {
      return timer.phase === "climb" && timer.remaining_seconds <= target && timer.remaining_seconds >= target - firstReadTolerance;
    }
    return previous.remaining_seconds > target && timer.remaining_seconds <= target;
  };
  const markOnce = (name, callback) => {
    const mark = `${timer.cycle}-${timer.phase}-${name}`;
    if (timerAlarmMarks.has(mark)) return;
    timerAlarmMarks.add(mark);
    callback();
  };

  if (previous?.phase === "climb" && timer.phase === "prep") {
    markOnce("last-0", () => timerBeep(420, 0.28, 2, 0.18));
    state.lastTimerAlarmSnapshot = { ...timer };
    return;
  }
  if (timer.phase !== "climb") {
    state.lastTimerAlarmSnapshot = { ...timer };
    return;
  }
  const justStartedClimb = previous?.phase === "prep" || (!isSameClimbCycle && timer.remaining_seconds >= Number(timer.duration_seconds || 0) - 1);
  if (justStartedClimb) {
    markOnce("start", () => timerBeep(880, 0.18, 3));
  }
  if (crossed(60, 1)) {
    markOnce("one-minute", () => timerBeep(660, 0.24, 2, 0.28));
  }
  [3, 2, 1, 0].forEach((second) => {
    if (crossed(second, 0)) {
      markOnce(`last-${second}`, () => {
        if (second === 0) timerBeep(420, 0.28, 2, 0.18);
        else timerBeep(1040, 0.14, 1);
      });
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
  await runTimerAction(action);
  closeTimerAuthorization();
}

async function runTimerAction(action) {
  const round = $("#timerRound").value;
  const boulder = 1;
  const mode = $("#timerMode")?.value || "manual";
  const genders = selectedTimerGenders();
  let timer = computedLocalTimer() || newLocalTimer(round, boulder);
  const requestedCycle = requestedTimerCycle(timer.cycle || 1);
  const cycleChanged = requestedCycle !== Number(timer.cycle || 1);
  const roundChanged = timer.round !== round || timer.mode !== mode || JSON.stringify(timer.genders || []) !== JSON.stringify(genders);

  if (roundChanged || cycleChanged) {
    timer = newLocalTimer(round, boulder);
    timer = { ...timer, mode, genders, cycle: requestedCycle };
    if (cycleChanged && !roundChanged) {
      timer = {
        ...timer,
        armed: false,
        scheduled_start_at: null,
        phase: "climb",
        remaining_seconds: timer.duration_seconds,
        running: false,
        started_at: null,
      };
    }
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = null;
  }
  if (action === "start") {
    if (mode === "automatic") {
      const scheduledStart = scheduledStartForTimer(round);
      if (!scheduledStart) {
        $("#timerStatus").textContent = "Carga fecha y hora de comienzo para esta ronda en Configuracion.";
        return;
      }
      timer = {
        ...timer,
        mode,
        genders,
        armed: true,
        scheduled_start_at: scheduledStart,
        running: false,
        started_at: null,
        phase: "prep",
        remaining_seconds: TIMER_PREP_SECONDS,
        cycle: requestedCycle,
      };
    } else {
      const phaseSeconds = timer.phase === "prep" ? timer.prep_seconds : timer.duration_seconds;
      const elapsedBeforePause = Math.max(0, phaseSeconds - Number(timer.remaining_seconds || phaseSeconds));
      timer = {
        ...timer,
        mode,
        genders,
        armed: false,
        scheduled_start_at: null,
        running: true,
        started_at: Date.now() - elapsedBeforePause * 1000,
      };
    }
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = { ...timer };
  }
  if (action === "pause") {
    timer = {
      ...timer,
      running: false,
      armed: false,
      started_at: null,
    };
  }
  if (action === "reset") {
    timer = newLocalTimer(round, boulder);
    timer = { ...timer, mode, genders };
    timerAlarmMarks.clear();
    state.lastTimerAlarmSnapshot = null;
  }

  writeLocalTimer(timer, true);
  publishTimerSnapshot(timer, true);
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
  if (role === "general_admin") return ["unifiedProfile", "fasaCv", "competitions", "regionalRepresentatives", "judgePeople", "routeSetterPeople", "fasaIdManagement", "administratorManagement"];
  if (role === "regional_representative") return ["unifiedProfile", "fasaCv", "competitions"];
  if (role === "competition_admin") return ["unifiedProfile", "fasaCv", "officialAssignments", "computos", "registrations", "config", "results"];
  if (role === "organizer") return ["unifiedProfile", "fasaCv", "officialAssignments", "registrations"];
  if (role === "judge") return ["unifiedProfile", "fasaCv", "officialProfile", "officialAssignments", "judge", "results"];
  if (role === "route_setter") return ["unifiedProfile", "fasaCv", "officialProfile", "officialAssignments", "routeSetterEvent"];
  if (role === "chief_route_setter") return ["unifiedProfile", "fasaCv", "officialProfile", "officialAssignments", "routeSetterTeam"];
  if (role === "judge_portal") return ["unifiedProfile", "fasaCv", "officialProfile", "officialAssignments"];
  if (role === "competitor") return ["unifiedProfile", "fasaCv", "competitorPortal"];
  return ["unifiedProfile", "results"];
}

function defaultView(role) {
  return "unifiedProfile";
}

function roleHome(role) {
  if (role === "general_admin") return "competitions";
  if (role === "regional_representative") return "competitions";
  if (["competition_admin", "organizer", "judge", "route_setter", "chief_route_setter"].includes(role)) return "officialAssignments";
  if (role === "judge_portal") return "judgePortal";
  if (role === "competitor") return "competitorPortal";
  return "results";
}

function roleEventHome(role) {
  if (role === "competition_admin") return "computos";
  if (role === "organizer") return "registrations";
  if (role === "judge") return "judge";
  if (role === "route_setter") return "routeSetterEvent";
  if (role === "chief_route_setter") return "routeSetterTeam";
  return "officialAssignments";
}

function eventScopedRole(role) {
  return ["competition_admin", "organizer", "judge", "route_setter", "chief_route_setter"].includes(role);
}

const EVENT_DETAIL_VIEWS = new Set(["computos", "registrations", "config", "results", "judge", "routeSetterEvent", "routeSetterTeam"]);

function activateView(view, options = {}) {
  const allowed = allowedViews(state.role);
  const safeView = options.force ? view : (allowed.includes(view) ? view : defaultView(state.role));
  document.querySelectorAll(".tab, .view").forEach((element) => element.classList.remove("active"));
  document.querySelectorAll(`.tab[data-view="${safeView}"]`).forEach((element) => element.classList.add("active"));
  $(`#${safeView}`).classList.add("active");
  renderActiveEventActions(safeView);
  if (safeView === "judge") loadCompetitors();
  if (safeView === "judgePeople") loadJudgePeople();
  if (safeView === "competitions") {
    loadRouteSetterPeople();
    populateCompetitionRolePickers();
  }
  if (safeView === "regionalRepresentatives") loadRegionalRepresentatives();
  if (safeView === "routeSetterPeople") loadRouteSetterPeople();
  if (safeView === "routeSetterTeam") loadRouteSetterTeam();
  if (safeView === "routeSetterEvent") renderRouteSetterEvent();
  if (safeView === "fasaCv") loadFasaCv();
  if (safeView === "fasaIdManagement") loadFasaManagement();
  if (safeView === "administratorManagement") loadAdministratorManagement();
  if (safeView === "results") loadLeaderboard();
  if (safeView === "registrations") loadRegistrations();
  if (safeView === "computos") refreshComputed();
  if (safeView === "judgePortal") renderJudgePortal();
  if (safeView === "competitorPortal") renderCompetitorPortal();
  if (safeView === "competitorPortal") setAthleteSubview(options.subview || "profile");
  if (safeView === "officialProfile" || safeView === "officialAssignments") renderOfficialArea();
  if (safeView === "unifiedProfile") renderUnifiedProfile();
}

function openCompetitionView(competitionId, view) {
  state.currentCompetitionId = Number(competitionId);
  activateView(view, { force: true });
}

function applyRole(role, options = {}) {
  state.role = role;
  state.privateRoleOpen = Boolean(options.openRole);
  if (eventScopedRole(role) && !options.eventSelected) {
    state.eventRoleActive = false;
    state.currentCompetitionId = null;
  }
  localStorage.setItem("credFasaRole", role);
  $("#loginGate").classList.add("hidden");
  $("#appHeader").classList.remove("hidden");
  $("#appMain").classList.remove("hidden");
  const secondaryNav = $(".private-secondary-nav");
  if (secondaryNav) secondaryNav.hidden = eventScopedRole(role);
  document.querySelectorAll(".tab[data-view]").forEach((button) => {
    const roles = button.dataset.roles.split(" ");
    const requiresEvent = EVENT_DETAIL_VIEWS.has(button.dataset.view);
    const allowed = allowedViews(role).includes(button.dataset.view) && roles.includes(role) && (!requiresEvent || state.eventRoleActive);
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
  renderCompetitions();
  renderAssignedRoles();
  applyCompetitionFormRole();
  renderActiveEventContext();
  activateView(options.view || (options.openRole ? roleHome(role) : defaultView(role)));
}

const ROLE_LABELS = {
  competitor: "Atleta",
  judge_portal: "Juez",
  judge: "Juez de evento",
  route_setter: "Aperturista",
  chief_route_setter: "Jefe de Aperturistas",
  organizer: "Organizador",
  competition_admin: "Presidente de jurado",
  regional_representative: "Referente regional",
  general_admin: "Administrador",
};

function renderAssignedRoles() {
  const container = $("#assignedRoles");
  if (!container) return;
  const roles = state.roles.length ? state.roles : [state.role];
  const pendingApprovals = state.competitions.filter((competition) => competition.status === "pending").length;
  const currentLabel = $("#currentRoleLabel");
  currentLabel.textContent = "";
  currentLabel.classList.add("hidden");
  currentLabel.classList.remove("has-approval-alert");
  document.querySelectorAll(".private-secondary-nav .tab[data-view]").forEach((button) => {
    if (!state.privateRoleOpen) {
      button.hidden = true;
      button.style.display = "none";
    }
  });
  container.innerHTML = `${roles.map((role) => `
    <button class="role-chip ${state.privateRoleOpen && role === state.role ? "active" : ""}" type="button" data-switch-role="${role}">
      ${ROLE_LABELS[role] || role}${role === "general_admin" && pendingApprovals ? `<span class="approval-alert" title="${pendingApprovals} evento(s) pendiente(s) de aprobación"></span>` : ""}
    </button>
  `).join("")}`;
  container.querySelectorAll("[data-switch-role]").forEach((button) => {
    button.addEventListener("click", () => applyRole(button.dataset.switchRole, { openRole: true }));
  });
}

function setAthleteSubview(subview) {
  document.querySelectorAll("[data-athlete-subview]").forEach((panel) => { panel.hidden = panel.dataset.athleteSubview !== subview; });
}

async function renderOfficialArea() {
  const role = state.role === "judge_portal" ? "judge" : state.role;
  const label = ROLE_LABELS[role] || "Oficial FASA";
  const details = state.user?.role_details?.[role] || {};
  $("#officialProfileTitle").textContent = `Perfil de ${label}`;
  $("#officialProfileRole").textContent = label;
  $("#officialProfileLevel").textContent = details.level ? `Nivel ${details.level}` : "Nivel sin asignar";
  $("#officialProfileName").textContent = state.user?.display_name || "Usuario FASA";
  $("#officialProfileClub").textContent = state.user?.club || "Club —";
  const roleTypes = role === "competition_admin" ? ["jury_president"] : role === "chief_route_setter" ? ["chief_route_setter"] : [role];
  let applicable = [];
  if (state.user?.fasa_id) {
    const cv = await api(`/api/fasa-cv?fasa_id=${encodeURIComponent(state.user.fasa_id)}`);
    applicable = cv.history.filter((item) => roleTypes.includes(item.role_type)).map((item) => ({ ...item, competition: state.competitions.find((competition) => Number(competition.id) === Number(item.competition_id)) || item.competition }));
  } else if (role === "judge" && state.judgePortal?.assignments) {
    applicable = state.judgePortal.assignments.map((competition) => ({ competition_id: competition.competition_id || competition.id, competition, role_label: "Juez" }));
  } else if (eventScopedRole(role)) {
    applicable = state.competitions.filter((competition) => competition.status === "approved").map((competition) => ({ competition_id: competition.id, competition, role_label: ROLE_LABELS[role] || role }));
  }
  const unique = applicable.filter((item, index, list) => item.competition && list.findIndex((candidate) => Number(candidate.competition_id) === Number(item.competition_id)) === index);
  $("#officialAssignmentsList").innerHTML = unique.length ? unique.map((item) => {
    const competition = item.competition;
    return `<article class="assigned-event-card"><time>${formatEventDateRange(competition)}</time><div><strong>${competitionDisplayName(competition)}</strong><span>${item.role_label || label} · ${competition.modality || "Disciplina a confirmar"}</span></div><button type="button" data-enter-assigned-event="${item.competition_id}">Entrar</button></article>`;
  }).join("") : "<p>No hay eventos asignados para este rol.</p>";
  $("#officialAssignmentsList").querySelectorAll("[data-enter-assigned-event]").forEach((button) => button.addEventListener("click", () => enterAssignedCompetition(Number(button.dataset.enterAssignedEvent))));
}

function enterAssignedCompetition(competitionId) {
  state.currentCompetitionId = Number(competitionId);
  state.eventRoleActive = true;
  if (state.user) state.user.competition_id = state.currentCompetitionId;
  applyRole(state.role, { openRole: true, eventSelected: true, view: roleEventHome(state.role) });
  loadJudges();
}

function renderActiveEventContext() {
  const context = $("#activeEventContext");
  if (!context) return;
  const competition = currentCompetition();
  const visible = eventScopedRole(state.role) && state.eventRoleActive && competition;
  context.hidden = !visible;
  if (!visible) return;
  $("#activeEventRole").textContent = ROLE_LABELS[state.role] || state.role;
  $("#activeEventName").textContent = competitionDisplayName(competition);
  $("#activeEventMeta").textContent = `${formatEventDateRange(competition)} · ${competition.competition_type}${competition.region ? ` · ${competition.region}` : ""} · ${competition.modality}`;
}

function eventActionsForRole(role) {
  if (role === "competition_admin") return [["computos", "Cómputos"], ["registrations", "Inscriptos"], ["config", "Configuración"], ["results", "Resultados"]];
  if (role === "organizer") return [["registrations", "Inscriptos"]];
  if (role === "judge") return [["judge", "Juecear"], ["results", "Resultados"]];
  if (role === "route_setter") return [["routeSetterEvent", "Evento"]];
  if (role === "chief_route_setter") return [["routeSetterTeam", "Equipo de aperturistas"]];
  return [];
}

function renderActiveEventActions(activeView = "") {
  const container = $("#activeEventActions");
  if (!container) return;
  if (!state.eventRoleActive) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = eventActionsForRole(state.role).map(([view, label]) => `<button type="button" class="${view === activeView ? "active" : ""}" data-event-view="${view}">${label}</button>`).join("");
  container.querySelectorAll("[data-event-view]").forEach((button) => button.addEventListener("click", () => activateView(button.dataset.eventView)));
}

function renderRouteSetterEvent() {
  const competition = currentCompetition();
  if (!competition) return;
  $("#routeSetterEventTitle").textContent = competitionDisplayName(competition);
  $("#routeSetterEventDetails").innerHTML = `<div><span>Fechas</span><strong>${formatEventDateRange(competition)}</strong></div><div><span>Club organizador</span><strong>${competition.organizer_club || "—"}</strong></div><div><span>Modalidad</span><strong>${competition.modality || "—"}</strong></div><div><span>Categoría</span><strong>${competition.category || "—"}</strong></div>${competition.infosheet_url ? `<a class="button-link" href="${competition.infosheet_url}" download>Descargar Infosheet</a>` : ""}`;
}

function unifiedProfileData() {
  const athlete = state.competitorPortal?.competitor || {};
  const person = state.judgePortal?.person || state.judgePortal?.profile || {};
  const display = String(state.user?.display_name || "").trim().split(/\s+/);
  const isAdmin = state.roles.includes("general_admin") || state.role === "general_admin";
  return {
    fasa_id: state.user?.fasa_id || athlete.fasa_id || person.fasa_id || "",
    first_name: athlete.first_name || person.first_name || display[0] || "",
    last_name: athlete.last_name || person.last_name || display.slice(1).join(" ") || "",
    nationality: athlete.nationality || "Argentina",
    dni: athlete.dni || person.dni || "",
    club: athlete.club || person.club || "",
    birth_date: athlete.birth_date || "",
    email: athlete.email || person.mail || state.user?.username || "",
    password: "",
    phone: athlete.phone || person.phone || "",
    address: athlete.address || "",
    province: athlete.province || "",
    region: athlete.region || "Buenos Aires",
    photo_url: athlete.photo_url || person.photo_url || state.user?.photo_url || (isAdmin ? "/assets/admin-demo-portrait.png" : ""),
  };
}

function renderUnifiedProfile() {
  const profile = unifiedProfileData();
  document.querySelectorAll("[data-unified-field]").forEach((field) => {
    field.value = profile[field.dataset.unifiedField] || "";
  });
  renderPhotoPreview($("#unifiedProfilePhoto"), profile.photo_url, "Foto del perfil FASA");
  renderPhotoPreview($("#fasaIdCardPhoto"), profile.photo_url, "Foto de FASA ID");
  $("#fasaIdCardName").textContent = `${profile.first_name || "Nombre"} ${profile.last_name || "Apellido"}`.trim();
  $("#fasaIdCardDni").textContent = `DNI ${profile.dni || "—"}`;
  $("#fasaIdCardClub").textContent = `Club ${profile.club || "—"}`;
  const roles = state.roles.length ? state.roles : [state.role];
  const athleteDetails = state.user?.role_details?.competitor || {};
  $("#editAthleteProfileEnabled").checked = roles.includes("competitor");
  $("#editAthleteInstagram").value = athleteDetails.instagram || "";
  $("#editAthletePublicConsent").checked = athleteDetails.public_profile === true;
  $("#fasaIdCardRoles").textContent = roles.map((role) => `${ROLE_LABELS[role] || role}${state.user?.role_details?.[role]?.level ? ` · Nivel ${state.user.role_details[role].level}` : ""}`).join(" · ");
  $("#fasaIdCardEmail").textContent = profile.email || "—";
  $("#fasaIdCardPhone").textContent = profile.phone || "—";
  $("#fasaIdCardAddress").textContent = profile.address || "—";
  $("#fasaIdCardLocation").textContent = [profile.province, profile.region].filter(Boolean).join(" · ") || "—";
  $("#fasaIdCardNationality").textContent = profile.nationality || "—";
  $("#fasaIdCardBirthDate").textContent = profile.birth_date || "—";
}

function logout() {
  state.role = null;
  state.roles = [];
  state.privateRoleOpen = false;
  state.user = null;
  state.currentCompetitionId = null;
  state.eventRoleActive = false;
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
  $("#loginForm").classList.remove("hidden");
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
    ["#computosCategory", $("#computosCategory")?.value || "mayor"],
    ["#computosGender", $("#computosGender")?.value || "Mujer"],
  ];
  defaults.forEach(([selector, value]) => {
    const control = $(selector);
    if (control && !control.value) control.value = value;
  });
}

function readRegistrationStore() {
  try {
    return JSON.parse(localStorage.getItem(REGISTRATION_STORAGE_KEY) || '{"statuses":{},"deleted":[],"closed":{},"bibs":{}}');
  } catch {
    return { statuses: {}, deleted: [], closed: {}, bibs: {} };
  }
}

function writeRegistrationStore(store) {
  localStorage.setItem(REGISTRATION_STORAGE_KEY, JSON.stringify({
    statuses: store.statuses || {},
    deleted: store.deleted || [],
    closed: store.closed || {},
    bibs: store.bibs || {},
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
      return { ...row, ...(store.statuses?.[key] || {}), bib: store.bibs?.[key] || "", _registration_key: key };
    })
    .filter((row) => !deleted.has(row._registration_key));
}

function registrationCompetitionKey() {
  return String(state.currentCompetitionId || state.user?.competition_id || "");
}

function registrationsClosed() {
  return Boolean(readRegistrationStore().closed?.[registrationCompetitionKey()]);
}

function canManageRegistrations() {
  return state.role === "competition_admin" || state.role === "organizer";
}

function readRoundScheduleStore() {
  try {
    return JSON.parse(localStorage.getItem(ROUND_SCHEDULE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeRoundScheduleStore(store) {
  localStorage.setItem(ROUND_SCHEDULE_STORAGE_KEY, JSON.stringify(store || {}));
}

function readStartOrderStore() {
  try {
    return JSON.parse(localStorage.getItem(START_ORDER_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStartOrderStore(store) {
  localStorage.setItem(START_ORDER_STORAGE_KEY, JSON.stringify(store || {}));
}

function readRoundCompletionStore() {
  try {
    return JSON.parse(localStorage.getItem(ROUND_COMPLETION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeRoundCompletionStore(store) {
  localStorage.setItem(ROUND_COMPLETION_STORAGE_KEY, JSON.stringify(store || {}));
}

function scheduleCompetitionKey() {
  return String(state.currentCompetitionId || state.user?.competition_id || "");
}

function competitionScheduleCategories(competition = currentCompetition()) {
  if (competition?.category === "Juveniles") return ["U17", "U19"];
  return ["mayor"];
}

function scheduleKey(roundKey, category, gender) {
  return `${roundKey}:${category}:${gender}`;
}

function roundCompletionKey(roundKey, category, gender) {
  return `${scheduleCompetitionKey()}:${roundKey}:${category}:${gender}`;
}

function roundClosed(roundKey, category, gender) {
  return Boolean(readRoundCompletionStore()[roundCompletionKey(roundKey, category, gender)]);
}

function canOpenRound(roundKey, category, gender) {
  if (roundKey === "clasificatoria") return true;
  if (roundKey === "semifinal") return roundClosed("clasificatoria", category, gender);
  if (roundKey === "final") {
    const previous = state.rounds.semifinal?.active ? "semifinal" : "clasificatoria";
    return roundClosed(previous, category, gender);
  }
  return true;
}

function startOrderLabel(value) {
  if (value === "bib") return "Por nro de Bib";
  if (value === "ranking") return "Por Ranking";
  if (value === "previous_reverse") return "Ronda previa inversa";
  return "Aleatorio";
}

function startOrderOptions(roundKey, selected) {
  if (roundKey !== "clasificatoria") {
    return `<option value="previous_reverse" selected>Ronda previa inversa</option>`;
  }
  return [
    ["random", "Aleatorio"],
    ["bib", "Por nro de Bib"],
    ["ranking", "Por Ranking"],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
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
  renderScore();
}

function renderConfig() {
  const orderStore = readStartOrderStore()[scheduleCompetitionKey()] || {};
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
      <label>Orden de salida
        <select data-config="start_order" ${key !== "clasificatoria" ? "disabled" : ""}>
          ${startOrderOptions(key, orderStore[key] || (key === "clasificatoria" ? "random" : "previous_reverse"))}
        </select>
      </label>
    </article>
  `).join("");
  renderRoundSchedule();
}

function renderRoundSchedule() {
  const table = $("#roundScheduleTable");
  if (!table) return;
  const competitionId = scheduleCompetitionKey();
  const competition = currentCompetition();
  if (!competitionId) {
    table.innerHTML = '<tr><td colspan="6">Seleccioná un evento.</td></tr>';
    return;
  }
  const schedules = readRoundScheduleStore()[competitionId] || {};
  const eventDate = competition?.event_date || "";
  const categories = competitionScheduleCategories(competition);
  const rows = configRoundEntries().flatMap(([roundKey, round]) =>
    categories.flatMap((category) =>
      ["Mujer", "Hombre"].map((gender) => {
        const value = schedules[scheduleKey(roundKey, category, gender)] || {};
        return `
          <tr data-schedule-row data-round="${roundKey}" data-category="${category}" data-gender="${gender}">
            <td>${round.label}</td>
            <td>${category === "mayor" ? "Mayor" : category}</td>
            <td>${gender}</td>
            <td><input type="date" data-schedule-field="date" value="${value.date || eventDate}" /></td>
            <td><input type="time" data-schedule-field="time" value="${value.time || ""}" /></td>
            <td><button type="button" data-export-start-order>Exportar PDF</button></td>
          </tr>
        `;
      })
    )
  );
  table.innerHTML = rows.join("") || '<tr><td colspan="6">No hay rondas activas.</td></tr>';
  table.querySelectorAll("[data-export-start-order]").forEach((button) => {
    button.addEventListener("click", () => exportStartOrderPdf(button.closest("[data-schedule-row]")));
  });
}

function configRoundEntries() {
  const cards = Array.from($("#configGrid")?.querySelectorAll("[data-round]") || []);
  if (!cards.length) return activeRounds();
  return cards
    .map((card) => {
      const roundKey = card.dataset.round;
      const round = {
        ...(state.rounds[roundKey] || {}),
        active: card.querySelector('[data-config="active"]').checked,
        boulders: Number(card.querySelector('[data-config="boulders"]').value),
        minutes: Number(card.querySelector('[data-config="minutes"]').value),
      };
      return [roundKey, round];
    })
    .filter(([, round]) => round.active);
}

function collectRoundSchedules() {
  const competitionId = scheduleCompetitionKey();
  if (!competitionId) return;
  const store = readRoundScheduleStore();
  store[competitionId] = store[competitionId] || {};
  $("#roundScheduleTable").querySelectorAll("[data-schedule-row]").forEach((row) => {
    store[competitionId][scheduleKey(row.dataset.round, row.dataset.category, row.dataset.gender)] = {
      round: row.dataset.round,
      category: row.dataset.category,
      gender: row.dataset.gender,
      date: row.querySelector('[data-schedule-field="date"]').value,
      time: row.querySelector('[data-schedule-field="time"]').value,
    };
  });
  writeRoundScheduleStore(store);
}

function collectStartOrders() {
  const competitionId = scheduleCompetitionKey();
  if (!competitionId) return;
  const store = readStartOrderStore();
  store[competitionId] = store[competitionId] || {};
  $("#configGrid").querySelectorAll("[data-round]").forEach((card) => {
    const roundKey = card.dataset.round;
    const select = card.querySelector('[data-config="start_order"]');
    store[competitionId][roundKey] = select?.value || (roundKey === "clasificatoria" ? "random" : "previous_reverse");
  });
  writeStartOrderStore(store);
}

function startOrderForRound(roundKey) {
  const competitionId = scheduleCompetitionKey();
  const stored = readStartOrderStore()[competitionId]?.[roundKey];
  if (roundKey !== "clasificatoria") return "previous_reverse";
  return stored || "random";
}

function previousRound(roundKey) {
  if (roundKey === "semifinal") return "clasificatoria";
  if (roundKey === "final") return state.rounds.semifinal?.active ? "semifinal" : "clasificatoria";
  return null;
}

function seededShuffle(rows, seed) {
  let value = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  const next = () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
  return [...rows]
    .map((row) => ({ row, sort: next() }))
    .sort((left, right) => left.sort - right.sort)
    .map((item) => item.row);
}

function addSecondsToDate(dateValue, timeValue, seconds) {
  const start = new Date(`${dateValue}T${timeValue || "00:00"}`);
  return new Date(start.getTime() + seconds * 1000);
}

function formatDateTimeForPdf(date) {
  return date.toLocaleString("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function startOrderRows(roundKey, category, gender) {
  const competitionId = scheduleCompetitionKey();
  const params = new URLSearchParams({ competition_id: competitionId, category, gender });
  let rows = mergeStoredRegistrations(await api(`/api/competition-registrants?${params}`)).filter((row) => row.accredited);
  const order = startOrderForRound(roundKey);
  if (order === "random") {
    rows = seededShuffle(rows, `${competitionId}:${roundKey}:${category}:${gender}`);
  } else if (order === "bib") {
    rows = rows.sort((a, b) => Number(a.bib || a.bib_number || 0) - Number(b.bib || b.bib_number || 0));
  } else if (order === "ranking") {
    rows = rows.sort((a, b) =>
      Number(a.ranking || a.seed_ranking || a.bib || a.bib_number || 0) - Number(b.ranking || b.seed_ranking || b.bib || b.bib_number || 0)
    );
  } else {
    const previous = previousRound(roundKey);
    if (previous) {
      const boardParams = new URLSearchParams({ competition_id: competitionId, round: previous, category, gender });
      const leaderboardRows = await api(`/api/leaderboard?${boardParams}`);
      const orderByBib = new Map([...leaderboardRows].reverse().map((row, index) => [Number(row.bib_number), index]));
      rows = rows.sort((a, b) =>
        (orderByBib.get(Number(a.bib_number)) ?? 9999) - (orderByBib.get(Number(b.bib_number)) ?? 9999)
      );
    }
  }
  return rows;
}

async function exportStartOrderPdf(row) {
  if (!row) return;
  collectRoundSchedules();
  collectStartOrders();
  const roundKey = row.dataset.round;
  const category = row.dataset.category;
  const gender = row.dataset.gender;
  const date = row.querySelector('[data-schedule-field="date"]').value;
  const time = row.querySelector('[data-schedule-field="time"]').value;
  if (!date || !time) {
    $("#configStatus").textContent = "Carga fecha y hora de comienzo antes de exportar.";
    return;
  }
  const competition = currentCompetition();
  const round = state.rounds[roundKey];
  const rows = await startOrderRows(roundKey, category, gender);
  const intervalSeconds = Number(round.minutes || 0) * 60 + TIMER_PREP_SECONDS;
  const titleCategory = category === "mayor" ? "Mayor" : category;
  const bodyRows = rows.map((competitor, index) => {
    const startAt = addSecondsToDate(date, time, intervalSeconds * index);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(competitor.bib || competitor.bib_number || "-")}</td>
        <td>${escapeHtml(competitor.first_name || "")}</td>
        <td>${escapeHtml(competitor.last_name || "")}</td>
        <td>${escapeHtml(competitor.club || "-")}</td>
        <td>${formatDateTimeForPdf(startAt)}</td>
      </tr>
    `;
  }).join("");
  const printWindow = window.open("about:blank", "_blank");
  if (!printWindow) {
    $("#configStatus").textContent = "El navegador bloqueo la ventana de exportacion.";
    return;
  }
  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Orden de salida - ${escapeHtml(competition?.name || "Evento")}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #202124; margin: 32px; }
          h1 { font-size: 22px; margin: 0 0 8px; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; margin: 0 0 24px; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #c9c9c9; padding: 7px 8px; text-align: left; }
          th { background: #f0f0f0; }
          @media print { button { display: none; } body { margin: 18mm; } }
        </style>
      </head>
      <body>
        <h1>Orden de salida</h1>
        <div class="meta">
          <span><strong>Evento:</strong> ${escapeHtml(competition?.name || "-")}</span>
          <span><strong>Ronda:</strong> ${escapeHtml(round?.label || roundKey)}</span>
          <span><strong>Categoria:</strong> ${escapeHtml(titleCategory)}</span>
          <span><strong>Genero:</strong> ${escapeHtml(gender)}</span>
          <span><strong>Comienzo:</strong> ${formatDateTimeForPdf(addSecondsToDate(date, time, 0))}</span>
          <span><strong>Orden:</strong> ${escapeHtml(startOrderLabel(startOrderForRound(roundKey)))}</span>
        </div>
        <table>
          <thead><tr><th>Orden</th><th>Bib</th><th>Nombre</th><th>Apellido</th><th>Club</th><th>Horario de salida</th></tr></thead>
          <tbody>${bodyRows || '<tr><td colspan="6">No hay atletas acreditados.</td></tr>'}</tbody>
        </table>
        <script>window.addEventListener("load", () => setTimeout(() => window.print(), 150));<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
  $("#configStatus").textContent = "Orden de salida generado. Usa Guardar como PDF en la ventana de impresion.";
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
  if (state.judgePeople.length === 0) {
    $("#judgePeopleTable").innerHTML = '<tr><td colspan="7">Todavía no hay jueces asignados desde FASA ID.</td></tr>';
    $("#judgePeopleResultCount").textContent = "0 registros";
    return;
  }
  const query = ($("#judgePeopleSearch")?.value || "").trim().toLowerCase();
  const level = $("#judgePeopleLevelFilter")?.value || "";
  const status = $("#judgePeopleStatusFilter")?.value || "";
  const rows = state.judgePeople.map((person, index) => ({ person, index })).filter(({ person }) => {
    if (query && !personSearchText(person).includes(query)) return false;
    if (level && String(person.level || "") !== level) return false;
    if (status === "active" && person.active === false) return false;
    if (status === "inactive" && person.active !== false) return false;
    return true;
  });
  $("#judgePeopleResultCount").textContent = `${rows.length} de ${state.judgePeople.length} registros`;
  $("#judgePeopleTable").innerHTML = rows.length ? rows.map(({ person, index }) => `
    <tr data-judge-person-row="${index}">
      <td>${person.last_name || "-"}</td>
      <td>${person.first_name || "-"}</td>
      <td>${person.dni || "-"}</td>
      <td>${person.mail || "-"}</td>
      <td>${person.club || "-"}</td>
      <td>${person.level || "-"}</td>
      <td>${person.active !== false ? "Activo" : "Inactivo"}</td>
    </tr>
  `).join("") : '<tr><td colspan="7">No hay jueces que coincidan con los filtros.</td></tr>';
  $("#judgePeopleTable").querySelectorAll("[data-judge-person-row]").forEach((row) => {
    row.addEventListener("click", () => openJudgePersonDetail(Number(row.dataset.judgePersonRow)));
  });
  renderJuryPresidentOptions();
}

function openJudgePersonDetail(index) {
  openOfficialPersonDetail("judge", index);
}

function openOfficialPersonDetail(role, index) {
  const source = role === "route_setter" ? state.routeSetterPeople : state.judgePeople;
  const person = source[index];
  if (!person) return;
  $("#judgePersonModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  $("#judgePersonDetail").dataset.index = String(index);
  $("#judgePersonDetail").dataset.role = role;
  $("#judgePersonDetailTitle").textContent = `${person.last_name || ""}, ${person.first_name || ""}`.trim() || (role === "route_setter" ? "Aperturista" : "Juez");
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
  const role = detail.dataset.role || "judge"; const source = role === "route_setter" ? state.routeSetterPeople : state.judgePeople;
  if (!Number.isInteger(index) || !source[index]) return;
  source[index] = {
    ...source[index],
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

async function saveOfficialPersonDetail() {
  syncJudgePersonDetail(); const detail = $("#judgePersonDetail"); const role = detail.dataset.role || "judge"; const source = role === "route_setter" ? state.routeSetterPeople : state.judgePeople;
  try { await api(role === "route_setter" ? "/api/route-setter-people" : "/api/judge-people", { method: "POST", body: JSON.stringify(role === "route_setter" ? { people: source } : { people: source }) }); $("#officialPersonDetailStatus").textContent = "Cambios guardados."; if (role === "route_setter") await loadRouteSetterPeople(); else await loadJudgePeople(); }
  catch (error) { $("#officialPersonDetailStatus").textContent = error.message; }
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
  const selectedId = String($("#juryPresidentSelect").value || "");
  const selected = eligible.find((person) => String(person.fasa_id || person.id) === selectedId);
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
    fasa_id: form.elements.organizer_fasa_id.value,
    last_name: form.elements.organizer_last_name.value,
    first_name: form.elements.organizer_name.value,
    dni: form.elements.organizer_dni.value,
    username: form.elements.organizer_username.value,
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
      <td><strong>Organizador <span class="required-mark" aria-hidden="true">*</span></strong></td>
      <td>${organizer.last_name || "-"}</td>
      <td>${organizer.first_name || "-"}</td>
      <td>${organizer.dni || "-"}</td>
      <td>${organizer.username || "-"}</td>
      <td>${organizer.club || "-"}</td>
      <td><button id="openOrganizerEditor" type="button">Editar</button></td>
    `
    : '<td><strong>Organizador <span class="required-mark" aria-hidden="true">*</span></strong></td><td colspan="5" id="organizerSummary">Sin seleccionar</td><td><button id="openOrganizerEditor" type="button">Elegir</button></td>';
  row.querySelector("#openOrganizerEditor")?.addEventListener("click", openOrganizerEditor);
}

async function openOrganizerEditor() {
  await openPersonPicker("Elegir organizador", null, (person) => {
    const form = $("#competitionForm");
    form.elements.organizer_fasa_id.value = person.fasa_id || "";
    form.elements.organizer_last_name.value = person.last_name || ""; form.elements.organizer_name.value = person.first_name || "";
    form.elements.organizer_dni.value = person.dni || ""; form.elements.organizer_username.value = person.email || person.mail || "";
    form.elements.organizer_person_club.value = person.club || "";
    $("#organizerRoleRow")?.classList.remove("required-selection-error");
    renderOrganizerSummary();
  });
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
  form.elements.organizer_person_club.value = $('[data-organizer-field="club"]').value.trim();
  closeOrganizerEditor();
  renderOrganizerSummary();
}

function renderJuryPresidentPicker() {
  if (!$("#juryPresidentPickerTable")) return;
  const query = ($("#juryPresidentSearch")?.value || "").toLowerCase();
  const eligible = state.judgePeople.filter((person) => person.active !== false && Number(person.level) >= 2).filter((person) => personSearchText(person).includes(query));
  $("#juryPresidentPickerTable").innerHTML = eligible.length
    ? eligible.map((person) => `
      <tr>
        <td>${person.last_name || "-"}</td>
        <td>${person.first_name || "-"}</td>
        <td>${person.dni || "-"}</td>
        <td>${person.mail || "-"}</td>
        <td>${person.club || "-"}</td>
        <td><button type="button" data-select-jury-president="${person.fasa_id || person.id}">Elegir</button></td>
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

function renderChiefRouteSetterSummary() {
  const container = $("#chiefRouteSetterSummary");
  if (!container) return;
  const selectedId = String($("#chiefRouteSetterSelect").value || "");
  const person = state.routeSetterPeople.find((item) => String(item.fasa_id || item.id) === selectedId);
  container.innerHTML = person
    ? `<tr><td><strong>Jefe de Aperturistas</strong></td><td>${person.last_name || "—"}</td><td>${person.first_name || "—"}</td><td>${person.dni || "—"}</td><td>${person.email || person.mail || "—"}</td><td>${person.club || "—"}</td><td><button id="chooseChiefRouteSetter" type="button">Cambiar</button></td></tr>`
    : '<tr><td><strong>Jefe de Aperturistas</strong></td><td colspan="5">Sin seleccionar</td><td><button id="chooseChiefRouteSetter" type="button">Elegir</button></td></tr>';
  $("#chooseChiefRouteSetter")?.addEventListener("click", chooseChiefRouteSetter);
}

async function chooseChiefRouteSetter() {
  if (!state.routeSetterPeople.length) await loadRouteSetterPeople();
  const eligibleIds = new Set(state.routeSetterPeople.filter((person) => person.active !== false).map((person) => person.fasa_id));
  await openPersonPicker("Elegir Jefe de Aperturistas", (person) => eligibleIds.has(person.fasa_id), (person) => {
    $("#chiefRouteSetterSelect").value = person.fasa_id;
    renderChiefRouteSetterSummary();
  });
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
  $("#regionalRepresentativesTable").innerHTML = REGIONS.map((region) => {
    const person = state.regionalRepresentatives.find((item) => item.region === region && item.active !== false);
    return `<tr><td><strong>${region}</strong></td><td>${person ? `${person.last_name || ""}, ${person.first_name || ""}` : ""}</td><td>${person?.dni || ""}</td><td>${person?.mail || person?.email || ""}</td><td>${person?.club || ""}</td><td>${person ? '<span class="status-badge approved">Activo</span>' : ""}</td><td class="row-actions">${person ? `<button type="button" data-edit-regional="${person.fasa_id}">Modificar</button><button class="delete" type="button" data-remove-regional="${person.fasa_id}">Eliminar</button>` : `<button class="primary" type="button" data-assign-regional="${region}">Asignar</button>`}</td></tr>`;
  }).join("");
  $("#regionalRepresentativesTable").querySelectorAll("[data-assign-regional]").forEach((button) => button.addEventListener("click", () => chooseRegionalRepresentative(button.dataset.assignRegional)));
  $("#regionalRepresentativesTable").querySelectorAll("[data-edit-regional]").forEach((button) => button.addEventListener("click", () => {
    const person = state.regionalRepresentatives.find((item) => item.fasa_id === button.dataset.editRegional);
    if (person) chooseRegionalRepresentative(person.region, person.fasa_id);
  }));
  $("#regionalRepresentativesTable").querySelectorAll("[data-remove-regional]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("¿Eliminar este referente regional? La región quedará sin asignar.")) return;
    await api("/api/regional-representative-remove", { method: "POST", body: JSON.stringify({ fasa_id: button.dataset.removeRegional }) }); await loadRegionalRepresentatives();
  }));
}

async function chooseRegionalRepresentative(region, previousFasaId = "") {
  await openPersonPicker(`Elegir referente · ${region}`, (person) => person.region === region, async (person) => {
    await api("/api/regional-representative-assignment", { method: "POST", body: JSON.stringify({ fasa_id: person.fasa_id, region, previous_fasa_id: previousFasaId }) });
    $("#regionalRepresentativesStatus").textContent = `Referente de ${region} actualizado.`;
    await loadRegionalRepresentatives();
  });
}

function parseJudgeBatch() {
  return $("#judgeBatchInput").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [dni, level] = line.split(/[;,\t ]+/);
    return { dni: String(dni || "").replace(/\D/g, ""), level: Number(level) };
  });
}

function renderJudgeBatchResults(rows = []) {
  $("#judgeBatchResults").innerHTML = rows.length ? rows.map((row) => `
    <div class="batch-result ${row.valid ? "valid" : "invalid"}">
      <strong>${row.dni || "DNI faltante"} · Nivel ${row.level || "—"}</strong>
      <span>${row.valid ? `${row.last_name}, ${row.first_name} · ${row.fasa_id}` : row.message}</span>
    </div>`).join("") : "<p>No hay filas para validar.</p>";
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
  const isAdministrator = state.role === "general_admin" || state.roles.includes("general_admin");
  const scopedCompetitions = state.role === "regional_representative"
    ? state.competitions.filter((competition) => competition.competition_type === "CRED" && (competition.creator_fasa_id ? competition.creator_fasa_id === state.user?.fasa_id : competition.region === state.user?.region))
    : state.competitions;
  const orderedCompetitions = [...scopedCompetitions].sort((a, b) => String(b.event_date || "").localeCompare(String(a.event_date || "")));
  $("#competitionsTable").innerHTML = orderedCompetitions.length ? orderedCompetitions.map((competition) => {
    const president = competition.jury_president || {};
    const organizer = competition.organizer_person || competition.organizer_user || {};
    const chiefRouteSetter = competition.chief_route_setter || {};
    const personName = (person) => person.first_name || person.last_name ? `${person.last_name || ""}, ${person.first_name || ""}`.replace(/^, |, $/, "") : "—";
    const status = competition.status || "approved";
    const statusText = status === "pending" ? "Revisión" : status === "rejected" ? "Rechazado" : "Aprobado";
    const primaryAction = isAdministrator && status !== "approved"
      ? `<button class="primary" data-review-competition="${competition.id}">Revisar</button>`
      : `<button data-edit-competition="${competition.id}">${status === "approved" ? "Editar" : "Ver / editar"}</button>`;
    return `
      <tr class="${status === "pending" ? "pending-event-row" : status === "rejected" ? "rejected-event-row" : ""}">
        <td>${formatEventDateRange(competition)}</td>
        <td>${competition.competition_type}</td>
        <td>${competition.region || "Nacional"}<small class="table-event-location">${competition.city && competition.province ? `${competition.city}, ${competition.province}` : "Ubicación pendiente"}</small></td>
        <td>${competition.modality}</td>
        <td>${competition.category}</td>
        <td>${competition.organizer_club}</td>
        <td><span class="status-badge ${status}">${statusText}</span></td>
        <td>${personName(organizer)}</td>
        <td>${personName(president)}</td>
        <td>${personName(chiefRouteSetter)}</td>
        <td>${competition.infosheet_url ? `<a class="table-infosheet-link" href="${competition.infosheet_url}" download>Ver PDF</a>` : '<span class="hint">No disponible</span>'}</td>
        <td class="row-actions">
          ${primaryAction}
          ${isAdministrator ? `<button class="delete" data-delete-competition="${competition.id}">Eliminar</button>` : ""}
        </td>
      </tr>
    `;
  }).join("") : '<tr><td colspan="12">Todavía no hay eventos creados.</td></tr>';
  $("#competitionsTable").querySelectorAll("[data-review-competition]").forEach((button) => {
    button.addEventListener("click", () => editCompetition(Number(button.dataset.reviewCompetition), { review: true }));
  });
  $("#competitionsTable").querySelectorAll("[data-edit-competition]").forEach((button) => {
    button.addEventListener("click", () => editCompetition(Number(button.dataset.editCompetition)));
  });
  $("#competitionsTable").querySelectorAll("[data-delete-competition]").forEach((button) => {
    button.addEventListener("click", async () => {
      const competition = state.competitions.find((item) => Number(item.id) === Number(button.dataset.deleteCompetition));
      const description = competition ? `“${competitionDisplayName(competition)}” · ${formatEventDateRange(competition)}` : "este evento";
      if (!confirm(`¿Eliminar definitivamente ${description}?`)) return;
      try {
        await api(`/api/competitions/${button.dataset.deleteCompetition}`, { method: "DELETE" });
        if (Number(button.dataset.deleteCompetition) === state.currentCompetitionId) state.currentCompetitionId = null;
        $("#competitionStatus").textContent = "Evento eliminado.";
        await loadCompetitions();
      } catch (error) {
        $("#competitionStatus").textContent = error.message || "No se pudo eliminar el evento.";
      }
    });
  });
}

function formatEventDateRange(competition) {
  const start = String(competition?.event_date || "");
  const end = String(competition?.end_date || start);
  return end && end !== start ? `${start} al ${end}` : start;
}

function competitionDisplayName(competition) {
  const type = competition?.competition_type || "Evento";
  const region = type === "CRED" && competition?.region ? ` ${competition.region}` : "";
  const category = competition?.category ? ` · ${competition.category}` : "";
  return `${type}${region}${category}`;
}

function formatPublicEventDate(value) {
  const date = new Date(`${String(value || "")}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const parts = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.day} ${String(parts.month || "").toUpperCase()} ${parts.year}`;
}

function eventTouchesMonth(competition, month) {
  if (!month) return true;
  const monthStart = `${month}-01`;
  const monthDate = new Date(`${monthStart}T12:00:00Z`);
  const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const start = String(competition.event_date || "");
  const end = String(competition.end_date || start);
  return Boolean(start && start <= monthEnd && end >= monthStart);
}

const EVENT_IDENTITY_LOGOS = {
  caed: { src: "/assets/event-identities/caed.svg", label: "CAED" },
  "cred:buenos aires": { src: "/assets/event-identities/cred-buenos-aires.svg", label: "CRED Buenos Aires" },
  "cred:centro": { src: "/assets/event-identities/cred-centro.svg", label: "CRED Centro" },
  "cred:cuyo": { src: "/assets/event-identities/cred-cuyo.svg", label: "CRED Cuyo" },
  "cred:litoral": { src: "/assets/event-identities/cred-litoral.svg", label: "CRED Litoral" },
  "cred:noa": { src: "/assets/event-identities/cred-noa.svg", label: "CRED NOA" },
  "cred:noroeste": { src: "/assets/event-identities/cred-noa.svg", label: "CRED NOA" },
  "cred:patagonia norte": { src: "/assets/event-identities/cred-patagonia-norte.svg", label: "CRED Patagonia Norte" },
  "cred:patagonia sur": { src: "/assets/event-identities/cred-patagonia-sur.svg", label: "CRED Patagonia Sur" },
};

function normalizeEventIdentityValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getEventIdentityLogo(competition) {
  const type = normalizeEventIdentityValue(competition?.competition_type);
  if (type === "caed") return EVENT_IDENTITY_LOGOS.caed;
  if (type !== "cred") return null;
  return EVENT_IDENTITY_LOGOS[`cred:${normalizeEventIdentityValue(competition?.region)}`] || null;
}

function renderPublicCalendar() {
  if (!$("#publicCompetitionCalendar")) return;
  renderMonthRail();
  const filtered = state.competitions.filter((competition) => competition.status === "approved").filter((competition) => {
    const filters = state.publicCalendarFilters;
    if (filters.category && competition.category !== filters.category) return false;
    if (filters.type && competition.competition_type !== filters.type) return false;
    if (filters.modality && competition.modality !== filters.modality) return false;
    if (filters.region && (competition.region || "") !== filters.region) return false;
    if (filters.month && !eventTouchesMonth(competition, filters.month)) return false;
    return true;
  }).sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
  if (state.competitions.length === 0) {
    $("#publicCompetitionCalendar").innerHTML = '<p class="hint">No hay eventos programados.</p>';
    return;
  }
  if (filtered.length === 0) {
    $("#publicCompetitionCalendar").innerHTML = '<p class="hint">No hay eventos para los filtros seleccionados.</p>';
    return;
  }
  $("#publicCompetitionCalendar").innerHTML = filtered.map((competition) => {
    const identityLogo = getEventIdentityLogo(competition);
    const location = competition.city && competition.province
      ? `${competition.city}, ${competition.province}`
      : "Lugar a confirmar";
    return `
      <article class="calendar-item ${identityLogo ? "has-identity" : ""} ${competition.organizer_logo_url ? "has-club-logo" : ""}" data-public-competition="${competition.id}">
        ${identityLogo ? `<div class="calendar-event-identity"><img class="calendar-identity-logo" src="${identityLogo.src}" alt="${identityLogo.label}" loading="lazy" /></div>` : ""}
        <div class="calendar-event-content">
          <div class="calendar-event-heading">
            <time datetime="${competition.event_date}">${formatPublicEventDate(competition.event_date)}</time>
            <span class="calendar-heading-divider" aria-hidden="true"></span>
            <span class="calendar-discipline">${competition.modality}</span>
          </div>
          <div class="calendar-event-body">
            <div class="calendar-event-summary">
              <h3>${competitionDisplayName(competition)}</h3>
              <span class="calendar-event-type">${competition.organizer_club}</span>
            </div>
            <div class="calendar-event-location">
              <svg class="calendar-location-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-12A7 7 0 1 0 5 9c0 5.9 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>
              <span>${location}</span>
            </div>
          </div>
          <div class="calendar-event-footer">
            ${competition.infosheet_url ? `<a class="calendar-event-link infosheet-link" href="${competition.infosheet_url}" download>Info Sheet</a>` : ""}
            <a class="calendar-event-link registration-link" href="#fasa-id" data-public-registration="${competition.id}">Registro</a>
          </div>
        </div>
        ${competition.organizer_logo_url ? `<img class="calendar-club-logo-right" src="${competition.organizer_logo_url}" alt="Logo de ${competition.organizer_club}" loading="lazy" />` : ""}
      </article>
    `;
  }).join("");
  $("#publicCompetitionCalendar").querySelectorAll("[data-public-competition]").forEach((item) => {
    item.addEventListener("click", () => selectPublicCompetition(Number(item.dataset.publicCompetition)));
  });
  $("#publicCompetitionCalendar").querySelectorAll(".calendar-event-link").forEach((link) => link.addEventListener("click", (event) => event.stopPropagation()));
  $("#publicCompetitionCalendar").querySelectorAll("[data-public-registration]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const competitionId = Number(link.dataset.publicRegistration);
      const competition = state.competitions.find((item) => Number(item.id) === competitionId);
      state.currentCompetitionId = competitionId;
      state.loginCompetitionId = competitionId;
      switchPublicView("accessView");
      $("#loginStatus").textContent = competition ? `Ingresá con tu FASA ID para registrarte en ${competitionDisplayName(competition)}.` : "Ingresá con tu FASA ID para registrarte.";
    });
  });
}

function renderMonthRail() {
  const rail = $("#calendarMonthRail");
  if (!rail) return;
  const formatter = new Intl.DateTimeFormat("es-AR", { month: "long" });
  const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`);
  rail.innerHTML = months.map((month) => {
    const date = new Date(`${month}-02T12:00:00`);
    const enabled = state.competitions.some((competition) => competition.status === "approved" && eventTouchesMonth(competition, month));
    return `<button class="month-button ${state.publicCalendarFilters.month === month ? "active" : ""}" type="button" data-month="${month}" ${enabled ? "" : "disabled"}><strong>${formatter.format(date)}</strong></button>`;
  }).join("");
  $("#calendarYear").classList.toggle("active", !state.publicCalendarFilters.month);
  rail.querySelectorAll("[data-month]").forEach((button) => button.addEventListener("click", () => {
    state.publicCalendarFilters.month = button.dataset.month;
    renderPublicCalendar();
    setCalendarFiltersOpen(false);
  }));
}

function setCalendarFiltersOpen(open) {
  const toggle = $("#calendarFilterToggle");
  document.body.classList.toggle("calendar-filters-open", open);
  toggle?.setAttribute("aria-expanded", String(open));
}

async function selectPublicCompetition(id) {
  const competition = state.competitions.find((item) => Number(item.id) === Number(id));
  if (!competition) return;
  state.currentCompetitionId = id;
  state.loginCompetitionId = null;
  switchPublicView("competitionDetailView");
  $("#competitionPublicHeader").innerHTML = `
    <div class="competition-public-title">
      ${competition.organizer_logo_url ? `<img class="competition-club-logo" src="${competition.organizer_logo_url}" alt="Logo de ${competition.organizer_club}" />` : ""}
      <div><p class="eyebrow">${competition.modality}</p><h2>${competitionDisplayName(competition)}</h2></div>
    </div>
    <div class="competition-meta">
      <span><strong>Fechas</strong>${formatEventDateRange(competition)}</span>
      <span><strong>Disciplina</strong>${competition.modality}</span>
      <span><strong>Región</strong>${competition.region || "Nacional"}</span>
      <span><strong>Ubicación</strong>${competition.city && competition.province ? `${competition.city}, ${competition.province}` : "A confirmar"}</span>
      <span><strong>Organiza</strong>${competition.organizer_club}</span>
    </div>
    ${competition.infosheet_url ? `<a class="button-link infosheet-detail-link" href="${competition.infosheet_url}" download>Descargar Infosheet (PDF)</a>` : ""}
  `;
  const results = $("#competitionPublicResults");
  results.innerHTML = '<p class="hint">Cargando resultados…</p>';
  try {
    const params = new URLSearchParams({ competition_id: id, round: "clasificatoria", category: competition.category === "Juveniles" ? "U17" : "mayor", gender: "Mujer" });
    const rows = await api(`/api/leaderboard?${params}`);
    results.innerHTML = `
      <div class="ranking-head"><span>Puesto</span><span>Atleta</span><span>Club</span><span>Puntaje</span></div>
      ${rows.slice(0, 15).map((row, index) => `<div class="ranking-row result-row"><strong>#${row.rank || index + 1}</strong><span>${row.first_name} ${row.last_name}<small>N.º ${row.bib_number}</small></span><span>${row.club || "-"}</span><strong>${Number(row.total_score || 0).toFixed(1)}</strong></div>`).join("") || '<p class="ranking-empty">Todavía no hay resultados publicados.</p>'}
    `;
  } catch (error) {
    results.innerHTML = '<p class="ranking-empty">Todavía no hay resultados publicados.</p>';
  }
}

function switchPublicView(viewId) {
  document.querySelectorAll(".public-view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll("[data-public-view]").forEach((button) => button.classList.toggle("active", button.dataset.publicView === viewId));
  $("#loginGate").dataset.publicView = viewId;
  if (viewId === "athletesView") renderPublicRankings("argentine");
}

async function renderPublicRankings(type = state.publicRankingFilters.type) {
  const container = $("#publicRankings");
  if (!container) return;
  state.publicRankingFilters.type = type;
  const filters = state.publicRankingFilters;
  $("#rankingRegionField").classList.toggle("hidden", type !== "regional");
  container.innerHTML = '<p class="ranking-empty">Cargando atletas…</p>';
  const params = new URLSearchParams({ type, region: filters.region, category: filters.category, gender: filters.gender, discipline: filters.discipline });
  const rows = await api(`/api/public-athlete-rankings?${params}`);
  const categoryLabel = filters.category === "mayor" ? "Mayor" : filters.category;
  $("#rankingContext").innerHTML = `<strong>${type === "regional" ? filters.region : "Argentina"}</strong><span>${categoryLabel} · ${filters.gender === "Mujer" ? "Mujeres" : "Hombres"} · ${filters.discipline}</span>`;
  container.innerHTML = `
    <div class="ranking-head"><span>Puesto</span><span>Atleta</span><span>Club / Región</span><span>Puntos</span></div>
    ${rows.length ? rows.map((athlete, index) => `<button class="ranking-row" type="button" data-public-athlete="${index}"><strong>#${athlete.rank}</strong><span>${athlete.name}<small>${athlete.category} · ${athlete.discipline}</small></span><span>${athlete.club}<small>${athlete.region}</small></span><strong>${athlete.points}</strong></button>`).join("") : '<p class="ranking-empty">No hay atletas para esta combinación de filtros.</p>'}
  `;
  container.querySelectorAll("[data-public-athlete]").forEach((button) => button.addEventListener("click", () => {
    const athlete = rows[Number(button.dataset.publicAthlete)];
    if (!athlete?.public_profile) return;
    $("#publicAthleteName").textContent = athlete.name;
    $("#publicAthleteCategory").textContent = athlete.category.toUpperCase();
    $("#publicAthleteGender").textContent = athlete.gender;
    $("#publicAthleteClub").textContent = athlete.club || "—";
    $("#publicAthleteRegion").textContent = athlete.region || "—";
    $("#publicAthleteInstagram").innerHTML = `<img src="/assets/instagram-logo-transparent.png" alt="Instagram" /> ${athlete.instagram}`;
    renderPhotoPreview($("#publicAthletePhoto"), athlete.photo_url, `Foto de ${athlete.name}`);
    $("#publicAthleteDialog").showModal();
  }));
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
      <td>${competitionDisplayName(competition)}</td>
      <td>Presidente de Jurado</td>
      <td>-</td><td>-</td><td>-</td>
      <td><button data-enter-official="${competition.competition_id}" data-official-role="competition_admin">Entrar</button></td>
    </tr>
  `).join("");
  const assigned = (data.assignments || []).map((competition) => `
    <tr>
      <td>${competition.event_date}</td>
      <td>${competitionDisplayName(competition)}</td>
      <td>Juez</td>
      <td>B${competition.clasificatoria_boulder} ${competition.clasificatoria_role}</td>
      <td>B${competition.semifinal_boulder} ${competition.semifinal_role}</td>
      <td>B${competition.final_boulder} ${competition.final_role}</td>
      <td><button data-enter-official="${competition.competition_id}" data-official-role="judge">Entrar</button></td>
    </tr>
  `).join("");
  $("#judgePortalCompetitions").innerHTML = administered + assigned || '<tr><td colspan="7">No tenés eventos asignados.</td></tr>';
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
  renderPhotoPreview($("#competitorPhotoPreview"), competitor.photo_url, "Foto del atleta");
  $("#athleteCardName").textContent = `${competitor.first_name || "Nombre"} ${competitor.last_name || "Apellido"}`;
  $("#athleteCardClub").textContent = competitor.club || "Club —";
  $("#athleteCardCategory").textContent = String(competitor.category || "Mayor").toUpperCase();
  $("#athleteCardGender").textContent = competitor.gender || "—";
  const baseRank = Number(competitor.rank || competitor.ranking || competitor.id || 0);
  $("#athleteRegionalRank").textContent = baseRank ? `#${Math.max(1, (baseRank * 3) % 17)}` : "Sin ranking";
  $("#athleteNationalRank").textContent = baseRank ? `#${Math.max(1, (baseRank * 7) % 43)}` : "Sin ranking";
  const registered = new Set((data.registrations || []).map((row) => Number(row.competition_id)));
  $("#competitorCompetitionTable").innerHTML = state.competitions.map((competition) => {
  const genderOk = true;
    const ageOk = eventYearCategoryAllowed(competitor, competition);
    const isRegistered = registered.has(Number(competition.id));
    const status = isRegistered ? "Inscripto" : (genderOk && ageOk ? "Disponible" : "No habilitada");
    return `
      <tr>
        <td>${competition.event_date}</td>
        <td>${competitionDisplayName(competition)}</td>
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
  $("#competitionForm").querySelectorAll(".field-error").forEach((field) => field.classList.remove("field-error"));
  $("#organizerRoleRow")?.classList.remove("required-selection-error");
  $("#competitionForm").elements.end_date.min = "";
  $("#competitionForm").elements.id.value = "";
  $("#competitionForm").elements.organizer_fasa_id.value = "";
  $("#competitionForm").elements.jury_president_fasa_id.value = "";
  $("#competitionForm").elements.chief_route_setter_fasa_id.value = "";
  $("#competitionForm").elements.organizer_last_name.value = "";
  $("#competitionForm").elements.organizer_name.value = "";
  $("#competitionForm").elements.organizer_dni.value = "";
  $("#competitionForm").elements.organizer_username.value = "";
  $("#competitionForm").elements.organizer_person_club.value = "";
  state.reviewCompetitionInternalId = null;
  $("#competitionEditorTitle").textContent = "Crear evento";
  $("#saveCompetitionButton").textContent = "Crear evento";
  $("#saveCompetitionButton").hidden = false;
  $("#reviewApproveCompetition").hidden = true;
  $("#reviewRejectCompetition").hidden = true;
  $("#organizerLogoCurrent").textContent = "Podés adjuntar una imagen PNG, JPG o WebP de hasta 5 MB.";
  $("#organizerLogoPreview").hidden = true;
  $("#organizerLogoPreview").removeAttribute("src");
  $("#infosheetCurrent").textContent = "Opcional. Podés adjuntar un PDF de hasta 15 MB; será público desde el calendario.";
  $("#competitionStatus").textContent = "";
  applyCompetitionFormRole();
  renderJuryPresidentOptions();
  renderChiefRouteSetterSummary();
  $("#competitionType").dispatchEvent(new Event("change"));
}

function openCompetitionEditor() {
  $("#competitionEditorModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeCompetitionEditor() {
  $("#competitionEditorModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  resetCompetitionForm();
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

function editCompetition(id, { review = false } = {}) {
  const competition = state.competitions.find((item) => Number(item.id) === Number(id));
  if (!competition) return;
  const form = $("#competitionForm");
  form.elements.id.value = competition.id;
  form.elements.event_date.value = competition.event_date;
  form.elements.end_date.value = competition.end_date || competition.event_date;
  form.elements.end_date.min = competition.event_date;
  form.elements.competition_type.value = competition.competition_type;
  form.elements.region.value = competition.region || "Buenos Aires";
  form.elements.province.value = competition.province || "";
  form.elements.city.value = competition.city || "";
  form.elements.modality.value = competition.modality;
  form.elements.category.value = competition.category;
  form.elements.organizer_club.value = competition.organizer_club;
  $("#organizerLogoCurrent").textContent = competition.organizer_logo_url
    ? `Logo actual: ${competition.organizer_logo_filename || "imagen del club"}. Elegí otra imagen para reemplazarlo.`
    : "Este evento todavía no tiene un logo del club. Podés adjuntar una imagen de hasta 5 MB.";
  $("#organizerLogoPreview").hidden = !competition.organizer_logo_url;
  if (competition.organizer_logo_url) $("#organizerLogoPreview").src = competition.organizer_logo_url;
  $("#infosheetCurrent").innerHTML = competition.infosheet_url
    ? `Infosheet actual: <a href="${competition.infosheet_url}" download>${competition.infosheet_filename || "Descargar PDF"}</a>. Elegí otro archivo para reemplazarlo.`
    : "Este evento todavía no tiene un Infosheet. Podés adjuntar un PDF de hasta 15 MB.";
  const organizer = competition.organizer_person || competition.organizer_user || {};
  form.elements.organizer_fasa_id.value = competition.organizer_fasa_id || organizer.fasa_id || "";
  form.elements.organizer_last_name.value = organizer.last_name || "";
  form.elements.organizer_name.value = organizer.first_name || organizer.display_name || "";
  form.elements.organizer_dni.value = organizer.dni || "";
  form.elements.organizer_username.value = organizer.email || organizer.username || "";
  form.elements.organizer_person_club.value = organizer.club || "";
  form.elements.jury_president_fasa_id.value = competition.jury_president_fasa_id || competition.jury_president?.fasa_id || competition.jury_president_id || "";
  form.elements.chief_route_setter_fasa_id.value = competition.chief_route_setter_fasa_id || competition.chief_route_setter?.fasa_id || "";
  applyCompetitionFormRole();
  renderJuryPresidentOptions();
  renderChiefRouteSetterSummary();
  $("#saveCompetitionButton").textContent = "Guardar cambios";
  $("#competitionEditorTitle").textContent = review ? "Revisar evento" : "Editar evento";
  state.reviewCompetitionInternalId = review ? Number(competition.internal_event_id) : null;
  $("#reviewApproveCompetition").hidden = !review;
  $("#reviewRejectCompetition").hidden = !review;
  $("#saveCompetitionButton").hidden = review;
  $("#competitionStatus").textContent = review ? "Revisá toda la información del evento antes de aprobarlo o rechazarlo." : competition.status === "pending" ? "Este evento está pendiente de aprobación. Podés verlo y editarlo." : competition.status === "rejected" ? "Este evento fue rechazado. Editalo y volvé a enviarlo para una nueva revisión." : "Editando evento aprobado.";
  $("#competitionType").dispatchEvent(new Event("change"));
  openCompetitionEditor();
}

function collectJudges() {
  return Array.from($("#judgesGrid").querySelectorAll("[data-judge-index]")).map((card) => ({
    judge_person_id: Number(card.querySelector('[data-judge-field="judge_person_id"]').value),
    judge_fasa_id: judgePersonById(Number(card.querySelector('[data-judge-field="judge_person_id"]').value))?.fasa_id || "",
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
      if (!confirm("¿Eliminar atleta y sus puntajes?")) return;
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
    : "Seleccioná un atleta";
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
  renderJuryPresidentOptions();
}

async function loadRegionalRepresentatives() {
  [state.regionalRepresentatives, state.fasaProfiles] = await Promise.all([api("/api/regional-representatives"), api("/api/fasa-profiles")]);
  renderRegionalRepresentatives();
}

async function loadRouteSetterPeople() {
  state.routeSetterPeople = await api("/api/route-setter-people");
  renderRouteSetterPeople();
  renderChiefRouteSetterSummary();
}

function renderRouteSetterPeople() {
  if (!$("#routeSetterPeopleTable")) return;
  const query = ($("#routeSetterPeopleSearch")?.value || "").trim().toLowerCase();
  const level = $("#routeSetterPeopleLevelFilter")?.value || "";
  const status = $("#routeSetterPeopleStatusFilter")?.value || "";
  const rows = state.routeSetterPeople.map((person, index) => ({ person, index })).filter(({ person }) => {
    if (query && !personSearchText(person).includes(query)) return false;
    if (level && String(person.level || "") !== level) return false;
    if (status === "active" && person.active === false) return false;
    if (status === "inactive" && person.active !== false) return false;
    return true;
  });
  $("#routeSetterPeopleResultCount").textContent = `${rows.length} de ${state.routeSetterPeople.length} registros`;
  $("#routeSetterPeopleTable").innerHTML = rows.length ? rows.map(({ person, index }) => `<tr data-route-setter-row="${index}"><td>${person.last_name || "—"}</td><td>${person.first_name || "—"}</td><td>${person.dni || "—"}</td><td>${person.mail || person.email || "—"}</td><td>${person.club || "—"}</td><td>${person.level || "—"}</td><td>${person.active !== false ? "Activo" : "Inactivo"}</td></tr>`).join("") : `<tr><td colspan="7">${state.routeSetterPeople.length ? "No hay aperturistas que coincidan con los filtros." : "Todavía no hay aperturistas asignados."}</td></tr>`;
  $("#routeSetterPeopleTable").querySelectorAll("[data-route-setter-row]").forEach((row) => row.addEventListener("click", () => openRouteSetterDetail(Number(row.dataset.routeSetterRow))));
}

function openRouteSetterDetail(index) {
  const person = state.routeSetterPeople[index]; if (!person) return;
  const dialog = $("#routeSetterDetailDialog"); dialog.dataset.index = String(index); $("#routeSetterDetailTitle").textContent = `${person.last_name}, ${person.first_name}`;
  dialog.querySelectorAll("[data-route-setter-detail]").forEach((field) => { const key = field.dataset.routeSetterDetail; if (field.type === "checkbox") field.checked = person[key] !== false; else field.value = person[key] || ""; });
  renderPhotoPreview($("#routeSetterPhotoPreview"), person.photo_url || "", `Foto de ${person.first_name} ${person.last_name}`);
  $("#routeSetterDetailStatus").textContent = ""; dialog.showModal();
}

async function saveRouteSetterDetail() {
  const dialog = $("#routeSetterDetailDialog"); const index = Number(dialog.dataset.index); const person = state.routeSetterPeople[index]; if (!person) return;
  const level = Number(dialog.querySelector('[data-route-setter-detail="level"]').value); const active = dialog.querySelector('[data-route-setter-detail="active"]').checked;
  const photoUrl = dialog.querySelector('[data-route-setter-detail="photo_url"]').value;
  state.routeSetterPeople[index] = { ...person, level, active };
  try { await Promise.all([api("/api/update-role-detail", { method: "POST", body: JSON.stringify({ fasa_id: person.fasa_id, role: "route_setter", level, active }) }), api("/api/profile-photo", { method: "POST", body: JSON.stringify({ fasa_id: person.fasa_id, photo_url: photoUrl }) })]); $("#routeSetterDetailStatus").textContent = "Cambios guardados."; await loadRouteSetterPeople(); setTimeout(() => dialog.close(), 350); }
  catch (error) { $("#routeSetterDetailStatus").textContent = error.message; }
}

async function populateCompetitionRolePickers() {
  if (!state.fasaProfiles.length) state.fasaProfiles = await api("/api/fasa-profiles");
  $("#organizerFasaPicker").innerHTML = '<option value="">Seleccionar una persona</option>' + state.fasaProfiles.map((person) => `<option value="${person.fasa_id}">${person.last_name}, ${person.first_name} · DNI ${person.dni}</option>`).join("");
}

async function loadRouteSetterTeam() {
  const data = await api(`/api/competition-route-setters?competition_id=${state.currentCompetitionId || 1}`);
  const assigned = new Set(data.assigned.filter((item) => item.role_type === "route_setter").map((item) => item.fasa_id));
  $("#routeSetterTeamList").innerHTML = data.people.map((person) => `<label><input type="checkbox" value="${person.fasa_id}" ${assigned.has(person.fasa_id) ? "checked" : ""} /> <strong>${person.last_name}, ${person.first_name}</strong><span>DNI ${person.dni} · Nivel ${person.level}</span></label>`).join("") || "<p>No hay aperturistas habilitados.</p>";
}

async function loadFasaCv() {
  if (!state.user?.fasa_id) { $("#fasaCvHistory").innerHTML = "<p>El perfil de demostración todavía no tiene un historial asociado.</p>"; return; }
  const cv = await api(`/api/fasa-cv?fasa_id=${encodeURIComponent(state.user.fasa_id)}`);
  $("#fasaCvRoles").innerHTML = cv.roles.map((role) => { const level = cv.role_details?.[role]?.level; return `<span>${ROLE_LABELS[role] || role}${level ? ` · Nivel ${level}` : ""}</span>`; }).join("");
  $("#fasaCvHistory").innerHTML = cv.history.length ? cv.history.map((item) => `<article><time>${item.competition?.event_date || ""}</time><div><strong>${item.competition?.name || "Evento FASA"}</strong><span>${item.role_label}</span></div></article>`).join("") : "<p>Todavía no hay participaciones registradas.</p>";
}

async function loadFasaManagement() {
  state.fasaProfiles = await api("/api/fasa-profiles");
  renderFasaManagementTable();
}

function personSearchText(person) { return [person.first_name, person.last_name, person.dni, person.email, person.mail, person.club, person.region].filter(Boolean).join(" ").toLowerCase(); }
function renderFasaManagementTable() {
  const query = ($("#fasaManagementSearch")?.value || "").trim().toLowerCase();
  const region = $("#fasaManagementRegionFilter")?.value || "";
  const role = $("#fasaManagementRoleFilter")?.value || "";
  const rows = state.fasaProfiles.filter((person) => {
    const roles = String(person.roles || "").split(",").filter(Boolean);
    if (query && !personSearchText(person).includes(query)) return false;
    if (region && person.region !== region) return false;
    if (role === "none" && roles.length) return false;
    if (role && role !== "none" && !roles.includes(role)) return false;
    return true;
  });
  $("#fasaManagementResultCount").textContent = `${rows.length} de ${state.fasaProfiles.length} registros`;
  $("#fasaManagementTable").innerHTML = rows.length ? rows.map((person) => `<tr data-managed-fasa-id="${person.fasa_id}"><td>${person.last_name}, ${person.first_name}</td><td>${person.dni}</td><td>${person.email}</td><td>${person.club || "—"}</td><td>${person.region || "—"}</td><td>${String(person.roles || "").split(",").filter(Boolean).map((role) => ROLE_LABELS[role] || role).join(" · ") || "Sin roles"}</td></tr>`).join("") : '<tr><td colspan="6">No hay FASA ID que coincidan con los filtros.</td></tr>';
  $("#fasaManagementTable").querySelectorAll("[data-managed-fasa-id]").forEach((row) => row.addEventListener("click", () => openManagedProfile(row.dataset.managedFasaId)));
}

function openManagedProfile(fasaId) {
  const person = state.fasaProfiles.find((item) => item.fasa_id === fasaId); if (!person) return;
  $("#managedProfileDialog").dataset.fasaId = fasaId; $("#managedProfileTitle").textContent = `${person.last_name}, ${person.first_name}`;
  document.querySelectorAll("[data-managed-profile]").forEach((field) => { field.value = person[field.dataset.managedProfile] || ""; });
  renderPhotoPreview($("#managedProfilePhotoPreview"), person.photo_url || "", `Foto de ${person.first_name} ${person.last_name}`);
  $("#managedProfileStatus").textContent = ""; $("#managedProfileDialog").showModal();
}

async function saveManagedProfile() {
  const fasaId = $("#managedProfileDialog").dataset.fasaId; const original = state.fasaProfiles.find((item) => item.fasa_id === fasaId); if (!original) return;
  const profile = { fasa_id: fasaId }; document.querySelectorAll("[data-managed-profile]").forEach((field) => { profile[field.dataset.managedProfile] = field.value.trim(); });
  try { await api("/api/admin-profile-update", { method: "POST", body: JSON.stringify({ profile }) }); $("#managedProfileStatus").textContent = "Datos actualizados."; await loadFasaManagement(); }
  catch (error) { $("#managedProfileStatus").textContent = error.message; }
}

function renderPersonPicker() {
  const query = ($("#personPickerSearch").value || "").toLowerCase(); const filter = personPickerAction?.filter;
  const people = state.fasaProfiles.filter((person) => !filter || filter(person)).filter((person) => personSearchText(person).includes(query));
  $("#personPickerTable").innerHTML = people.map((person) => `<tr><td>${person.last_name}, ${person.first_name}</td><td>${person.dni}</td><td>${person.email || person.mail || "—"}</td><td>${person.club || "—"}</td><td><button type="button" data-pick-person="${person.fasa_id}">Elegir</button></td></tr>`).join("") || '<tr><td colspan="5">No se encontraron personas.</td></tr>';
  $("#personPickerTable").querySelectorAll("[data-pick-person]").forEach((button) => button.addEventListener("click", async () => { const person = state.fasaProfiles.find((item) => item.fasa_id === button.dataset.pickPerson); await personPickerAction?.onSelect(person); $("#personPickerDialog").close(); }));
}
async function openPersonPicker(title, filter, onSelect) {
  if (!state.fasaProfiles.length) state.fasaProfiles = await api("/api/fasa-profiles");
  personPickerAction = { filter, onSelect }; $("#personPickerTitle").textContent = title; $("#personPickerSearch").value = ""; renderPersonPicker(); $("#personPickerDialog").showModal();
}

function renderRoleAssignmentTable() {
  const query = ($("#roleAssignmentSearch").value || "").toLowerCase();
  const people = state.fasaProfiles.filter((person) => personSearchText(person).includes(query));
  $("#roleAssignmentTable").innerHTML = people.map((person) => `<tr><td>${person.last_name}, ${person.first_name}</td><td>${person.dni}</td><td>${person.email || "—"}</td><td>${person.club || "—"}</td><td><button type="button" data-role-person="${person.fasa_id}">Elegir</button></td></tr>`).join("");
  $("#roleAssignmentTable").querySelectorAll("[data-role-person]").forEach((button) => button.addEventListener("click", () => { $("#roleAssignmentPerson").value = button.dataset.rolePerson; $("#roleAssignmentTable").querySelectorAll("tr").forEach((row) => row.classList.remove("selected-row")); button.closest("tr").classList.add("selected-row"); }));
}

async function loadAdministratorManagement() {
  const administrators = await api("/api/administrators");
  $("#administratorManagementTable").innerHTML = administrators.map((person) => `<tr><td>${person.last_name}, ${person.first_name}</td><td>${person.dni}</td><td>${person.email || person.mail}</td><td>${person.active !== false ? "Activo" : "Inactivo"}</td><td><button data-disable-administrator="${person.fasa_id}">Desactivar</button></td></tr>`).join("");
  $("#administratorManagementTable").querySelectorAll("[data-disable-administrator]").forEach((button) => button.addEventListener("click", async () => { try { await api("/api/administrator-status", { method: "POST", body: JSON.stringify({ fasa_id: button.dataset.disableAdministrator, active: false }) }); await loadAdministratorManagement(); } catch (error) { $("#administratorManagementStatus").textContent = error.message; } }));
}

async function openRoleAssignment(role) {
  if (!state.fasaProfiles.length) state.fasaProfiles = await api("/api/fasa-profiles");
  $("#roleAssignmentDialog").dataset.role = role;
  $("#roleAssignmentTitle").textContent = `Asignar ${ROLE_LABELS[role] || role}`;
  $("#roleAssignmentPerson").value = ""; $("#roleAssignmentSearch").value = ""; renderRoleAssignmentTable();
  $("#roleAssignmentLevelField").hidden = !["judge","route_setter"].includes(role);
  $("#roleAssignmentStatus").textContent = "";
  $("#roleAssignmentDialog").showModal();
}

async function loadCompetitions() {
  state.competitions = await api("/api/competitions");
  renderCompetitions();
  renderPublicCalendar();
  renderAssignedRoles();
}

async function loadCompetitors() {
  applyCompetitorCategoryRules(currentCompetition());
  const params = new URLSearchParams({
    ...state.competitorFilters,
    competition_id: state.currentCompetitionId || state.user?.competition_id || "",
  });
  state.competitors = await api(`/api/competitors?${params}`);
  renderCompetitors();
}

function applyCompetitorCategoryRules(competition) {
  const categoryControls = ["#competitorFilterCategory", "#judgeCompetitorFilterCategory"]
    .map((selector) => $(selector))
    .filter(Boolean);
  if (!competition) return;
  if (competition.category === "Mayores") {
    state.competitorFilters.category = "mayor";
    categoryControls.forEach((control) => {
      control.value = "mayor";
      control.disabled = true;
    });
    return;
  }
  categoryControls.forEach((control) => {
    control.disabled = false;
  });
  if (competition.category === "Juveniles" && state.competitorFilters.category === "mayor") {
    state.competitorFilters.category = "U17";
    categoryControls.forEach((control) => {
      control.value = "U17";
    });
  }
}

async function loadRegistrations() {
  const competitionId = state.currentCompetitionId || state.user?.competition_id;
  if (!competitionId) {
    $("#registrationsTitle").textContent = "Inscriptos";
    $("#registrationsTable").innerHTML = '<tr><td colspan="14">Seleccioná un evento.</td></tr>';
    renderRegistrationActions();
    return;
  }
  state.currentCompetitionId = Number(competitionId);
  const competition = currentCompetition();
  applyRegistrationCategoryRules(competition);
  $("#registrationsTitle").textContent = competition ? `Inscriptos - ${competitionDisplayName(competition)}` : "Inscriptos";
  const params = new URLSearchParams({ competition_id: state.currentCompetitionId, ...state.registrationFilters });
  state.registrations = mergeStoredRegistrations(await api(`/api/competition-registrants?${params}`));
  const closed = registrationsClosed();
  const writable = canManageRegistrations() && !closed;
  $("#registrationsTable").innerHTML = state.registrations.length
    ? state.registrations.map((row) => `
      <tr data-registration-id="${row.registration_id}" data-registration-key="${row._registration_key}">
        <td>${row.bib || "-"}</td>
        <td>${row.bib_number}</td>
        <td>${row.last_name}, ${row.first_name}</td>
        <td>${row.dni}</td>
        <td>${row.email || "-"}</td>
        <td>${row.phone || "-"}</td>
        <td>${row.club || "-"}</td>
        <td>${row.region || "-"}</td>
        <td>${row.category}</td>
        <td>${row.gender}</td>
        <td><input type="checkbox" data-registration-field="payment_validated" ${row.payment_validated ? "checked" : ""} ${writable ? "" : "disabled"} /></td>
        <td><input type="checkbox" data-registration-field="accredited" ${row.accredited ? "checked" : ""} ${writable && row.payment_validated ? "" : "disabled"} /></td>
        <td>${row.registered_at || "-"}</td>
        <td>${writable ? '<button class="delete" data-delete-registration>Eliminar</button>' : ""}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="14">No hay inscriptos para los filtros seleccionados.</td></tr>';
  $("#registrationsTable").querySelectorAll("[data-registration-field]").forEach((control) => {
    control.addEventListener("change", () => saveRegistrationStatus(control.closest("[data-registration-id]")));
  });
  $("#registrationsTable").querySelectorAll("[data-delete-registration]").forEach((button) => {
    button.addEventListener("click", () => deleteRegistration(button.closest("[data-registration-id]")));
  });
  renderRegistrationActions();
}

function renderRegistrationActions() {
  const closed = registrationsClosed();
  const writable = canManageRegistrations();
  const closeButton = $("#closeAccreditations");
  const assignButton = $("#assignRandomBibs");
  const status = $("#registrationsStatus");
  if (!closeButton || !assignButton || !status) return;
  closeButton.hidden = !writable;
  assignButton.hidden = !writable;
  closeButton.disabled = !writable || closed || !registrationCompetitionKey();
  assignButton.disabled = !writable || !closed || !registrationCompetitionKey();
  closeButton.textContent = closed ? "Acreditaciones cerradas" : "Cerrar acreditaciones";
  status.textContent = closed
    ? "Acreditaciones cerradas. Ya se puede asignar Bib aleatorio a los acreditados del filtro actual."
    : "Las acreditaciones siguen abiertas. El Bib se habilita despues del cierre.";
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
    $("#registrationsTable").innerHTML = '<tr><td colspan="14">No hay inscriptos para los filtros seleccionados.</td></tr>';
  }
}

function closeAccreditations() {
  if (!canManageRegistrations() || !registrationCompetitionKey()) return;
  if (!confirm("¿Cerrar acreditaciones para este evento? Después no se podrán modificar pagos ni acreditaciones.")) return;
  const store = readRegistrationStore();
  store.closed = store.closed || {};
  store.closed[registrationCompetitionKey()] = true;
  writeRegistrationStore(store);
  renderRegistrationActions();
  loadRegistrations();
}

function shuffledRows(rows) {
  return [...rows]
    .map((row) => ({ row, sort: Math.random() }))
    .sort((left, right) => left.sort - right.sort)
    .map((item) => item.row);
}

function assignRandomBibs() {
  if (!canManageRegistrations() || !registrationsClosed()) return;
  const rows = state.registrations.filter((row) => row.accredited && !row.bib);
  if (!rows.length) {
    $("#registrationsStatus").textContent = "No hay acreditados sin Bib para el filtro seleccionado.";
    return;
  }
  const store = readRegistrationStore();
  store.bibs = store.bibs || {};
  const competitionPrefix = `${registrationCompetitionKey()}:`;
  const used = Object.entries(store.bibs)
    .filter(([key]) => key.startsWith(competitionPrefix))
    .map(([, value]) => Number(value))
    .filter(Boolean);
  let nextBib = used.length ? Math.max(...used) + 1 : 1;
  shuffledRows(rows).forEach((row) => {
    store.bibs[row._registration_key] = nextBib;
    nextBib += 1;
  });
  writeRegistrationStore(store);
  $("#registrationsStatus").textContent = `Bibs asignados a ${rows.length} acreditados.`;
  loadRegistrations();
}

function boulderAttemptTooltip(row, index) {
  const detail = row.boulder_details?.[index] || {};
  return `z: ${detail.zone_attempt || "-"}, t: ${detail.top_attempt || "-"}`;
}

async function loadLeaderboard() {
  applyResultsCategoryRules(currentCompetition());
  const round = $("#resultsRound").value || activeRounds()[0]?.[0] || "clasificatoria";
  const category = $("#resultsCategory").value;
  const gender = $("#resultsGender").value;
  const params = new URLSearchParams({ round, category, gender, competition_id: state.currentCompetitionId || state.user?.competition_id || 1 });
  const rows = await api(`/api/leaderboard?${params}`);
  const orderedCompetitors = await startOrderRows(round, category, gender);
  const orderMap = new Map(orderedCompetitors.map((row, index) => [Number(row.bib_number), index + 1]));
  const timer = computedLocalTimer();
  const boulderCount = state.rounds[round]?.boulders || 1;
  $("#leaderboardHead").innerHTML = `
    <tr>
      <th>Puesto</th><th>Nro.</th><th>Atleta</th><th>Club</th>
      ${Array.from({ length: boulderCount }, (_, index) => `<th>B${index + 1}</th>`).join("")}
      <th>Total</th>
    </tr>
  `;
  $("#leaderboardBody").innerHTML = rows.map((row) => `
    <tr data-results-row data-order="${orderMap.get(Number(row.bib_number)) || 0}">
      <td>${row.rank}</td>
      <td>${row.bib_number}</td>
      <td>${row.last_name}, ${row.first_name}</td>
      <td>${row.club || "-"}</td>
      ${row.boulders.map((value, index) => `
        <td title="${boulderAttemptTooltip(row, index)}">
          <span class="score-cell" title="${boulderAttemptTooltip(row, index)}">
            <span class="active-light ${activeBoulderForOrder(orderMap.get(Number(row.bib_number)) || 0, index, timer, gender, round) ? "on" : ""}" data-boulder-index="${index}" aria-hidden="true"></span>
            ${Number(value).toFixed(1)}
          </span>
        </td>
      `).join("")}
      <td><strong>${Number(row.total_score).toFixed(1)}</strong></td>
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

function applyComputosCategoryRules(competition) {
  const categoryControl = $("#computosCategory");
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

function updateComputosRoundOptions() {
  const select = $("#computosRound");
  if (!select) return;
  const current = select.value || "clasificatoria";
  const category = $("#computosCategory")?.value || "mayor";
  const gender = $("#computosGender")?.value || "Mujer";
  select.innerHTML = activeRounds().map(([key, round]) => {
    const disabled = canOpenRound(key, category, gender) ? "" : "disabled";
    return `<option value="${key}" ${key === current ? "selected" : ""} ${disabled}>${round.label}</option>`;
  }).join("");
  if (select.selectedOptions[0]?.disabled) {
    const firstOpen = Array.from(select.options).find((option) => !option.disabled);
    if (firstOpen) select.value = firstOpen.value;
  }
}

function activeBoulderForOrder(orderIndex, boulderIndex, timer, gender, round) {
  if (!timer || timer.phase !== "climb") return false;
  if (timer.round !== round) return false;
  if (!(timer.genders || ["Mujer", "Hombre"]).includes(gender)) return false;
  return Number(timer.cycle || 1) === orderIndex + 2 * boulderIndex;
}

async function loadScores() {
  applyComputosCategoryRules(currentCompetition());
  updateComputosRoundOptions();
  const round = $("#computosRound").value || activeRounds()[0]?.[0] || "clasificatoria";
  const category = $("#computosCategory").value || "mayor";
  const gender = $("#computosGender").value || "Mujer";
  if (!canOpenRound(round, category, gender)) {
    $("#scoresHead").innerHTML = "";
    $("#scoresTable").innerHTML = '<tr><td>La ronda previa todavia no fue cerrada para esta categoria y genero.</td></tr>';
    $("#computosStatus").textContent = "No se puede abrir esta ronda hasta tener resultados definitivos de la ronda previa.";
    return;
  }
  const params = new URLSearchParams({ round, category, gender, competition_id: state.currentCompetitionId || state.user?.competition_id || 1 });
  const leaderboardRows = await api(`/api/leaderboard?${params}`);
  const orderedCompetitors = await startOrderRows(round, category, gender);
  const orderMap = new Map(orderedCompetitors.map((row, index) => [Number(row.bib_number), index]));
  const leaderboardByBib = new Map(leaderboardRows.map((row) => [Number(row.bib_number), row]));
  const rows = orderedCompetitors.map((competitor) => ({
    ...competitor,
    ...(leaderboardByBib.get(Number(competitor.bib_number)) || {}),
    boulders: leaderboardByBib.get(Number(competitor.bib_number))?.boulders || Array.from({ length: state.rounds[round]?.boulders || 1 }, () => 0),
    total_score: leaderboardByBib.get(Number(competitor.bib_number))?.total_score || 0,
    tops: leaderboardByBib.get(Number(competitor.bib_number))?.tops || 0,
    zones: leaderboardByBib.get(Number(competitor.bib_number))?.zones || 0,
    attempts: leaderboardByBib.get(Number(competitor.bib_number))?.attempts || 0,
  }));
  const timer = computedLocalTimer();
  const readonly = state.role === "general_admin";
  const boulderCount = state.rounds[round]?.boulders || 1;
  $("#scoresHead").innerHTML = `
    <tr>
      <th>Orden</th><th>Bib</th><th>Nro.</th><th>Atleta</th><th>Club</th>
      ${Array.from({ length: boulderCount }, (_, index) => `<th>B${index + 1}</th>`).join("")}
      <th>Total</th><th>Tops</th><th>Zonas</th><th>Intentos</th>
    </tr>
  `;
  $("#scoresTable").innerHTML = rows.map((row) => `
    <tr data-computos-row data-order="${orderMap.get(Number(row.bib_number)) + 1}">
      <td>${orderMap.has(Number(row.bib_number)) ? orderMap.get(Number(row.bib_number)) + 1 : "-"}</td>
      <td>${orderedCompetitors.find((item) => Number(item.bib_number) === Number(row.bib_number))?.bib || "-"}</td>
      <td>${row.bib_number}</td>
      <td>${row.last_name}, ${row.first_name}</td>
      <td>${row.club || "-"}</td>
      ${row.boulders.map((value, index) => `
        <td>
          <span class="score-cell">
            <span class="active-light ${activeBoulderForOrder(orderMap.get(Number(row.bib_number)) + 1, index, timer, gender, round) ? "on" : ""}" data-boulder-index="${index}" aria-hidden="true"></span>
            ${Number(value).toFixed(1)}
          </span>
        </td>
      `).join("")}
      <td><strong>${Number(row.total_score).toFixed(1)}</strong></td>
      <td>${row.tops}</td>
      <td>${row.zones}</td>
      <td>${row.attempts}</td>
    </tr>
  `).join("");
  $("#computosStatus").textContent = roundClosed(round, category, gender)
    ? "Ronda cerrada para esta categoria y genero."
    : "Ronda abierta. Al cerrarla se habilita la ronda siguiente.";
  $("#closeComputosRound").disabled = readonly || roundClosed(round, category, gender);
}

function refreshComputosActiveLights() {
  refreshActiveLights("#scoresTable", "[data-computos-row]", "#computosRound", "#computosGender");
  refreshActiveLights("#leaderboardBody", "[data-results-row]", "#resultsRound", "#resultsGender");
}

function refreshActiveLights(tableSelector, rowSelector, roundSelector, genderSelector) {
  const table = $(tableSelector);
  if (!table) return;
  const timer = computedLocalTimer();
  const round = $(roundSelector)?.value || "clasificatoria";
  const gender = $(genderSelector)?.value || "Mujer";
  table.querySelectorAll(rowSelector).forEach((row) => {
    const order = Number(row.dataset.order || 0);
    row.querySelectorAll("[data-boulder-index]").forEach((light) => {
      light.classList.toggle("on", activeBoulderForOrder(order, Number(light.dataset.boulderIndex), timer, gender, round));
    });
  });
}

function closeComputosRound() {
  const round = $("#computosRound").value || "clasificatoria";
  const category = $("#computosCategory").value || "mayor";
  const gender = $("#computosGender").value || "Mujer";
  if (!canOpenRound(round, category, gender)) return;
  if (!confirm("Cerrar esta ronda para la categoria y genero seleccionados? Esto habilita la ronda siguiente.")) return;
  const store = readRoundCompletionStore();
  store[roundCompletionKey(round, category, gender)] = true;
  writeRoundCompletionStore(store);
  loadScores();
}

async function loadTimer() {
  let timer = computedLocalTimer();
  if (shouldReadRemoteTimer()) {
    const remoteTimer = await fetchRemoteTimerSnapshot();
    if (remoteTimer) {
      timer = computedLocalTimer(remoteTimer);
      state.timer = timer;
    }
  }
  if (!timer) {
    const serverTimer = await api("/api/timer");
    timer = normalizeTimerSnapshot(serverTimer) || writeLocalTimer(newLocalTimer(serverTimer.round, 1), false);
  }
  if (timer.running || timer.armed) {
    if (roleControlsTimer()) {
      handleTimerAlarms(timer);
      writeLocalTimer(timer, true);
      publishTimerSnapshot(timer);
    } else {
      state.timer = timer;
      renderTimer(timer);
    }
  } else {
    renderTimer(timer);
  }
  refreshComputosActiveLights();
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
    previewSelector: "#managedProfilePhotoPreview",
    fileSelector: "#managedProfilePhotoFile",
    fieldSelector: '[data-managed-profile="photo_url"]',
    statusSelector: "#managedProfileStatus",
  });
  bindPhotoPicker({
    previewSelector: "#routeSetterPhotoPreview",
    fileSelector: "#routeSetterPhotoFile",
    fieldSelector: '[data-route-setter-detail="photo_url"]',
    statusSelector: "#routeSetterDetailStatus",
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

  document.querySelectorAll("[data-public-view]").forEach((button) => {
    button.addEventListener("click", () => switchPublicView(button.dataset.publicView));
  });
  $("#backToCalendar").addEventListener("click", () => switchPublicView("calendarView"));
  $("#calendarYear").addEventListener("click", () => {
    state.publicCalendarFilters.month = "";
    renderPublicCalendar();
  });
  document.querySelectorAll("[data-flip-id]").forEach((button) => {
    button.addEventListener("click", () => $("#fasaIdFlip").classList.toggle("flipped"));
  });
  $("#editUnifiedProfile").addEventListener("click", () => {
    renderUnifiedProfile();
    $("#profileEditDialog").showModal();
  });
  $("#cancelProfileEditor").addEventListener("click", () => $("#profileEditDialog").close());
  $("#closePublicAthlete").addEventListener("click", () => $("#publicAthleteDialog").close());
  document.querySelectorAll("[data-open-role-assignment]").forEach((button) => button.addEventListener("click", () => openRoleAssignment(button.dataset.openRoleAssignment)));
  $("#confirmRoleAssignment").addEventListener("click", async () => {
    try {
      const role = $("#roleAssignmentDialog").dataset.role;
      const fasaId = $("#roleAssignmentPerson").value;
      if (!fasaId) throw new Error("Seleccioná una persona con FASA ID.");
      await api("/api/assign-person-role", { method: "POST", body: JSON.stringify({ fasa_id: fasaId, role, level: Number($("#roleAssignmentLevel").value), region: $("#roleAssignmentRegion").value }) });
      $("#roleAssignmentStatus").textContent = "Rol asignado correctamente.";
      setTimeout(() => $("#roleAssignmentDialog").close(), 400);
      if (role === "judge") await loadJudgePeople();
      if (role === "route_setter") await loadRouteSetterPeople();
      if (role === "general_admin") await loadAdministratorManagement();
      if (role === "regional_representative") await loadRegionalRepresentatives();
    } catch (error) { $("#roleAssignmentStatus").textContent = error.message; }
  });
  $("#refreshFasaManagement").addEventListener("click", loadFasaManagement);
  $("#fasaManagementSearch").addEventListener("input", renderFasaManagementTable);
  $("#fasaManagementRegionFilter").addEventListener("change", renderFasaManagementTable);
  $("#fasaManagementRoleFilter").addEventListener("change", renderFasaManagementTable);
  $("#judgePeopleSearch").addEventListener("input", renderJudgePeople);
  $("#judgePeopleLevelFilter").addEventListener("change", renderJudgePeople);
  $("#judgePeopleStatusFilter").addEventListener("change", renderJudgePeople);
  $("#routeSetterPeopleSearch").addEventListener("input", renderRouteSetterPeople);
  $("#routeSetterPeopleLevelFilter").addEventListener("change", renderRouteSetterPeople);
  $("#routeSetterPeopleStatusFilter").addEventListener("change", renderRouteSetterPeople);
  $("#roleAssignmentSearch").addEventListener("input", renderRoleAssignmentTable);
  $("#personPickerSearch").addEventListener("input", renderPersonPicker);
  $("#juryPresidentSearch").addEventListener("input", renderJuryPresidentPicker);
  $("#backToAssignedEvents")?.addEventListener("click", () => applyRole(state.role, { openRole: true }));
  $("#openCompetitionCreator")?.addEventListener("click", () => {
    resetCompetitionForm();
    openCompetitionEditor();
  });
  $("#closeCompetitionEditor")?.addEventListener("click", closeCompetitionEditor);
  $("#cancelCompetitionEdit")?.addEventListener("click", closeCompetitionEditor);
  $("#competitionEditorModal")?.addEventListener("click", (event) => {
    if (event.target.id === "competitionEditorModal") closeCompetitionEditor();
  });
  const reviewCompetition = async (decision) => {
    if (!state.reviewCompetitionInternalId) return;
    if (decision === "rejected" && !confirm("¿Rechazar este evento? El referente podrá editarlo y volver a enviarlo.")) return;
    try {
      await api("/api/competition-approval", { method: "POST", body: JSON.stringify({ internal_event_id: state.reviewCompetitionInternalId, decision }) });
      closeCompetitionEditor();
      await loadCompetitions();
    } catch (error) {
      $("#competitionStatus").textContent = error.message || "No se pudo completar la revisión.";
    }
  };
  $("#reviewApproveCompetition")?.addEventListener("click", () => reviewCompetition("approved"));
  $("#reviewRejectCompetition")?.addEventListener("click", () => reviewCompetition("rejected"));
  $("#saveManagedProfile").addEventListener("click", saveManagedProfile);
  $("#saveOfficialPersonDetail").addEventListener("click", saveOfficialPersonDetail);
  $("#saveRouteSetterDetail").addEventListener("click", saveRouteSetterDetail);
  $("#saveUnifiedProfile").addEventListener("click", async () => {
    const profile = {};
    document.querySelectorAll("[data-unified-field]").forEach((field) => {
      profile[field.dataset.unifiedField] = field.value;
    });
    try {
      const athleteProfile = { enabled: $("#editAthleteProfileEnabled").checked, instagram: $("#editAthleteInstagram").value.trim(), public_profile: $("#editAthletePublicConsent").checked };
      const saved = await api("/api/fasa-profile", { method: "POST", body: JSON.stringify({ profile, roles: state.roles, athlete_profile: athleteProfile }) });
      state.user = { ...state.user, ...saved.profile, display_name: `${saved.profile.first_name} ${saved.profile.last_name}`.trim(), username: saved.profile.email };
      state.roles = saved.roles || state.roles;
      state.user.role_details = { ...(state.user.role_details || {}), competitor: athleteProfile };
      if (state.competitorPortal?.competitor) state.competitorPortal.competitor = { ...state.competitorPortal.competitor, ...saved.profile };
      if (state.judgePortal?.person) state.judgePortal.person = { ...state.judgePortal.person, ...saved.profile, mail: saved.profile.email };
      $("#unifiedProfileStatus").textContent = `FASA ID actualizado · ${saved.profile.fasa_id}`;
      renderUnifiedProfile();
      setTimeout(() => $("#profileEditDialog").close(), 450);
    } catch (error) {
      $("#unifiedProfileStatus").textContent = error.message || "No se pudo guardar el perfil.";
    }
  });
  document.querySelectorAll("[data-ranking]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-ranking]").forEach((item) => item.classList.toggle("active", item === button));
      renderPublicRankings(button.dataset.ranking);
    });
  });
  [
    ["#rankingRegion", "region"],
    ["#rankingCategory", "category"],
    ["#rankingDiscipline", "discipline"],
  ].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => {
      state.publicRankingFilters[key] = event.target.value;
      renderPublicRankings();
    });
  });
  document.querySelectorAll("[data-ranking-gender]").forEach((button) => {
    button.addEventListener("click", () => {
      state.publicRankingFilters.gender = button.dataset.rankingGender;
      document.querySelectorAll("[data-ranking-gender]").forEach((item) => item.classList.toggle("active", item === button));
      renderPublicRankings();
    });
  });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const session = await api("/api/unified-login", {
        method: "POST",
        body: JSON.stringify({ username: data.get("user"), password: data.get("password"), competition_id: state.loginCompetitionId }),
      });
      state.user = session.user;
      state.roles = session.roles || [session.role];
      state.currentCompetitionId = session.user?.competition_id || state.currentCompetitionId;
      if (session.judgePortal) state.judgePortal = session.judgePortal;
      if (session.competitorPortal) state.competitorPortal = session.competitorPortal;
      state.judgePortalCredentials = { username: data.get("user"), password: data.get("password") };
      state.competitorCredentials = { email: data.get("user"), password: data.get("password") };
      applyRole(session.role);
      loadJudges();
    } catch (error) {
      $("#loginStatus").textContent = error.message || "Usuario o contraseña incorrectos.";
    }
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
    $("#loginForm").classList.add("hidden");
    $("#competitorRegisterForm").classList.remove("hidden");
  });
  $("#competitorRegisterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      state.competitorCredentials = { email: payload.email, password: payload.password };
      state.competitorPortal = await api("/api/competitor-register", { method: "POST", body: JSON.stringify(payload) });
      state.user = { ...state.competitorPortal.competitor, display_name: `${payload.first_name} ${payload.last_name}`, username: payload.email, roles: state.competitorPortal.roles || [] };
      state.roles = state.competitorPortal.roles || [];
      applyRole(state.roles.includes("competitor") ? "competitor" : "guest");
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
      setCalendarFiltersOpen(false);
    });
  });
  $("#calendarFilterToggle")?.addEventListener("click", () => setCalendarFiltersOpen(!document.body.classList.contains("calendar-filters-open")));
  $("#calendarFilterClose")?.addEventListener("click", () => setCalendarFiltersOpen(false));
  $("#calendarFilterBackdrop")?.addEventListener("click", () => setCalendarFiltersOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setCalendarFiltersOpen(false);
  });

  function toggleRegionField() {
    const isCred = $("#competitionType").value === "CRED";
    $("#regionField").hidden = !isCred;
    $("#competitionRegion").required = isCred;
    if (!isCred && state.role !== "regional_representative") {
      $("#competitionRegion").value = "";
      $("#regionField").classList.remove("field-error");
    }
  }
  $("#competitionType").addEventListener("change", toggleRegionField);
  toggleRegionField();
  $("#competitionForm").addEventListener("invalid", (event) => {
    event.target.closest("label")?.classList.add("field-error");
    $("#competitionStatus").textContent = "Revisá los campos obligatorios marcados en rojo.";
  }, true);
  $("#competitionForm").addEventListener("input", (event) => {
    if (event.target.validity?.valid) event.target.closest("label")?.classList.remove("field-error");
  });
  $("#competitionForm").addEventListener("change", (event) => {
    if (event.target.validity?.valid) event.target.closest("label")?.classList.remove("field-error");
  });
  $("#competitionForm").elements.event_date.addEventListener("change", (event) => {
    const endDate = $("#competitionForm").elements.end_date;
    endDate.min = event.target.value;
    if (endDate.value && endDate.value < event.target.value) endDate.value = "";
  });
  $("#competitionForm").elements.organizer_logo_file.addEventListener("change", (event) => {
    const file = event.target.files[0];
    const preview = $("#organizerLogoPreview");
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute("src");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    preview.onload = () => URL.revokeObjectURL(objectUrl);
    preview.src = objectUrl;
    preview.hidden = false;
    $("#organizerLogoCurrent").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  });
  $("#openOrganizerEditor")?.addEventListener("click", openOrganizerEditor);
  $("#organizerFasaPicker").addEventListener("change", (event) => {
    const person = state.fasaProfiles.find((item) => item.fasa_id === event.target.value); if (!person) return;
    const form = $("#competitionForm"); form.elements.organizer_fasa_id.value = person.fasa_id;
    $('[data-organizer-field="last_name"]').value = person.last_name || ""; $('[data-organizer-field="first_name"]').value = person.first_name || "";
    $('[data-organizer-field="dni"]').value = person.dni || ""; $('[data-organizer-field="username"]').value = person.email || "";
    $('[data-organizer-field="club"]').value = person.club || "";
  });
  $("#chooseChiefRouteSetter").addEventListener("click", chooseChiefRouteSetter);
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
    const infosheetFile = event.currentTarget.elements.infosheet_file.files[0];
    const organizerLogoFile = event.currentTarget.elements.organizer_logo_file.files[0];
    delete payload.infosheet_file;
    delete payload.organizer_logo_file;
    const wasEditing = Boolean(payload.id);
    payload.end_date = payload.end_date || payload.event_date;
    const organizer = organizerFormData();
    const hasOrganizerData = organizer.fasa_id || organizer.first_name || organizer.last_name || organizer.dni || organizer.username || organizer.club;
    if (!organizer.fasa_id) {
      $("#organizerRoleRow")?.classList.add("required-selection-error");
      $("#competitionStatus").textContent = "Seleccioná al organizador desde la base FASA ID.";
      return;
    }
    if (hasOrganizerData && (!organizer.first_name || !organizer.last_name || !organizer.dni || !organizer.username)) {
      $("#competitionStatus").textContent = "La FASA ID del organizador no tiene completos nombre, apellido, DNI o mail.";
      return;
    }
    if (hasOrganizerData && !/^\d{8}$/.test(organizer.dni)) {
      $("#competitionStatus").textContent = "El DNI del organizador debe tener exactamente 8 digitos numericos.";
      return;
    }
    if (payload.end_date < payload.event_date) {
      $("#competitionStatus").textContent = "La fecha de finalización no puede ser anterior a la fecha de inicio.";
      return;
    }
    if (infosheetFile && infosheetFile.size > 15 * 1024 * 1024) {
      $("#competitionStatus").textContent = "El Infosheet no puede superar los 15 MB.";
      return;
    }
    if (organizerLogoFile && organizerLogoFile.size > 5 * 1024 * 1024) {
      $("#competitionStatus").textContent = "El logo del club no puede superar los 5 MB.";
      return;
    }
    payload.sport_category = payload.category === "Mayores" ? "mayor" : "";
    if (state.role === "regional_representative") {
      payload.creator_role = "regional_representative";
      payload.creator_fasa_id = state.user?.fasa_id || "";
      payload.competition_type = "CRED";
      payload.region = state.user.region;
    }
    if (!payload.id) delete payload.id;
    if (payload.competition_type !== "CRED") payload.region = "";
    const saveButton = $("#saveCompetitionButton");
    saveButton.disabled = true;
    try {
      if (organizerLogoFile && organizerLogoFile.size) {
        $("#competitionStatus").textContent = "Subiendo logo del club…";
        const uploadedLogo = await uploadOrganizerLogo(organizerLogoFile);
        payload.organizer_logo_key = uploadedLogo.key;
        payload.organizer_logo_filename = uploadedLogo.filename;
        payload.organizer_logo_content_type = uploadedLogo.content_type;
        payload.organizer_logo_url = uploadedLogo.url;
      }
      if (infosheetFile && infosheetFile.size) {
        $("#competitionStatus").textContent = "Subiendo Infosheet…";
        const uploaded = await uploadInfosheet(infosheetFile);
        payload.infosheet_key = uploaded.key;
        payload.infosheet_filename = uploaded.filename;
        payload.infosheet_url = uploaded.url;
      }
      await api("/api/competitions", { method: "POST", body: JSON.stringify(payload) });
      await loadCompetitions();
      closeCompetitionEditor();
    } catch (error) {
      $("#competitionStatus").textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  });
  $("#refreshCompetitions").addEventListener("click", loadCompetitions);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.dataset.view) return;
      if (["unifiedProfile", "fasaCv"].includes(button.dataset.view)) {
        state.privateRoleOpen = false;
        renderAssignedRoles();
      }
      activateView(button.dataset.view, { subview: button.dataset.subview });
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
  $("#closeAccreditations").addEventListener("click", closeAccreditations);
  $("#assignRandomBibs").addEventListener("click", assignRandomBibs);
  $("#timerRound").addEventListener("change", () => {
    renderBoulders();
    runTimerAction("select");
  });
  $("#timerMode").addEventListener("change", () => runTimerAction("select"));
  $("#timerCycle").addEventListener("change", () => runTimerAction("select"));
  $("#timerGenderWomen").addEventListener("change", () => runTimerAction("select"));
  $("#timerGenderMen").addEventListener("change", () => runTimerAction("select"));
  $("#computosRound").addEventListener("change", () => {
    loadScores();
  });
  $("#computosCategory").addEventListener("change", loadScores);
  $("#computosGender").addEventListener("change", loadScores);
  $("#closeComputosRound").addEventListener("click", closeComputosRound);
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
      $("#saveStatus").textContent = "Primero seleccioná un atleta.";
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
      judge_fasa_id: state.user?.fasa_id || "",
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
      $("#formStatus").textContent = "Atleta agregado.";
      await refreshAll();
    } catch (error) {
      $("#formStatus").textContent = error.message;
    }
  });

  $("#seedCompetitors").addEventListener("click", async () => {
    const result = await api("/api/seed", { method: "POST", body: "{}" });
    $("#formStatus").textContent = `Demo cargada: ${result.total} atletas en base.`;
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

  $("#saveCompetitorProfile")?.addEventListener("click", async () => {
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
    collectRoundSchedules();
    collectStartOrders();
    const config = await api("/api/config", { method: "POST", body: JSON.stringify({ rounds }) });
    state.rounds = config.rounds;
    $("#configStatus").textContent = "Configuracion y horarios guardados.";
    renderRounds();
    await refreshAll();
  });
  $("#configGrid").addEventListener("change", renderRoundSchedule);

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

  $("#saveRouteSetterTeam").addEventListener("click", async () => {
    const team = Array.from($("#routeSetterTeamList").querySelectorAll('input:checked')).map((input) => input.value);
    await api("/api/competition-route-setters", { method: "POST", body: JSON.stringify({ competition_id: state.currentCompetitionId || 1, chief_fasa_id: state.user?.fasa_id, team_fasa_ids: team }) });
    $("#routeSetterTeamStatus").textContent = "Equipo de aperturistas guardado y participaciones registradas.";
  });

  $("#applyJudgeCount").addEventListener("click", () => {
    const count = Math.max(1, Math.min(20, Number($("#judgeCount").value || 1)));
    state.judges = Array.from({ length: count }, (_, index) => state.judges[index] || defaultJudge(index));
    renderJudges();
  });

  $("#saveJudges").addEventListener("click", async () => {
    if (!state.currentCompetitionId) {
      $("#judgesStatus").textContent = "Primero hay que ingresar como presidente de jurado de un evento.";
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

  $("#timerSelect").addEventListener("click", () => runTimerAction("select"));
  $("#timerPlayPause").addEventListener("click", () => {
    const timer = computedLocalTimer();
    openTimerAuthorization(timer?.running || timer?.armed ? "pause" : "start");
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
