#!/usr/bin/env node
// Сервер мини-приложения SorokaBjastovna: отдаёт статику панели и её API.
// Каждый запрос несёт initData от Telegram — подпись проверяется тем же
// токеном бота (HMAC-SHA256, см. verifyInitData), доступ разрешён только
// ALLOWED_USER_ID. Слушает только 127.0.0.1 — наружу через nginx (/soroka/).
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(HERE, 'data')
const REQ_FILE = join(DATA_DIR, 'requests.json')
const SUBS_FILE = join(DATA_DIR, 'subscribers.json')
const STATIC_DIR = join(HERE, 'miniapp')
const PORT = 3018

function loadEnv() {
  const envPath = join(HERE, '.env')
  if (!existsSync(envPath)) return {}
  const out = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = loadEnv()
const TOKEN = process.env.BOT_TOKEN || env.BOT_TOKEN
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID || env.ALLOWED_USER_ID) || null
if (!TOKEN) { console.error('BOT_TOKEN не задан в sync/soroka/.env'); process.exit(1) }
if (!ALLOWED_USER_ID) { console.error('ALLOWED_USER_ID не задан в sync/soroka/.env'); process.exit(1) }
const TG_API = `https://api.telegram.org/bot${TOKEN}`

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function saveJson(file, obj) {
  writeFileSync(file + '.tmp', JSON.stringify(obj, null, 1), 'utf8')
  renameSync(file + '.tmp', file)
}

// --- проверка подписи Telegram Web App initData ---
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`)
  const dataCheckString = pairs.join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  if (computedHash !== hash) return null
  const authDate = Number(params.get('auth_date') || 0)
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null // старше суток — просрочено
  const userJson = params.get('user')
  if (!userJson) return null
  try { return JSON.parse(userJson) } catch { return null }
}

function send(res, code, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(data)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

function serveStatic(req, res, urlPath) {
  const file = urlPath === '/' || urlPath === '' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const abs = join(STATIC_DIR, file)
  if (!abs.startsWith(STATIC_DIR) || !existsSync(abs)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' })
  res.end(readFileSync(abs))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '', size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) { req.destroy(); reject(new Error('слишком большое тело запроса')); return }
      body += chunk
    })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0]

  if (req.method === 'GET' && !url.startsWith('/api/')) {
    return serveStatic(req, res, url)
  }

  if (req.method !== 'POST' || !url.startsWith('/api/')) {
    return send(res, 404, { error: 'not found' })
  }

  let body
  try { body = await readBody(req) } catch { return send(res, 400, { error: 'некорректный JSON' }) }

  const user = verifyInitData(body.initData)
  if (!user || user.id !== ALLOWED_USER_ID) {
    return send(res, 403, { error: 'нет доступа' })
  }

  try {
    if (url === '/api/requests' && req.method === 'POST') {
      const requests = loadJson(REQ_FILE, [])
      return send(res, 200, { ok: true, requests: requests.slice().reverse() })
    }

    if (url === '/api/requests/delete') {
      const { id } = body
      if (!id) return send(res, 400, { error: 'ожидаю {id}' })
      const requests = loadJson(REQ_FILE, [])
      const next = requests.filter(r => r.id !== id)
      saveJson(REQ_FILE, next)
      log(`удалён запрос ${id}`)
      return send(res, 200, { ok: true })
    }

    if (url === '/api/chats') {
      const subs = loadJson(SUBS_FILE, [])
      return send(res, 200, { ok: true, chats: subs })
    }

    if (url === '/api/send') {
      const { chatId, threadId, text } = body
      if (!chatId || !text || !text.trim()) return send(res, 400, { error: 'ожидаю {chatId, text}' })
      const tgRes = await fetch(`${TG_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_thread_id: threadId || undefined, text: text.trim() })
      }).then(r => r.json())
      if (!tgRes.ok) return send(res, 502, { error: tgRes.description || 'Telegram отклонил сообщение' })
      log(`сообщение отправлено в чат ${chatId}${threadId ? ' (тема ' + threadId + ')' : ''}`)
      return send(res, 200, { ok: true })
    }

    return send(res, 404, { error: 'not found' })
  } catch (e) {
    log('ОШИБКА: ' + e.message)
    return send(res, 500, { error: 'ошибка сервера: ' + e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => log(`SorokaBjastovna mini-app API на 127.0.0.1:${PORT}`))
