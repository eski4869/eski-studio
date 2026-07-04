const animations = {
  idle: {
    frameCount: 4,
    frameMs: 180,
    loop: true
  },
  happy: {
    frameCount: 4,
    frameMs: 120,
    loop: true
  },
  specialHappy: {
    assetState: "special-happy",
    frameCount: 4,
    frameMs: 120,
    loop: true
  },
  angry: {
    frameCount: 4,
    frameMs: 110,
    loop: true
  }
};

const avatar = document.getElementById("avatar");
const params = new URLSearchParams(location.search);
const debugMode = params.get("debug") === "1";
const configPath = params.get("config") || "avatar.config.json";
const metricsBasePath = params.get("metrics") || "../raw_data/attempts/current";
let statePath = `${metricsBasePath.replace(/\/$/, "")}/current_state.tsv`;
let pollMs = 1000;
let happyPbGapMs = 3 * 60 * 1000;
let specialHappyPbGapMs = 30 * 60 * 1000;
let fallWindowMs = 10000;
let angryFallScreens = 4;
let happyDurationMs = 5000;
let specialHappyDurationMs = 7000;
let angryDurationMs = 3000;

let currentState = "idle";
let frameIndex = 0;
let frameTimer = 0;
let eventTimer = 0;
let lastPbPosition = null;
let lastPbElapsedMs = null;
let positionHistory = [];

if (!debugMode) {
  document.documentElement.classList.add("transparent");
}

function toFetchPath(path) {
  if (!path) {
    return statePath;
  }

  if (/^(file|https?):/i.test(path)) {
    return path;
  }

  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    const normalized = path.replace(/\\/g, "/");
    const parts = normalized.split("/");
    return `file:///${parts.map((part, index) => index === 0 ? part : encodeURIComponent(part)).join("/")}`;
  }

  return path;
}

async function loadConfig() {
  const response = await fetch(`${configPath}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    return;
  }

  const config = await response.json();
  applyConfig(config);
}

function useNumber(value, currentValue) {
  const number = Number(value);
  return Number.isFinite(number) ? number : currentValue;
}

function minutesToMs(value, currentValue) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 60 * 1000 : currentValue;
}

function secondsToMs(value, currentValue) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 1000 : currentValue;
}

function applyConfig(config) {
  statePath = toFetchPath(config.currentStateTsvPath);

  pollMs = useNumber(config.pollMs, pollMs);

  if (config.happy) {
    happyPbGapMs = minutesToMs(config.happy.pbGapMinutes, happyPbGapMs);
    happyDurationMs = secondsToMs(config.happy.durationSeconds, happyDurationMs);
  }

  if (config.specialHappy) {
    specialHappyPbGapMs = minutesToMs(config.specialHappy.pbGapMinutes, specialHappyPbGapMs);
    specialHappyDurationMs = secondsToMs(config.specialHappy.durationSeconds, specialHappyDurationMs);
  }

  if (config.angry) {
    fallWindowMs = secondsToMs(config.angry.fallWindowSeconds, fallWindowMs);
    angryFallScreens = useNumber(config.angry.fallScreens, angryFallScreens);
    angryDurationMs = secondsToMs(config.angry.durationSeconds, angryDurationMs);
  }
}

function framePath(state, index) {
  const animation = animations[state];
  const assetState = animation.assetState || state;
  return `assets/avatar/${assetState}/${String(index + 1).padStart(3, "0")}.png`;
}

function renderFrame() {
  avatar.src = framePath(currentState, frameIndex);
}

function setState(state, options = {}) {
  if (!animations[state]) {
    return;
  }

  currentState = state;
  frameIndex = 0;
  avatar.classList.toggle("happy", state === "happy" || state === "specialHappy");
  avatar.classList.toggle("special-happy", state === "specialHappy");
  avatar.classList.toggle("angry", state === "angry");
  renderFrame();

  if (eventTimer) {
    clearTimeout(eventTimer);
    eventTimer = 0;
  }

  if (options.durationMs) {
    eventTimer = setTimeout(() => setState("idle"), options.durationMs);
  }
}

function tick() {
  const animation = animations[currentState];
  frameIndex = (frameIndex + 1) % animation.frameCount;
  renderFrame();

  clearTimeout(frameTimer);
  frameTimer = setTimeout(tick, animation.frameMs);
}

function parseTsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return null;
  }

  const headers = lines[0].split("\t");
  const values = lines[lines.length - 1].split("\t");
  const row = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || "";
  });
  return row;
}

function progressPosition(areaOrder, screenOrder) {
  const area = Number(areaOrder);
  const screen = Number(screenOrder);
  if (!Number.isFinite(area) || !Number.isFinite(screen) || area <= 0 || screen <= 0) {
    return null;
  }
  return area * 1000 + screen;
}

function isKnownArea(areaName) {
  return areaName && areaName.trim().toLowerCase() !== "unknown";
}

function resetFallHistory() {
  positionHistory = [];
}

function updateFallHistory(now, currentPosition) {
  positionHistory.push({ time: now, position: currentPosition });
  positionHistory = positionHistory.filter(point => now - point.time <= fallWindowMs);

  const recentMax = Math.max(...positionHistory.map(point => point.position));
  if (recentMax - currentPosition < angryFallScreens) {
    return false;
  }

  positionHistory = [{ time: now, position: currentPosition }];
  return true;
}

function handlePbUpdate(pbPosition, elapsedMs) {
  if (lastPbPosition === null) {
    lastPbPosition = pbPosition;
    lastPbElapsedMs = elapsedMs;
    return;
  }

  if (pbPosition <= lastPbPosition) {
    return;
  }

  if (lastPbElapsedMs !== null) {
    const pbGapMs = elapsedMs - lastPbElapsedMs;
    if (pbGapMs >= specialHappyPbGapMs) {
      setState("specialHappy", { durationMs: specialHappyDurationMs });
    } else if (pbGapMs >= happyPbGapMs) {
      setState("happy", { durationMs: happyDurationMs });
    }
  }

  lastPbPosition = pbPosition;
  lastPbElapsedMs = elapsedMs;
}

async function pollMetrics() {
  try {
    const response = await fetch(`${statePath}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const row = parseTsv(await response.text());
    if (!row) {
      return;
    }

    const now = Date.now();
    const elapsedMs = Number(row.elapsed_ms);
    const currentPosition = progressPosition(row.current_area_order, row.current_screen_order);
    const pbPosition = progressPosition(row.pb_area_order, row.pb_screen_order);

    if (!isKnownArea(row.area_name) || currentPosition === null) {
      resetFallHistory();
    } else if (updateFallHistory(now, currentPosition)) {
      setState("angry", { durationMs: angryDurationMs });
    }

    if (pbPosition !== null && Number.isFinite(elapsedMs)) {
      handlePbUpdate(pbPosition, elapsedMs);
    }
  } catch {
    // File access can fail before JK Metrics creates data. Keep the idle animation alive.
  }
}

document.querySelectorAll("[data-state]").forEach(button => {
  button.addEventListener("click", () => {
    setState(button.dataset.state);
  });
});

document.getElementById("eventHappy").addEventListener("click", () => {
  setState("happy", { durationMs: 2200 });
});

document.getElementById("eventAngry").addEventListener("click", () => {
  setState("angry", { durationMs: 2200 });
});

async function start() {
  setState("idle");
  tick();

  try {
    await loadConfig();
  } catch {
    // Missing or invalid config keeps the default relative path.
  }

  setInterval(pollMetrics, pollMs);
  pollMetrics();
}

start();
