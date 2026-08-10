const TIMER_STORAGE_KEY = "credFasaLocalTimer";
const TIMER_CHANNEL_NAME = "cred-fasa-timer";
const channel = "BroadcastChannel" in window ? new BroadcastChannel(TIMER_CHANNEL_NAME) : null;

let timer = null;
let audioContext = null;
let lastAlarmSnapshot = null;
const alarmMarks = new Set();

const $ = (selector) => document.querySelector(selector);

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const rest = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function readTimer() {
  try {
    const stored = JSON.parse(localStorage.getItem(TIMER_STORAGE_KEY) || "null");
    return stored?.timer_schema === 2 || stored?.timer_schema === 3 ? stored : null;
  } catch {
    return null;
  }
}

function computedTimer(source = timer) {
  if (!source) return null;
  const next = { ...source };
  next.prep_seconds = Number(next.prep_seconds || 15);
  next.duration_seconds = Number(next.duration_seconds || (next.round === "clasificatoria" ? 300 : 240));
  next.remaining_seconds = Number(next.remaining_seconds || 0);
  next.cycle = Number(next.cycle || 1);
  next.running = Boolean(next.running);
  next.armed = Boolean(next.armed);

  if (next.mode === "automatic" && next.armed && !next.running && next.scheduled_start_at) {
    const startAt = new Date(next.scheduled_start_at).getTime();
    if (Date.now() >= startAt) {
      next.armed = false;
      next.running = true;
      next.started_at = startAt;
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
      next.cycle += 1;
      next.remaining_seconds = next.prep_seconds;
    }
    next.started_at = Date.now() - elapsed * 1000;
    phaseSeconds = next.phase === "prep" ? next.prep_seconds : next.duration_seconds;
  }
  next.remaining_seconds = Math.max(0, phaseSeconds - elapsed);
  return next;
}

function beep(frequency = 880, duration = 0.18, repeats = 1, gap = 0.22) {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const play = () => {
      for (let index = 0; index < repeats; index += 1) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startAt = audioContext.currentTime + index * gap;
        oscillator.frequency.value = frequency;
        oscillator.type = "square";
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.03);
      }
    };
    if (audioContext.state === "suspended") {
      audioContext.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch {
    // Audio can remain blocked until the projector window receives a click.
  }
}

function handleAlarms(snapshot) {
  if (!snapshot?.running) {
    lastAlarmSnapshot = snapshot ? { ...snapshot } : null;
    return;
  }
  const previous = lastAlarmSnapshot;
  const crossed = (target) => {
    if (!previous || previous.phase !== snapshot.phase || previous.cycle !== snapshot.cycle) {
      return snapshot.remaining_seconds === target;
    }
    return previous.remaining_seconds > target && snapshot.remaining_seconds <= target;
  };
  const markOnce = (name, callback) => {
    const mark = `${snapshot.cycle}-${snapshot.phase}-${name}`;
    if (alarmMarks.has(mark)) return;
    alarmMarks.add(mark);
    callback();
  };

  if (snapshot.phase !== "climb") {
    lastAlarmSnapshot = { ...snapshot };
    return;
  }
  if (previous?.phase === "prep" && snapshot.phase === "climb") {
    markOnce("start", () => beep(880, 0.18, 3));
  }
  if (crossed(60)) {
    markOnce("one-minute", () => beep(660, 0.24, 2, 0.28));
  }
  [3, 2, 1, 0].forEach((second) => {
    if (crossed(second)) {
      markOnce(`last-${second}`, () => beep(1040, 0.14, 1));
    }
  });
  lastAlarmSnapshot = { ...snapshot };
}

function render() {
  const snapshot = computedTimer();
  if (!snapshot) {
    $("#projectTimerDisplay").textContent = "00:00";
    return;
  }

  $("#projectTimerDisplay").textContent = formatTime(snapshot.remaining_seconds);
  handleAlarms(snapshot);
}

timer = readTimer();
render();
setInterval(render, 250);

window.addEventListener("pointerdown", () => {
  audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}, { once: true });

if (channel) {
  channel.addEventListener("message", (event) => {
    timer = event.data || readTimer();
    render();
  });
}

window.addEventListener("storage", (event) => {
  if (event.key !== TIMER_STORAGE_KEY) return;
  timer = readTimer();
  render();
});
