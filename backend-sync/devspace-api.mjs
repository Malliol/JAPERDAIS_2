#!/usr/bin/env node
// Мини-API для DevSpace: сохраняет правки редактора и графа на диск.
// Слушает только 127.0.0.1:3017 — наружу отдаётся через nginx (location /api/).
// Авторизация: Authorization: Bearer <EDIT_TOKEN из .env>.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const HTML_DIR = process.env.DEVSPACE_HTML || join(HERE, '..', 'html')
const DATA_DIR = join(HTML_DIR, 'data')
const BACKUP_DIR = join(HERE, 'backups')
const REFBOARD_IMG_DIR = join(DATA_DIR, 'refboard', 'images')
const PORT = 3017

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
const EDIT_TOKEN = loadEnv().EDIT_TOKEN || ''

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

function backup(name) {
  const src = join(DATA_DIR, name)
  if (!existsSync(src)) return
  mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(join(BACKUP_DIR, `${name}.${stamp}.bak`), readFileSync(src))
  // держим не больше 30 бэкапов на файл
  const all = readdirSync(BACKUP_DIR).filter(f => f.startsWith(name + '.')).sort()
  while (all.length > 30) unlinkSync(join(BACKUP_DIR, all.shift()))
}

function saveJson(name, obj) {
  backup(name)
  const out = join(DATA_DIR, name)
  writeFileSync(out + '.tmp', JSON.stringify(obj, null, 1), 'utf8')
  renameSync(out + '.tmp', out)
}

function send(res, code, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(data)
}

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg'
}

function saveRefboardImage(buf, mime, nameHint) {
  const ext = EXT_BY_MIME[mime] || (nameHint && nameHint.match(/\.[a-z0-9]+$/i) || [''])[0] || '.jpg'
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 16)
  const fname = hash + ext
  mkdirSync(REFBOARD_IMG_DIR, { recursive: true })
  writeFileSync(join(REFBOARD_IMG_DIR, fname), buf)
  return 'data/refboard/images/' + fname
}

const server = createServer((req, res) => {
  const url = req.url.split('?')[0]

  if (req.method === 'GET' && url === '/api/health') {
    return send(res, 200, { ok: true, editTokenSet: !!EDIT_TOKEN })
  }

  const isWrite = (req.method === 'PUT' && ['/api/workspace', '/api/graph', '/api/refboard', '/api/locations'].includes(url)) ||
    (req.method === 'POST' && ['/api/refboard/upload', '/api/refboard/fetch-url'].includes(url))
  if (!isWrite) return send(res, 404, { error: 'not found' })

  if (!EDIT_TOKEN) return send(res, 503, { error: 'EDIT_TOKEN не задан в sync/.env — редактирование выключено' })
  const auth = req.headers.authorization || ''
  if (auth !== 'Bearer ' + EDIT_TOKEN) return send(res, 401, { error: 'неверный пароль редактирования' })

  let body = ''
  let size = 0
  req.on('data', chunk => {
    size += chunk.length
    if (size > 30 * 1024 * 1024) { req.destroy(); return }
    body += chunk
  })
  req.on('end', async () => {
    let obj
    try { obj = JSON.parse(body) } catch { return send(res, 400, { error: 'некорректный JSON' }) }
    try {
      if (url === '/api/workspace') {
        if (!obj || !Array.isArray(obj.pages)) return send(res, 400, { error: 'ожидаю {meta, pages[]}' })
        saveJson('workspace.json', obj)
        log(`workspace.json сохранён (${obj.pages.length} страниц)`)
      } else if (url === '/api/graph') {
        if (!obj || !Array.isArray(obj.nodes) || !Array.isArray(obj.links)) return send(res, 400, { error: 'ожидаю {nodes[], links[], types[]}' })
        saveJson('graph.json', obj)
        log(`graph.json сохранён (${obj.links.length} связей, ${(obj.types || []).length} кастомных типов)`)
      } else if (url === '/api/refboard') {
        if (!obj || !Array.isArray(obj.fields) || !Array.isArray(obj.images)) return send(res, 400, { error: 'ожидаю {fields[], images[]}' })
        saveJson('refboard.json', obj)
        log(`refboard.json сохранён (${obj.fields.length} полей, ${obj.images.length} картинок)`)
      } else if (url === '/api/locations') {
        if (!obj || !Array.isArray(obj.locations) || !Array.isArray(obj.maps) || !Array.isArray(obj.blocks)) return send(res, 400, { error: 'ожидаю {locations[], maps[], blocks[], texts[]}' })
        saveJson('locations.json', obj)
        log(`locations.json сохранён (${obj.locations.length} локаций, ${obj.maps.length} этажей, ${obj.blocks.length} блоков)`)
      } else if (url === '/api/refboard/upload') {
        // { data: 'data:image/png;base64,...', name?: 'foo.png' }
        if (!obj || typeof obj.data !== 'string') return send(res, 400, { error: 'ожидаю {data: dataURL}' })
        const m = obj.data.match(/^data:([\w/+.-]+);base64,(.+)$/s)
        if (!m) return send(res, 400, { error: 'ожидаю data URL с base64' })
        const buf = Buffer.from(m[2], 'base64')
        const src = saveRefboardImage(buf, m[1], obj.name)
        log(`refboard: загружена картинка ${src} (${(buf.length / 1024).toFixed(0)} КБ)`)
        return send(res, 200, { ok: true, src })
      } else {
        // POST /api/refboard/fetch-url — { url: 'https://...gif' } — сервер сам скачивает картинку (без CORS)
        if (!obj || typeof obj.url !== 'string') return send(res, 400, { error: 'ожидаю {url}' })
        let parsed
        try { parsed = new URL(obj.url) } catch { return send(res, 400, { error: 'некорректная ссылка' }) }
        if (!['http:', 'https:'].includes(parsed.protocol)) return send(res, 400, { error: 'разрешены только http(s)-ссылки' })
        let upstream
        try {
          upstream = await fetch(parsed, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Mozilla/5.0 (JAPERDAIS-refboard)' }
          })
        } catch (e) {
          return send(res, 502, { error: 'не удалось скачать по ссылке: ' + e.message })
        }
        if (!upstream.ok) return send(res, 502, { error: 'источник ответил ' + upstream.status })
        const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim()
        if (!mime.startsWith('image/')) return send(res, 400, { error: 'по ссылке не картинка (' + (mime || 'неизвестный тип') + ')' })
        const buf = Buffer.from(await upstream.arrayBuffer())
        if (buf.length > 25 * 1024 * 1024) return send(res, 400, { error: 'картинка больше 25 МБ' })
        const src = saveRefboardImage(buf, mime, parsed.pathname)
        log(`refboard: скачано по ссылке ${src} (${(buf.length / 1024).toFixed(0)} КБ) <- ${obj.url}`)
        return send(res, 200, { ok: true, src })
      }
      send(res, 200, { ok: true })
    } catch (e) {
      log('ОШИБКА записи: ' + e.message)
      send(res, 500, { error: 'ошибка записи: ' + e.message })
    }
  })
})

server.listen(PORT, '127.0.0.1', () => log(`DevSpace API на 127.0.0.1:${PORT}, данные: ${DATA_DIR}`))
