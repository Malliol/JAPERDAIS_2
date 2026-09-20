import { setCurrentUser, getCurrentUser, logout } from "./auth.js";

let currentUsername = null;

// ===== AUTH =====
const authScreen   = document.getElementById("authScreen");
const appScreen    = document.getElementById("appScreen");
const authForm     = document.getElementById("authForm");
const authUsername = document.getElementById("authUsername");
const authError    = document.getElementById("authError");
const authSubmit   = document.getElementById("authSubmit");
const logoutBtn    = document.getElementById("logoutBtn");

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  const u = authUsername.value.trim();
  if (!u) {
    authError.textContent = "Введи ник";
    authError.classList.remove("hidden");
    return;
  }
  setCurrentUser(u);
  startApp(u);
});

logoutBtn.addEventListener("click", () => {
  logout();
  closeWS();
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  authUsername.value = "";
});

const existingUser = getCurrentUser();
if (existingUser) {
  authScreen.classList.add("hidden");
  startApp(existingUser);
}

// ===== PWA =====
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

// ===== ЗВУК =====
let audioCtx = null;

function unlockAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playAlarm() {
  try {
    unlockAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    // Сирена: высокий → низкий → высокий, 3 раза
    [[0, 880, 440], [0.35, 440, 880], [0.7, 880, 440]].forEach(([start, from, to]) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(from, now + start);
      osc.frequency.linearRampToValueAtTime(to, now + start + 0.3);
      gain.gain.setValueAtTime(0.25, now + start);
      gain.gain.linearRampToValueAtTime(0, now + start + 0.35);
      osc.start(now + start);
      osc.stop(now + start + 0.36);
    });
  } catch {}
}

// ===== TOAST =====
const toastEl = document.getElementById("toast");
let toastTimer;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.className = "toast show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3500);
}

// ===== WS =====
let ws = null;

const wsStatus    = document.getElementById("wsStatus");
const connDot     = document.getElementById("connDot");
const userList    = document.getElementById("userList");
const onlineCount = document.getElementById("onlineCount");
const pizdetsBtn  = document.getElementById("pizdetsBtn");

function setStatus(text, state) {
  wsStatus.textContent = text;
  connDot.className = "conn-dot" + (state ? " " + state : "");
}

function getWsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function closeWS() {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }
}

let kicked = false;

function connectWS(username) {
  closeWS();
  kicked = false;
  setStatus("подключение…", "");
  ws = new WebSocket(getWsUrl());
  ws.onopen    = () => ws.send(JSON.stringify({ type: "join", username }));
  ws.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch {} };
  ws.onclose   = () => {
    if (kicked) return;
    setStatus("нет соединения", "error");
    setTimeout(() => connectWS(username), 3000);
  };
  ws.onerror   = () => setStatus("ошибка", "error");
}

function wsSend(data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

function renderUsers(users) {
  onlineCount.textContent = users.length;
  userList.innerHTML = "";
  if (!users.length) {
    userList.innerHTML = '<li class="online-empty">Никого нет онлайн</li>';
    return;
  }
  for (const u of users) {
    const li = document.createElement("li");
    li.className = "user-item";
    const av = document.createElement("div");
    av.className = "user-avatar";
    av.style.background = u.color || "var(--accent)";
    av.textContent = u.username[0].toUpperCase();
    const nm = document.createElement("span");
    nm.className = "user-name";
    nm.textContent = u.username;
    if (u.username === currentUsername) {
      const me = document.createElement("span");
      me.className = "user-name-me";
      me.textContent = "(я)";
      nm.appendChild(me);
    }
    li.append(av, nm);
    userList.appendChild(li);
  }
}

function handleMsg(msg) {
  switch (msg.type) {
    case "users":
      setStatus("в сети", "online");
      renderUsers(msg.users || []);
      break;
    case "pizdets":
      showToast(`⚠️ ПИЗДЕЦ от ${msg.username}!`);
      pizdetsBtn.classList.add("fire");
      setTimeout(() => pizdetsBtn.classList.remove("fire"), 420);
      playAlarm();
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
      if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
        new Notification("⚠️ ПИЗДЕЦ!", { body: `Сигнал от ${msg.username}` });
      }
      break;
    case "kicked":
      kicked = true;
      closeWS();
      logout();
      appScreen.classList.add("hidden");
      authScreen.classList.remove("hidden");
      authError.textContent = "Вход выполнен с другого устройства";
      authError.classList.remove("hidden");
      break;
  }
}

pizdetsBtn.addEventListener("click", () => {
  unlockAudio(); // разблокируем AudioContext через жест пользователя
  wsSend({ type: "pizdets" });
  pizdetsBtn.classList.add("fire");
  setTimeout(() => pizdetsBtn.classList.remove("fire"), 420);
  showToast("Пиздец отправлен всем!");
});

// ===== PWA INSTALL =====
const installBtn  = document.getElementById("installBtn");
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIos        = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone) installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  }
});

window.addEventListener("appinstalled", () => installBtn.classList.add("hidden"));

if (isIos && !isStandalone) {
  installBtn.textContent = "📲 Safari → Поделиться → На экран «Домой»";
  installBtn.classList.remove("hidden");
  installBtn.style.pointerEvents = "none";
}

// ===== PUSH ПОДПИСКА =====
async function subscribeToPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // уже подписан

    const res = await fetch('/api/vapid-public-key');
    const { key } = await res.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
  } catch {}
}

// ===== START =====
function startApp(username) {
  currentUsername = username;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  if (typeof Notification !== 'undefined' && Notification.requestPermission) {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') subscribeToPush();
    }).catch(() => {});
  }
  connectWS(username);
}
