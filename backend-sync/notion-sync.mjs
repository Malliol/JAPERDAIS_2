#!/usr/bin/env node
// Синхронизация контента из Notion в data/workspace.json.
// Забирает все страницы, которые расшарены интеграции (Connections → ваша интеграция),
// конвертирует блоки в формат DevSpace, скачивает картинки локально и атомарно
// перезаписывает workspace.json. Запуск: node notion-sync.mjs (токен — в .env рядом).
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HTML_DIR = process.env.DEVSPACE_HTML || join(HERE, '..', 'html')
const DATA_DIR = join(HTML_DIR, 'data')
const IMG_DIR = join(DATA_DIR, 'notion')
const OUT = join(DATA_DIR, 'workspace.json')
const LOG = join(HERE, 'sync.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// --- .env ---
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
const TOKEN = process.env.NOTION_TOKEN || env.NOTION_TOKEN

if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  log('NOTION_TOKEN не задан. Открой sync/.env и вставь Internal Integration Secret (notion.so/my-integrations). Выход без изменений.')
  process.exit(0)
}

// --- Notion API с ретраями и rate limit ---
const API = 'https://api.notion.com/v1'
let lastCall = 0
async function notion(path, opts = {}) {
  const wait = 340 - (Date.now() - lastCall)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCall = Date.now()
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    })
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get('retry-after')) || attempt * 2
      log(`HTTP ${res.status} на ${path}, повтор через ${retry}с (попытка ${attempt})`)
      await new Promise(r => setTimeout(r, retry * 1000))
      continue
    }
    if (!res.ok) throw new Error(`Notion API ${res.status} ${path}: ${await res.text()}`)
    return res.json()
  }
  throw new Error('Notion API: исчерпаны попытки для ' + path)
}

// --- картинки ---
mkdirSync(IMG_DIR, { recursive: true })
const downloaded = new Map()
async function localImage(url) {
  if (!url) return null
  const clean = url.split('?')[0]
  if (downloaded.has(clean)) return downloaded.get(clean)
  const extM = clean.match(/\.(jpe?g|png|gif|webp|svg|avif)$/i)
  const ext = extM ? extM[0].toLowerCase() : '.jpg'
  const name = createHash('sha1').update(clean).digest('hex').slice(0, 16) + ext
  const rel = 'data/notion/' + name
  const abs = join(IMG_DIR, name)
  if (!existsSync(abs)) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      writeFileSync(abs, Buffer.from(await res.arrayBuffer()))
      log(`картинка: ${name}`)
    } catch (e) {
      log(`не скачалась картинка ${clean}: ${e.message}`)
      downloaded.set(clean, url) // оставляем внешний URL как есть
      return url
    }
  }
  downloaded.set(clean, rel)
  return rel
}

// --- rich text ---
function spans(rt) {
  if (!rt || rt.length === 0) return ''
  const out = rt.map(r => {
    const a = r.annotations || {}
    const sp = { t: r.plain_text || '' }
    if (a.bold) sp.b = 1
    if (a.italic) sp.i = 1
    if (a.code) sp.c = 1
    if (a.strikethrough) sp.s = 1
    if (a.underline) sp.u = 1
    if (r.href) sp.a = r.href
    return sp
  })
  if (out.every(sp => Object.keys(sp).length === 1)) return out.map(sp => sp.t).join('')
  return out
}

const fileUrl = f => f ? (f.type === 'external' ? f.external.url : f.file && f.file.url) : null

// --- блоки ---
async function fetchChildren(blockId) {
  let results = []
  let cursor
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100'
    const res = await notion(`/blocks/${blockId}/children${q}`)
    results = results.concat(res.results)
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)
  return results
}

const childPagesFound = [] // {id, parentPage, order}

async function mapBlocks(raw, pageId) {
  const out = []
  for (const b of raw) {
    const t = b.type
    const v = b[t] || {}
    let block = null
    switch (t) {
      case 'paragraph': block = { type: 'paragraph', text: spans(v.rich_text) }; break
      case 'heading_1': case 'heading_2': case 'heading_3':
        block = { type: t, text: spans(v.rich_text) }; break
      case 'bulleted_list_item': case 'numbered_list_item':
        block = { type: t, text: spans(v.rich_text) }; break
      case 'to_do':
        block = { type: 'bulleted_list_item', text: (v.checked ? '☑ ' : '☐ ') + richPlain(v.rich_text) }; break
      case 'quote': block = { type: 'quote', text: spans(v.rich_text) }; break
      case 'callout':
        block = {
          type: 'callout',
          props: { icon: v.icon && v.icon.type === 'emoji' ? v.icon.emoji : '💡' },
          text: spans(v.rich_text)
        }; break
      case 'divider': block = { type: 'divider' }; break
      case 'code':
        block = { type: 'code', props: { language: v.language }, text: richPlain(v.rich_text) }; break
      case 'image': {
        const src = await localImage(fileUrl(v))
        block = { type: 'image', props: { src }, text: v.caption && v.caption.length ? spans(v.caption) : undefined }
        break
      }
      case 'bookmark':
        block = { type: 'bookmark', props: { url: v.url }, text: v.caption && v.caption.length ? spans(v.caption) : v.url }; break
      case 'toggle': block = { type: 'toggle', text: spans(v.rich_text) }; break
      case 'child_page':
        childPagesFound.push({ id: b.id.replace(/-/g, ''), parentPage: pageId, order: out.length })
        continue // страница появится в дереве сама
      case 'table': {
        const rows = await fetchChildren(b.id)
        block = {
          type: 'table',
          props: {
            hasHeader: !!v.has_column_header,
            rows: rows.filter(r => r.type === 'table_row').map(r => r.table_row.cells.map(spans))
          }
        }
        break
      }
      case 'column_list': case 'column': case 'synced_block': {
        const kids = await mapBlocks(await fetchChildren(b.id), pageId)
        out.push(...kids)
        continue
      }
      case 'video': case 'embed': case 'file': case 'pdf': {
        const url = v.url || fileUrl(v)
        if (url) block = { type: 'bookmark', props: { url }, text: t + ': ' + url }
        break
      }
      default:
        if (v.rich_text && v.rich_text.length) block = { type: 'paragraph', text: spans(v.rich_text) }
    }
    if (!block) continue
    if (b.has_children && !['table', 'child_page', 'column_list', 'column', 'synced_block'].includes(t)) {
      block.children = await mapBlocks(await fetchChildren(b.id), pageId)
    }
    out.push(block)
  }
  return out
}
const richPlain = rt => (rt || []).map(r => r.plain_text || '').join('')

// --- страницы ---
async function run() {
  log('=== старт синхронизации ===')
  let pagesRaw = []
  let cursor
  do {
    const res = await notion('/search', {
      method: 'POST',
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      })
    })
    pagesRaw = pagesRaw.concat(res.results)
    cursor = res.has_more ? res.next_cursor : null
  } while (cursor)

  pagesRaw = pagesRaw.filter(p => !p.archived && !p.in_trash)
  log(`страниц доступно: ${pagesRaw.length}`)
  if (pagesRaw.length === 0) {
    log('Notion не вернул ни одной страницы — проверь, что страницы расшарены интеграции (… → Connections). workspace.json не тронут.')
    return
  }

  const knownIds = new Set(pagesRaw.map(p => p.id.replace(/-/g, '')))
  const notionPages = []
  for (const pr of pagesRaw) {
    const id = pr.id.replace(/-/g, '')
    const titleProp = Object.values(pr.properties || {}).find(x => x.type === 'title')
    const title = richPlain(titleProp && titleProp.title) || 'Без названия'
    log(`страница: ${title}`)
    const parentRaw = pr.parent && pr.parent.type === 'page_id' ? pr.parent.page_id.replace(/-/g, '') : null
    const cover = pr.cover ? await localImage(fileUrl(pr.cover)) : undefined
    const icon = pr.icon && pr.icon.type === 'emoji' ? pr.icon.emoji : undefined
    const blocks = await mapBlocks(await fetchChildren(pr.id), id)
    notionPages.push({
      id, title, icon, cover,
      parent: parentRaw && knownIds.has(parentRaw) ? parentRaw : null,
      updated: (pr.last_edited_time || '').slice(0, 10),
      origin: 'notion',
      blocks
    })
  }

  // порядок детей — как в родительской странице (child_page блоки)
  const orderMap = new Map(childPagesFound.map(c => [c.id, c.order]))
  notionPages.sort((a, b) => {
    if (a.parent !== b.parent) return 0
    return (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999)
  })

  // Слияние: затравочные (seed) и созданные на сайте (custom) страницы остаются,
  // Notion-страницы обновляются целиком.
  let keptPages = []
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf8'))
      keptPages = (prev.pages || []).filter(p => p.origin !== 'notion')
    } catch (e) {
      log('не смог прочитать старый workspace.json (' + e.message + '), продолжаю без слияния')
    }
  }
  const pages = [...keptPages, ...notionPages]
  log(`слияние: сохранено локальных страниц ${keptPages.length}, из Notion ${notionPages.length}`)

  // --- убираем дублирование информации в досье персонажей ---
  // Notion-страницы «ПОДРОБНЕЕ ПРО X» и «Персонажи» содержат сырые таблицы
  // (Досье, Характеристики, Мнения), которые повторяют то, что DevSpace уже
  // рисует красиво сам (шапка персонажа, полоски статов, раскрывающиеся
  // цитаты «Мнения о...»). Вырезаем эти таблицы, оставляя только уникальный
  // текст: биографию, факты, цитаты.
  const dossierPlain = t => typeof t === 'string' ? t : (t || []).map(s => s.t || '').join('')
  const DOSSIER_KEYS = ['возраст', 'рост', 'национальность', 'мировоззрение', 'темперамент', 'семья', 'семейное положение', 'ориентация', 'знак зодиака']
  function isDossierTable(t) {
    const rows = (t.props && t.props.rows) || []
    if (!rows.length) return false
    const keys = (t.props.hasHeader ? rows.slice(1) : rows).map(r => dossierPlain(r[0]).trim().toLowerCase())
    return keys.filter(k => DOSSIER_KEYS.includes(k)).length >= 3
  }
  function isStatsTable(t) {
    const rows = (t.props && t.props.rows) || []
    if (!rows.length) return false
    const head = rows[0].map(c => dossierPlain(c).trim().toLowerCase())
    return ['сила', 'здоровье', 'скорость', 'стамина'].every(k => head.includes(k))
  }
  function isOpinionRestateTable(t) {
    const rows = (t.props && t.props.rows) || []
    if (!rows.length) return false
    const head = rows[0].map(c => dossierPlain(c).trim().toLowerCase())
    return head.some(h => h.includes('персонаж'))
  }
  function dedupeCharacterBlocks(blocks) {
    const out = []
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.type === 'heading_2' && dossierPlain(b.text).trim() === 'Досье' && blocks[i + 1] && blocks[i + 1].type === 'table' && isDossierTable(blocks[i + 1])) { i++; continue }
      if (b.type === 'table' && isDossierTable(b)) continue
      if (b.type === 'heading_2' && dossierPlain(b.text).trim() === 'Характеристики' && blocks[i + 1] && blocks[i + 1].type === 'table' && isStatsTable(blocks[i + 1])) { i++; continue }
      if (b.type === 'table' && isStatsTable(b)) continue
      if (b.type === 'table' && isOpinionRestateTable(b)) continue
      out.push(b)
    }
    return out
  }
  for (const p of pages) {
    if (Array.isArray(p.blocks) && p.blocks.length) p.blocks = dedupeCharacterBlocks(p.blocks)
  }

  // --- расширенная дедупликация досье (после слияния «ПОДРОБНЕЕ») ---
  // Notion повторяет структурированные поля (возраст/рост/...), статы и факты
  // ещё раз другими типами блоков (heading_3-справка, каллауты-проценты,
  // вторая серия фактов), а раздел «Внешность» дублирует уже показанную
  // кураторскую «Галерею» теми же (или похожими) референс-фото. Применяется
  // только к карточкам персонажей (id начинается с char_), чтобы не задеть
  // остальной контент сайта.
  const norm = t => dossierPlain(t).trim().toLowerCase()
  const DOSSIER_HEAD_RE = /^(деятельность|возраст|рост|национальность|мировоззрение|темперамент|статус личного фронта|семья|семейное положение|ориентация|знак зодиака)\s*:/i
  const STATS_LABEL_RE = /^статы(\s+персонажа)?\s*:?$/i
  const STATS_CALLOUT_RE = /\d+\s*%/ // допускаем опечатки в названии статы (встречается латинская "C" вместо "С")
  const FACTS_HEAD_RE = /факт/i
  const HEADING_LVL = { heading_1: 1, heading_2: 2, heading_3: 3 }
  function dedupeMore(blocks) {
    let b = blocks.slice()
    { // heading_3-серия "Возраст: / Рост: / ..." — дублирует шапку персонажа
      const out = []
      for (let i = 0; i < b.length; i++) {
        if (b[i].type === 'heading_3' && DOSSIER_HEAD_RE.test(dossierPlain(b[i].text).trim())) {
          let j = i, hits = 0
          while (j < b.length && (
            (b[j].type === 'heading_3' && DOSSIER_HEAD_RE.test(dossierPlain(b[j].text).trim())) ||
            (b[j].type === 'paragraph' && dossierPlain(b[j].text).trim() === '')
          )) { if (b[j].type === 'heading_3') hits++; j++ }
          if (hits >= 3) { i = j - 1; continue }
        }
        out.push(b[i])
      }
      b = out
    }
    { // "Статы персонажа:" + каллауты-проценты — дублирует полоски статов
      const out = []
      for (let i = 0; i < b.length; i++) {
        if (b[i].type === 'paragraph' && STATS_LABEL_RE.test(dossierPlain(b[i].text).trim())) {
          let j = i + 1, hits = 0
          while (j < b.length && b[j].type === 'callout' && STATS_CALLOUT_RE.test(dossierPlain(b[j].text).trim())) { j++; hits++ }
          if (hits >= 2) { i = j - 1; continue }
        }
        out.push(b[i])
      }
      b = out
    }
    { // повтор "Факты" — вторая серия bulleted_list_item, пересекающаяся с первой
      let primary = null
      const out = []
      for (let i = 0; i < b.length; i++) {
        if (HEADING_LVL[b[i].type] && FACTS_HEAD_RE.test(dossierPlain(b[i].text))) {
          let j = i + 1
          const items = []
          while (j < b.length && (b[j].type === 'bulleted_list_item' || (b[j].type === 'paragraph' && dossierPlain(b[j].text).trim() === ''))) {
            if (b[j].type === 'bulleted_list_item') items.push(norm(b[j].text).slice(0, 60))
            j++
          }
          if (primary === null) {
            primary = new Set(items)
            out.push(b[i]); for (let k = i + 1; k < j; k++) out.push(b[k])
          } else {
            const overlap = items.filter(t => primary.has(t)).length
            if (!(items.length && overlap / items.length >= 0.6)) { out.push(b[i]); for (let k = i + 1; k < j; k++) out.push(b[k]) }
          }
          i = j - 1
          continue
        }
        out.push(b[i])
      }
      b = out
    }
    { // повтор "Происхождение имени" одиночным блоком вне toggle
      const nameOriginTexts = []
      for (const blk of b) {
        if (blk.type === 'toggle' && norm(blk.text) === 'происхождение имени') {
          for (const c of blk.children || []) nameOriginTexts.push(norm(c.text).slice(0, 50))
        }
      }
      if (nameOriginTexts.length) {
        b = b.filter(blk => {
          if (blk.type !== 'code' && blk.type !== 'paragraph') return true
          return !nameOriginTexts.includes(norm(blk.text).slice(0, 50))
        })
      }
    }
    { // раздел "Внешность" дублирует уже показанную кураторскую "Галерею"
      if (b.some(blk => blk.type === 'gallery')) {
        const out = []
        for (let i = 0; i < b.length; i++) {
          if ((b[i].type === 'heading_2' || b[i].type === 'heading_1') && norm(b[i].text) === 'внешность') {
            let j = i + 1
            while (j < b.length && !(HEADING_LVL[b[j].type] && HEADING_LVL[b[j].type] <= 2)) j++
            i = j - 1
            continue
          }
          out.push(b[i])
        }
        b = out
      }
    }
    { // заголовок-остаток "Отношение к другим персонажам:" — ссылался на уже убранные таблицы мнений
      const out = []
      for (let i = 0; i < b.length; i++) {
        if (HEADING_LVL[b[i].type] && /^отношение к (другим )?персонаж/i.test(norm(b[i].text))) {
          let j = i + 1
          while (j < b.length && b[j].type === 'paragraph' && /^как (он|она|о нём|о ней)/i.test(norm(b[j].text))) j++
          i = j - 1
          continue
        }
        out.push(b[i])
      }
      b = out
    }
    { // осиротевшие пустые заголовки, оставшиеся после всех вырезок
      const isEmptyish = blk => blk.type === 'paragraph' && dossierPlain(blk.text).trim() === ''
      let changed = true
      while (changed) {
        changed = false
        const out = []
        for (let i = 0; i < b.length; i++) {
          const lvl = HEADING_LVL[b[i].type]
          if (lvl) {
            let j = i + 1
            while (j < b.length && !(HEADING_LVL[b[j].type] && HEADING_LVL[b[j].type] <= lvl) && isEmptyish(b[j])) j++
            const hasContent = j < b.length && !(HEADING_LVL[b[j].type] && HEADING_LVL[b[j].type] <= lvl)
            if (!hasContent) { i = j - 1; changed = true; continue }
          }
          out.push(b[i])
        }
        b = out
      }
    }
    return b
  }

  // --- «ПОДРОБНЕЕ ПРО X» вливаем в карточки персонажей ---
  // Контент из Notion дописывается в конец seed-карточки (блоки помечаются
  // _notionDetail и при каждом синке заменяются свежими), отдельная страница
  // из бокового меню убирается.
  const DETAIL_TO_CARD = {
    'КРЕОНО': 'char_kreono', 'САИДУ': 'char_saida', 'ЭРКЮЛЯ': 'char_erkul',
    'ЕВГЕНИЯ': 'char_evgeny', 'УНУРУ': 'char_unura', 'КАТЕРИНЕ': 'char_katerina',
    'ЮРГЕНА': 'char_jurgen', 'ЛОГАНЕ': 'char_logan', 'СИЛЬВИИ': 'char_silvia',
    'ПАТРИЦИО': 'char_patricio', 'МАРКУСА': 'char_markus', 'КАН СО': 'char_kan_so'
  }
  let mergedCount = 0
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i]
    const m = p.origin === 'notion' && (p.title || '').trim().match(/^ПОДРОБНЕЕ ПРО\s+(.+)$/)
    const card = m && pages.find(q => q.id === DETAIL_TO_CARD[m[1].trim()])
    if (!card) continue
    // выкидываем прошлую влитую секцию (по флагу или по заголовку-маркеру)
    let cut = (card.blocks || []).findIndex(b => b._notionDetail ||
      (b.type === 'heading_1' && /^(📎 )?Подробнее/.test(String(b.text))))
    if (cut === -1) cut = (card.blocks || []).length
    card.blocks = (card.blocks || []).slice(0, cut).filter(b => !b._notionDetail)
    card.blocks.push(
      { type: 'heading_1', text: 'Подробнее', _notionDetail: 1 },
      ...p.blocks.map(b => ({ ...b, _notionDetail: 1 }))
    )
    card.blocks = dedupeMore(card.blocks)
    pages.splice(i, 1)
    mergedCount++
  }
  if (mergedCount) log(`влито в карточки персонажей: ${mergedCount} страниц «ПОДРОБНЕЕ»`)

  // --- скрытые страницы ---
  // Убраны из DevSpace по просьбе владельца (не для этого сайта / дубли / пустышки),
  // в Notion остаются. Потомки скрытых страниц тоже скрываются.
  const HIDDEN_PAGES = new Set([
    '39090f39590380f4bf27c3b7edc410a3', // JAPERDAIS (внешняя)
    '001ec5c2156e4c5b8aef8759ab89a537', // JAPERDAIS (вложенная)
    '37c90f39590380629154f1e49101832e', // Живые организмы в “субъектах” (пустая)
    '37c90f39590380558612dc89b49e4402', // Болезни “cубъектов” (пустая)
    '37c90f39590380989eb0ca8d2b51451f', // Устройство мира (дубль seed-страницы)
    '37690f395903800888e2c99fac51e926', // Персонажи (дубль seed-страницы)
    '37690f39590380bf8456c22423bd8860', // Геймплей
    '38d90f395903809881d9e052a392c239', // Всякое старое отребье («хлам»)
    '541873458cae44f4b1d12de5ba6afd77', // Кто-то
    '95617ef322c545648002d56d56149fe1', // Без названия
    '9171c0678a684747902fd405f37dc725', // Красная долина
    '7869c11cfdc94e25b55f2b3bf6280594', // Жёлтые степи
    '632d47ba57914fa0a828e5c55225f7d7', // Арахнозар
    '4cdb5ad51c4741219ea2f491753a4afc', // Арахнофос
    '0bdd850f2e984c4b9a0f58ba87bf87a1', // Арахноипсус
    '60ca7a90138149f781f35cab0901e491', // Грибная долина
    'a9874e99a60640dfa5de2de0fe56fe41', // Скалистая долина
    'devspace-folder-arhiv',            // бывшая папка АРХИВ
    'devspace-folder-flora'             // бывшая папка Флора и фауна
  ])
  const HIDDEN_TITLES = [/^жаргон$/i, /^архив$/i, /^флора и фауна$/i, /отребье/i]
  const isHidden = p => HIDDEN_PAGES.has(p.id) || HIDDEN_TITLES.some(rx => rx.test((p.title || '').trim()))
  const beforeHide = pages.length
  // сначала прямые совпадения, затем каскадом всех потомков
  let removedIds = new Set()
  for (let i = pages.length - 1; i >= 0; i--) {
    if (isHidden(pages[i])) { removedIds.add(pages[i].id); pages.splice(i, 1) }
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i].parent && removedIds.has(pages[i].parent)) {
        removedIds.add(pages[i].id); pages.splice(i, 1); changed = true
      }
    }
  }
  if (pages.length < beforeHide) log(`скрыто страниц (с потомками): ${beforeHide - pages.length}`)
  // подстраховка: если у страницы пропал родитель по другой причине — поднимаем в корень
  const idSet = new Set(pages.map(p => p.id))
  for (const p of pages) {
    if (p.parent && !idSet.has(p.parent)) p.parent = null
  }

  const workspace = {
    meta: {
      workspace: 'JAPERDAIS',
      source: 'notion',
      generated: new Date().toISOString(),
      lastSync: new Date().toISOString().slice(0, 16).replace('T', ' ')
    },
    pages
  }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT + '.tmp', JSON.stringify(workspace, null, 1), 'utf8')
  renameSync(OUT + '.tmp', OUT)
  log(`=== готово: ${pages.length} страниц → ${OUT} ===`)
}

run().catch(e => { log('ОШИБКА: ' + (e.stack || e.message)); process.exit(1) })
