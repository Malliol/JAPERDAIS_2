#!/usr/bin/env node
// Разослать сообщение об изменении всем, кто писал боту (обновление,
// изменившее DevSpace или референс-борд). Запуск:
//   node notify.mjs "Текст того, что изменилось"
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

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
const TOKEN = process.env.BOT_TOKEN || loadEnv().BOT_TOKEN
if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('BOT_TOKEN не задан — открой sync/soroka/.env и вставь токен от @BotFather')
  process.exit(1)
}
const API = `https://api.telegram.org/bot${TOKEN}`

const text = process.argv.slice(2).join(' ').trim()
if (!text) {
  console.error('Использование: node notify.mjs "текст изменения"')
  process.exit(1)
}

const subsFile = join(HERE, 'data', 'subscribers.json')
const subs = existsSync(subsFile) ? JSON.parse(readFileSync(subsFile, 'utf8')) : []
if (!subs.length) {
  console.log('Подписчиков пока нет — никто ещё не писал боту /start.')
  process.exit(0)
}

for (const s of subs) {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: s.chatId, message_thread_id: s.threadId || undefined, text: `Обновление JAPERDAIS DevSpace\n\n${text}` })
  }).then(r => r.json())
  console.log(s.title || s.chatId, '->', res.ok ? 'ok' : res.description)
}
