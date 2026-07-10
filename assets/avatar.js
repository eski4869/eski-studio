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
const message = document.getElementById("message");
const params = new URLSearchParams(location.search);
const debugMode = params.get("debug") === "1";
const configPath = params.get("config") || "avatar.config.json";
const defaultCurrentStateTsvPath = "../raw_data/attempts/current/current_state.tsv";
const metricsBasePath = params.get("metrics") || "";
let statePath = metricsBasePath
  ? toFetchPath(`${metricsBasePath.replace(/\/$/, "")}/current_state.tsv`)
  : toFetchPath(defaultCurrentStateTsvPath);
let pollMs = 1000;
let happyPbGapMs = 3 * 60 * 1000;
let specialHappyPbGapMs = 30 * 60 * 1000;
let fallWindowMs = 10000;
let angryFallScreens = 4;
let happyDurationMs = 5000;
let specialHappyDurationMs = 7000;
let angryDurationMs = 3000;
let scheduledMessagesEnabled = true;
let scheduledMessageIntervalMs = 20 * 60 * 1000;
let scheduledMessages = [
  "Feel free to comment in English too!",
  "Jump King縺ｯ莠ｺ逕滂ｼ",
  "ゆっくりしていってね(*^_^*)",
  "ネチケットを守ってご利用くださいm(__)m",
  "直リン禁止です"
];
let messages = {
  happy: [
    "{minutes}分ぶりのPBだね！",
    "{minutes}分ぶりのPBだよ！"
  ],
  specialHappy: [
    "やっときた！{minutes}分ぶりのPB！！",
    "待たせたぜ！{minutes}分ぶりのPB！！",
    "きたきたきた！{minutes}分ぶりのPB！！"
  ],
  angry: [
    "ジャンプ下手すぎ",
    "真面目にやってますか",
    "落ちすぎ",
    "許さん",
    "もっと基礎練しとけよ"
  ],
  idle: []
};
let faces = {
  happy: [
    "(≧∀≦)",
    "キタ━━━(゜∀゜)━━━!!!!!",
    "(^_^)",
    "(^○^)",
    "(*^_^*)",
    "(＾ω＾)",
    "＼(^ω^)／",
    "( ● ´ ー ｀ ● )",
    "(σ´∀`)σ",
    "(・∀・)"
  ],
  specialHappy: [
    "(≧∀≦)",
    "キタ━━━(゜∀゜)━━━!!!!!",
    "(^○^)",
    "＼(^ω^)／",
    "(σ´∀`)σ"
  ],
  angry: [
    "(T_T)",
    "(^_^;)",
    "(>_<)",
    "(# ﾟДﾟ)",
    "（｀m´＃）",
    "ヽ(｀Д´#)ﾉ",
    "ｲﾗｲﾗ(*｀Д´*)ｲﾗｲﾗ",
    "(●｀ε´●)ﾌﾟﾝﾌﾟﾝ"
  ],
  idle: []
};

let currentState = "idle";
let frameIndex = 0;
let frameTimer = 0;
let eventTimer = 0;
let messageTimer = 0;
let scheduledMessageTimer = 0;
let lastPbPosition = null;
let lastPbElapsedMs = null;
let lastPbAttempt = null;
let positionHistory = [];
const pbStorageKey = "eskiAvatar.lastPbState";

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

function withCacheBust(path) {
  if (/^file:/i.test(path)) {
    return path;
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}t=${Date.now()}`;
}

async function loadConfig() {
  const response = await fetch(withCacheBust(configPath), { cache: "no-store" });
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

  if (config.scheduledMessages) {
    scheduledMessagesEnabled = config.scheduledMessages.enabled !== false;
    scheduledMessageIntervalMs = minutesToMs(config.scheduledMessages.intervalMinutes, scheduledMessageIntervalMs);
    if (Array.isArray(config.scheduledMessages.messages)) {
      scheduledMessages = config.scheduledMessages.messages;
    }
  }

  if (config.messages) {
    messages = {
      ...messages,
      ...config.messages
    };
  }

  if (config.faces) {
    faces = {
      ...faces,
      ...config.faces
    };
  }
}

function framePath(state, index) {
  const animation = animations[state];
  const assetState = animation.assetState || state;
  return `avatar/${assetState}/${String(index + 1).padStart(3, "0")}.png`;
}

function renderFrame() {
  avatar.src = framePath(currentState, frameIndex);
}

function pickMessage(state, values = {}) {
  const choices = messages[state];
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const template = choices[Math.floor(Math.random() * choices.length)];
  const text = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
  });
  const faceChoices = faces[state];
  if (!Array.isArray(faceChoices) || faceChoices.length === 0) {
    return text;
  }

  const face = faceChoices[Math.floor(Math.random() * faceChoices.length)];
  return `${text} ${face}`;
}

function pickScheduledMessage() {
  if (!Array.isArray(scheduledMessages) || scheduledMessages.length === 0) {
    return "";
  }

  return scheduledMessages[Math.floor(Math.random() * scheduledMessages.length)];
}

function showMessage(state, text, values = {}) {
  if (!message) {
    return;
  }

  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = 0;
  }

  const nextText = text || pickMessage(state, values);
  if (!nextText) {
    message.textContent = "";
    message.className = "message";
    return;
  }

  message.textContent = nextText;
  message.className = `message ${state === "angry" ? "angry" : ""}`;
  message.getBoundingClientRect();
  message.classList.add("visible");

  messageTimer = setTimeout(() => {
    message.classList.remove("visible");
  }, 3000);
}

function showScheduledMessage() {
  if (!scheduledMessagesEnabled || eventTimer || currentState !== "idle") {
    return;
  }

  const text = pickScheduledMessage();
  if (text) {
    showMessage("idle", text);
  }
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
  showMessage(state, options.message, options.messageValues || {});

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

function loadPbState() {
  try {
    const stored = JSON.parse(localStorage.getItem(pbStorageKey) || "null");
    if (!stored) {
      return;
    }

    if (Number.isFinite(stored.position) && Number.isFinite(stored.elapsedMs)) {
      lastPbPosition = stored.position;
      lastPbElapsedMs = stored.elapsedMs;
      lastPbAttempt = stored.attempt || null;
    }
  } catch {
    // localStorage can be unavailable in some browser source modes.
  }
}

function savePbState() {
  try {
    localStorage.setItem(pbStorageKey, JSON.stringify({
      attempt: lastPbAttempt,
      position: lastPbPosition,
      elapsedMs: lastPbElapsedMs
    }));
  } catch {
    // Metrics display should keep running even if persistence is unavailable.
  }
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

function handlePbUpdate(pbPosition, elapsedMs, attempt) {
  const attemptKey = attempt || null;

  if (lastPbPosition === null) {
    lastPbPosition = pbPosition;
    lastPbElapsedMs = elapsedMs;
    lastPbAttempt = attemptKey;
    savePbState();
    return;
  }

  if (lastPbAttempt !== attemptKey || elapsedMs < lastPbElapsedMs) {
    lastPbPosition = pbPosition;
    lastPbElapsedMs = elapsedMs;
    lastPbAttempt = attemptKey;
    savePbState();
    return;
  }

  if (pbPosition <= lastPbPosition) {
    return;
  }

  if (lastPbElapsedMs !== null) {
    const pbGapMs = elapsedMs - lastPbElapsedMs;
    const pbGapMinutes = Math.max(0, Math.floor(pbGapMs / 60000));
    const messageValues = { minutes: pbGapMinutes };

    if (pbGapMs >= specialHappyPbGapMs) {
      setState("specialHappy", {
        durationMs: specialHappyDurationMs,
        message: pickMessage("specialHappy", messageValues)
      });
    } else if (pbGapMs >= happyPbGapMs) {
      setState("happy", {
        durationMs: happyDurationMs,
        message: pickMessage("happy", messageValues)
      });
    }
  }

  lastPbPosition = pbPosition;
  lastPbElapsedMs = elapsedMs;
  lastPbAttempt = attemptKey;
  savePbState();
}

async function pollMetrics() {
  try {
    const response = await fetch(withCacheBust(statePath), { cache: "no-store" });
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
      handlePbUpdate(pbPosition, elapsedMs, row.attempt);
    }
  } catch {
    // File access can fail before JK Metrics creates data. Keep the idle animation alive.
  }
}

document.querySelectorAll("[data-state]").forEach(button => {
  button.addEventListener("click", () => {
    setState(button.dataset.state, {
      messageValues: {
        minutes: button.dataset.state === "specialHappy" ? 45 : 12
      }
    });
  });
});

document.getElementById("eventHappy").addEventListener("click", () => {
  setState("happy", {
    durationMs: 2200,
    messageValues: { minutes: 12 }
  });
});

document.getElementById("eventAngry").addEventListener("click", () => {
  setState("angry", { durationMs: 2200 });
});

async function start() {
  try {
    await loadConfig();
  } catch {
    // Missing or invalid config keeps the default relative path.
  }

  setState("idle");
  tick();
  loadPbState();

  setInterval(pollMetrics, pollMs);
  scheduledMessageTimer = setInterval(showScheduledMessage, scheduledMessageIntervalMs);
  pollMetrics();
}

start();
