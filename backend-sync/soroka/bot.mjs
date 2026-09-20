#!/usr/bin/env node
// SorokaBjastovna — телеграм-бот JAPERDAIS.
// Живёт в группе/теме и реагирует только на сообщения вида «/void текст
// запроса» — остальную переписку в чате игнорирует. Запрос складывается
// в data/requests.json, откуда разработчик его читает и обсуждает с
// автором прямо в той же теме. Рассылка новостей об изменениях — notify.mjs.
// Работает long polling'ом — никакого вебхука и nginx не нужно.
// Запуск: node bot.mjs (токен — в sync/soroka/.env, см. env.example).
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(HERE, 'data')
mkdirSync(DATA_DIR, { recursive: true })
const SUBS_FILE = join(DATA_DIR, 'subscribers.json')
const REQ_FILE = join(DATA_DIR, 'requests.json')
const OFFSET_FILE = join(DATA_DIR, 'offset.txt')

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
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID || loadEnv().ALLOWED_USER_ID) || null
const MINIAPP_URL = process.env.MINIAPP_URL || loadEnv().MINIAPP_URL || 'https://japerdais.malliol.ru/soroka/'

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function saveJson(file, obj) {
  writeFileSync(file + '.tmp', JSON.stringify(obj, null, 1), 'utf8')
  renameSync(file + '.tmp', file)
}

let offset = existsSync(OFFSET_FILE) ? Number(readFileSync(OFFSET_FILE, 'utf8')) || 0 : 0

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  return res.json()
}

// подписчик — это пара (чат, тема); дедуплицируем именно по связке,
// т.к. в одной группе бот может стоять в нескольких темах
function subKey(chatId, threadId) { return `${chatId}:${threadId || 0}` }

function chatDisplayName(chat) {
  return chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id)
}

// подписчики и заявки читаются с диска заново перед каждой записью —
// mini-app API (соседний процесс) правит те же файлы независимо, и если
// держать их в памяти с момента запуска, наше сохранение затирает его
// изменения (например, "воскрешает" уже удалённую через панель заявку)
function addSubscriber(chat, threadId) {
  const subs = loadJson(SUBS_FILE, [])
  const key = subKey(chat.id, threadId)
  const existing = subs.find(s => subKey(s.chatId, s.threadId) === key)
  const title = chatDisplayName(chat)
  if (existing) {
    // название могло смениться (переименовали группу) — обновляем
    if (existing.title !== title || existing.type !== chat.type) {
      existing.title = title
      existing.type = chat.type
      saveJson(SUBS_FILE, subs)
    }
    return
  }
  subs.push({ chatId: chat.id, threadId: threadId || null, title, type: chat.type, since: new Date().toISOString() })
  saveJson(SUBS_FILE, subs)
  log(`новая тема подписана: ${title} (thread ${threadId || '-'})`)
}

function addRequest(chatId, threadId, username, firstName, text) {
  const requests = loadJson(REQ_FILE, [])
  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  requests.push({ id, chatId, threadId: threadId || null, username: username || '', firstName: firstName || '', text, ts: new Date().toISOString(), status: 'new' })
  saveJson(REQ_FILE, requests)
  return id
}

const STATUS_LABEL = { new: '🆕 новый', discussing: '💬 обсуждаем', done: '✅ сделано', declined: '➖ отклонено' }

const INFO = [
  'Я Сорока Бjастовна.',
  '',
  'Слежу за изменениями в JAPERDAIS DevSpace и на референс-борде — присылаю сюда новости, когда что-то меняется.',
  '',
  'Обычные сообщения в этой теме я не читаю — переписывайтесь спокойно, я не буду мешать.',
  '',
  'Чтобы оставить запрос на изменение (пожелание, баг, идею), напиши команду в одном сообщении:',
  '/void текст запроса',
  '',
  'Например: /void сделай кнопки на референс-борде покрупнее',
  '',
  'Команды:',
  '/void <текст> — оставить запрос разработчику',
  '/status — список твоих последних запросов и их статус',
  '/inf — эта инструкция'
].join('\n')

async function handleUpdate(u) {
  const msg = u.message
  if (!msg || !msg.chat) return
  const chatId = msg.chat.id
  const threadId = msg.message_thread_id
  const username = msg.from && msg.from.username
  const firstName = msg.from && msg.from.first_name
  const text = (msg.text || '').trim()
  const reply = extra => tg('sendMessage', { chat_id: chatId, message_thread_id: threadId, ...extra })

  if (text === '/start' || text === '/inf') {
    addSubscriber(msg.chat, threadId)
    await reply({ text: INFO })
    return
  }

  if (text === '/app') {
    if (!ALLOWED_USER_ID || (msg.from && msg.from.id) !== ALLOWED_USER_ID) return // тихо игнорируем чужих
    await reply({
      text: 'Панель управления:',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть панель', web_app: { url: MINIAPP_URL } }]] }
    })
    return
  }

  const voidMatch = text.match(/^\/void(?:@\w+)?\s+([\s\S]+)/i)
  if (voidMatch) {
    addSubscriber(msg.chat, threadId)
    const id = addRequest(chatId, threadId, username, firstName, voidMatch[1].trim())
    log(`новый запрос ${id} от ${firstName || username || chatId}: ${voidMatch[1].slice(0, 80)}`)
    await reply({ text: `Принято ✓ (${id})\nПередала разработчику, обсудим и вернёмся с ответом.` })
    return
  }
  if (/^\/void(?:@\w+)?\s*$/i.test(text)) {
    await reply({ text: 'Напиши запрос в этом же сообщении: /void текст запроса' })
    return
  }

  if (text === '/status') {
    const requests = loadJson(REQ_FILE, [])
    const mine = requests.filter(r => r.chatId === chatId && (r.threadId || null) === (threadId || null)).slice(-10)
    if (!mine.length) {
      await reply({ text: 'Пока нет запросов из этой темы — оставь через /void текст запроса.' })
      return
    }
    const lines = mine.map(r => `${STATUS_LABEL[r.status] || r.status} · ${new Date(r.ts).toLocaleDateString('ru-RU')}\n${r.text}`)
    await reply({ text: lines.join('\n\n') })
    return
  }

  // всё остальное — обычная переписка в теме, не наше дело
}

async function poll() {
  for (;;) {
    try {
      const res = await tg('getUpdates', { offset: offset + 1, timeout: 25 })
      if (res.ok && res.result.length) {
        for (const u of res.result) {
          offset = u.update_id
          await handleUpdate(u).catch(e => log('ОШИБКА обработки: ' + e.message))
        }
        writeFileSync(OFFSET_FILE, String(offset), 'utf8')
      }
    } catch (e) {
      log('ОШИБКА опроса: ' + e.message)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}

log('SorokaBjastovna запущена')
poll()
