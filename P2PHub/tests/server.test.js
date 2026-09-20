import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { server } from '../server.js';

const PORT = 3099; // тестовый порт
const BASE = `http://localhost:${PORT}`;
const WS   = `ws://localhost:${PORT}`;

// --- helpers ---

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

function wsConnect(username) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', username }));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

// Буферизует все входящие сообщения, позволяет искать по типу
function makeCollector(ws) {
  const buf = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (waiters.length) waiters.shift()(msg);
    else buf.push(msg);
  });
  return {
    next(timeout = 2000) {
      return new Promise((resolve, reject) => {
        if (buf.length) return resolve(buf.shift());
        const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeout);
        waiters.push(msg => { clearTimeout(t); resolve(msg); });
      });
    },
    // ждёт конкретный тип, пропуская остальные
    async find(type, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const msg = await this.next(deadline - Date.now());
        if (msg.type === type) return msg;
      }
      throw new Error(`timeout waiting for type=${type}`);
    },
  };
}

// --- setup ---

before(() => new Promise((resolve, reject) => {
  server.listen(PORT, resolve);
  server.on('error', reject);
}));

after(() => new Promise((resolve) => {
  server.close(resolve);
  if (existsSync('./subscriptions.json')) rmSync('./subscriptions.json');
}));

// ===== VAPID =====

describe('GET /api/vapid-public-key', () => {
  it('возвращает публичный ключ', async () => {
    const { status, body } = await get('/api/vapid-public-key');
    assert.equal(status, 200);
    assert.ok(body.key);
    assert.equal(typeof body.key, 'string');
  });
});

// ===== SUBSCRIBE =====

describe('POST /api/subscribe', () => {
  after(() => { if (existsSync('./subscriptions.json')) rmSync('./subscriptions.json'); });

  it('принимает подписку', async () => {
    const sub = { endpoint: 'https://push.example.com/1', keys: { p256dh: 'abc', auth: 'def' } };
    const { status, body } = await post('/api/subscribe', sub);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it('не дублирует одинаковый endpoint', async () => {
    const sub = { endpoint: 'https://push.example.com/2', keys: { p256dh: 'abc', auth: 'def' } };
    await post('/api/subscribe', sub);
    await post('/api/subscribe', sub);
    const { readFileSync } = await import('node:fs');
    const subs = JSON.parse(readFileSync('./subscriptions.json', 'utf8'));
    assert.equal(subs.filter(s => s.endpoint === sub.endpoint).length, 1);
  });

  it('отклоняет подписку без endpoint', async () => {
    const { status } = await post('/api/subscribe', { keys: { p256dh: 'abc', auth: 'def' } });
    assert.equal(status, 400);
  });
});

// ===== WEBSOCKET =====

describe('WebSocket', () => {
  it('новый клиент получает список онлайн', async () => {
    const ws = await wsConnect('ТестЮзер');
    const c = makeCollector(ws);
    const msg = await c.find('users');
    assert.ok(msg.users.some(u => u.username === 'ТестЮзер'));
    ws.terminate();
  });

  it('при отключении список обновляется у остальных', async () => {
    const ws1 = await wsConnect('Юзер1');
    const c1 = makeCollector(ws1);
    await c1.find('users');

    const ws2 = await wsConnect('Юзер2');
    const c2 = makeCollector(ws2);
    await c2.find('users');
    await c1.find('users'); // broadcast когда ws2 присоединился

    ws2.terminate();
    const update = await c1.find('users');
    assert.ok(!update.users.some(u => u.username === 'Юзер2'));
    ws1.terminate();
  });

  it('второй вход с тем же ником кикает первое устройство', async () => {
    const ws1 = await wsConnect('КикМи');
    const c1 = makeCollector(ws1);
    await c1.find('users');

    const ws2 = await wsConnect('КикМи');
    const c2 = makeCollector(ws2);
    await c2.find('users');

    const kicked = await c1.find('kicked');
    assert.equal(kicked.type, 'kicked');
    ws2.terminate();
  });

  it('пиздец рассылается всем', async () => {
    const ws1 = await wsConnect('Пж1');
    const c1 = makeCollector(ws1);
    await c1.find('users');

    const ws2 = await wsConnect('Пж2');
    const c2 = makeCollector(ws2);
    await c2.find('users');
    await c1.find('users'); // broadcast когда ws2 присоединился

    ws2.send(JSON.stringify({ type: 'pizdets' }));
    const msg = await c1.find('pizdets');
    assert.equal(msg.username, 'Пж2');
    ws1.terminate();
    ws2.terminate();
  });
});
