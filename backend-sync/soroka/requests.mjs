#!/usr/bin/env node
// Служебная утилита для разработчика — смотреть и обновлять очередь
// запросов от пользователей бота (data/requests.json).
//   node requests.mjs                        — показать все запросы
//   node requests.mjs new                     — только новые
//   node requests.mjs status <id> discussing  — сменить статус
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REQ_FILE = join(HERE, 'data', 'requests.json')
const STATUSES = ['new', 'discussing', 'done', 'declined']

function load() { return existsSync(REQ_FILE) ? JSON.parse(readFileSync(REQ_FILE, 'utf8')) : [] }
function save(list) {
  writeFileSync(REQ_FILE + '.tmp', JSON.stringify(list, null, 1), 'utf8')
  renameSync(REQ_FILE + '.tmp', REQ_FILE)
}
function print(list) {
  if (!list.length) { console.log('пусто'); return }
  for (const r of list) {
    console.log(`[${r.status}] ${r.id} · ${r.ts} · ${r.firstName || r.username || r.chatId}`)
    console.log(`  ${r.text}`)
  }
}

const [cmd, a, b] = process.argv.slice(2)

if (cmd === 'status') {
  const list = load()
  const r = list.find(x => x.id === a)
  if (!r) { console.error('не найден запрос:', a); process.exit(1) }
  if (!STATUSES.includes(b)) { console.error('статус должен быть одним из:', STATUSES.join(', ')); process.exit(1) }
  r.status = b
  save(list)
  console.log('обновлено:', r.id, '->', b)
} else if (cmd === 'new') {
  print(load().filter(r => r.status === 'new'))
} else {
  print(load())
}
