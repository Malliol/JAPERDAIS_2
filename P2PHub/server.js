import http from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const webpush = require('web-push');

export const PORT = 3000;
const SUBS_FILE  = './subscriptions.json';
const clients = new Map();
const COLORS = ['#2f81f7','#3fb950','#f78166','#d2a8ff','#ffa657','#79c0ff','#56d364','#ff7b72'];

const VAPID_PUBLIC  = 'BMMlg62BVP5PPfsVJq4LSbYGWN7IErsrDG-_MYK_gvt_lL2IXe0BXfEmjd3kLikxyEhFR2AxmlkMYRDJscxpZo4';
const VAPID_PRIVATE = 'DJIPQjrE5ajP9zYQbZbs-WlVSfehLROfdYCKUeYYlYs';

webpush.setVapidDetails('mailto:admin@osgovorim.local', VAPID_PUBLIC, VAPID_PRIVATE);

function loadSubs() {
  if (!existsSync(SUBS_FILE)) return [];
  try { return JSON.parse(readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(subs) { writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2)); }

async function pushToAll(payload) {
  const subs = loadSubs();
  const dead = new Set();
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err) {
        // удаляем только если подписка явно истекла (410) или не найдена (404)
        if (err.statusCode === 410 || err.statusCode === 404) dead.add(sub.endpoint);
      }
    })
  );
  if (dead.size > 0) saveSubs(subs.filter(s => !dead.has(s.endpoint)));
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/vapid-public-key') {
    json(res, 200, { key: VAPID_PUBLIC });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscribe') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const sub = JSON.parse(body);
        if (!sub.endpoint) return json(res, 400, { error: 'Неверная подписка' });
        const subs = loadSubs();
        if (!subs.some(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(subs); }
        json(res, 200, { ok: true });
      } catch { json(res, 400, { error: 'Неверный запрос' }); }
    });
    return;
  }

  res.writeHead(200); res.end('ok');
});

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const wss = new WebSocketServer({ server });

function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }
function broadcast(data) { for (const [ws] of clients) send(ws, data); }
function getUserList() { return [...clients.values()].map(u => ({ username: u.username, color: u.color })); }

function kickByUsername(username) {
  for (const [existingWs, existingUser] of clients) {
    if (existingUser.username.toLowerCase() === username.toLowerCase()) {
      send(existingWs, { type: 'kicked' });
      existingWs._kicked = true; // флаг чтобы close handler не делал лишний broadcast
      existingWs.terminate();
      clients.delete(existingWs);
      break;
    }
  }
}

let colorIdx = 0;

wss.on('connection', (ws) => {
  let user = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const username = String(msg.username || 'Аноним').slice(0, 32);
      kickByUsername(username);
      const color = COLORS[colorIdx++ % COLORS.length];
      user = { username, color };
      clients.set(ws, user);
      broadcast({ type: 'users', users: getUserList() });
    } else if (msg.type === 'pizdets' && user) {
      broadcast({ type: 'pizdets', username: user.username, t: Date.now() });
      pushToAll({ title: '⚠️ ПИЗДЕЦ!', body: `Сигнал от ${user.username}`, icon: '/icons/icon-192.png' });
    }
  });

  ws.on('close', () => {
    // если был кикнут — клиент уже удалён, broadcast уже был
    if (user && !ws._kicked) {
      clients.delete(ws);
      broadcast({ type: 'users', users: getUserList() });
    }
  });

  ws.on('error', () => { if (user) clients.delete(ws); });
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  server.listen(PORT, () => console.log(`Server on :${PORT}`));
}
