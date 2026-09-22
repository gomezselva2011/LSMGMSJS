import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  ensureGastosDb,
  listSessions as listDbSessions,
  listUsers as listDbUsers,
  normalizeRole,
  openGastosDb,
  replaceSessions,
  replaceUsers,
  resolveDbPath,
} from './db.js'
import {
  getHouseholdSeeds,
  PLACEHOLDER_USERNAMES,
  SEED_ADMIN,
  SEED_ADMIN_2,
} from './household-users.js'

const scrypt = promisify(scryptCb)

export const COOKIE_NAME = 'gastos_session'
export const MAX_USERS = 3
export { SEED_ADMIN, SEED_ADMIN_2 }
export const ROLE_ADMIN = 'admin'
export const ROLE_VIEWER = 'viewer'
export const ROLE_USER = 'usuario'
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000
export const LOGIN_WINDOW_MS = 10 * 60 * 1000
export const LOGIN_MAX_PER_USER = 5
export const LOGIN_MAX_PER_IP = 20
const KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const PHOTO_MAX_BYTES = 1_500_000
const LOGIN_ERROR = 'Usuario o contraseña incorrectos.'

const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MARK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z',
  'base64',
)

let dummyHashPromise

function dummyPasswordHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(16).toString('hex'))
  return dummyHashPromise
}

function sendMarkJpeg(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.setHeader('Content-Length', String(MARK_JPEG.length))
  res.end(MARK_JPEG)
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(payload)
}

async function readRequestBody(req, limit = 1_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('payload too large')
      error.code = 'PAYLOAD_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(String(password), salt, KEYLEN, SCRYPT_OPTIONS)
  return `scrypt:${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const parts = stored.split(':')
  if (parts[0] !== 'scrypt' || parts.length !== 3) return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  if (!salt.length || !expected.length) return false
  const actual = Buffer.from(await scrypt(String(password), salt, expected.length, SCRYPT_OPTIONS))
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

function newId(prefix) {
  return `${prefix}_${randomBytes(16).toString('hex')}`
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function validUsername(value) {
  return /^[a-z0-9_]{2,32}$/.test(value)
}

function validName(value) {
  const name = String(value || '').trim()
  return name.length >= 1 && name.length <= 80
}

function validRole(value) {
  return normalizeRole(value) != null
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    photoUrl: `/api/users/${user.id}/photo`,
    canEdit: user.role === ROLE_ADMIN,
  }
}

export function requestIsHttps(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (proto === 'https') return true
  const cfVisitor = String(req?.headers?.['cf-visitor'] || '')
  if (cfVisitor.includes('"https"') || cfVisitor.includes("'https'")) return true
  return Boolean(req?.socket?.encrypted)
}

export function clientIp(req) {
  const cf = String(req?.headers?.['cf-connecting-ip'] || '').trim()
  if (cf) return cf.slice(0, 128)
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  if (forwarded) return forwarded.slice(0, 128)
  return String(req?.socket?.remoteAddress || 'unknown').slice(0, 128)
}

function sessionCookie(token, maxAgeSeconds, { secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  if (maxAgeSeconds <= 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  }
  return parts.join('; ')
}

export function isSensitivePath(pathname) {
  const raw = String(pathname || '').split('?')[0]
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const normalized = path.posix.normalize(decoded).toLowerCase()
  if (/(^|\/)data(\/|$)/.test(normalized)) return true
  if (/(^|\/)server(\/|$)/.test(normalized)) return true
  if (/(^|\/)scripts(\/|$)/.test(normalized)) return true
  if (normalized.endsWith('.sqlite') || normalized.endsWith('.sqlite-wal') || normalized.endsWith('.sqlite-shm')) {
    return true
  }
  const base = path.posix.basename(normalized)
  if (base === '.env' || base.startsWith('.env.')) return true
  if (base === 'users.json' || base === 'sessions.json' || base === 'gastos.json') return true
  return false
}

function isLogoutPath(pathname) {
  return pathname === '/api/logout' || pathname === '/api/auth/logout'
}

function pathnameOf(req) {
  return String(req.url || '').split('?')[0]
}

function isLoginPath(pathname) {
  return pathname === '/login' || pathname === '/login.html'
}

function isPublicAsset(pathname) {
  if (isLoginPath(pathname)) return true
  if (pathname.startsWith('/@')) return true
  if (pathname.startsWith('/node_modules/')) return true
  if (pathname.startsWith('/src/login')) return true
  if (
    pathname === '/boot.css' ||
    pathname === '/lm-mark.jpg' ||
    pathname === '/favicon.svg' ||
    pathname === '/favicon.png' ||
    pathname === '/favicon-32.png' ||
    pathname === '/apple-touch-icon.png'
  ) {
    return true
  }
  return false
}

function wantsHtml(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const pathname = pathnameOf(req)
  if (pathname === '/' || pathname === '/index.html') return true
  const accept = String(req.headers.accept || '')
  return accept.includes('text/html')
}

export function createLoginRateLimiter({
  windowMs = LOGIN_WINDOW_MS,
  maxPerUser = LOGIN_MAX_PER_USER,
  maxPerIp = LOGIN_MAX_PER_IP,
} = {}) {
  const hits = new Map()

  function bump(key, now) {
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return 1
    }
    entry.count += 1
    return entry.count
  }

  function count(key, now) {
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) return 0
    return entry.count
  }

  return {
    tooMany(ip, username) {
      const now = Date.now()
      return (
        count(`u:${ip}:${normalizeUsername(username)}`, now) >= maxPerUser ||
        count(`i:${ip}`, now) >= maxPerIp
      )
    },
    hit(ip, username) {
      const now = Date.now()
      bump(`u:${ip}:${normalizeUsername(username)}`, now)
      bump(`i:${ip}`, now)
    },
    clearUser(ip, username) {
      hits.delete(`u:${ip}:${normalizeUsername(username)}`)
    },
    reset() {
      hits.clear()
    },
  }
}

export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

export function safeAvatarPath(avatarsDir, filename) {
  const base = path.basename(String(filename || ''))
  if (!/^[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(base)) return null
  const root = path.resolve(avatarsDir)
  const dest = path.resolve(root, base)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (dest !== root && !dest.startsWith(prefix)) return null
  return dest
}

export function createAuthStore(options = {}) {
  const root = options.root || process.cwd()
  const dataDir = path.join(root, 'data')
  const dbPath = resolveDbPath(options)
  const usersPath = options.usersPath || path.join(dataDir, 'users.json')
  const sessionsPath = options.sessionsPath || path.join(dataDir, 'sessions.json')
  const avatarsDir = options.avatarsDir || path.join(dataDir, 'avatars')
  const markPath = options.markPath || path.join(root, 'public', 'lm-mark.jpg')
  const dbOptions = { ...options, root, dbPath, usersPath, sessionsPath }
  const loginLimiter = options.loginLimiter || createLoginRateLimiter()

  let users = []
  let sessions = {}

  async function load() {
    const db = await ensureGastosDb(dbOptions)
    users = listDbUsers(db)
    sessions = listDbSessions(db)
  }

  async function saveUsers() {
    replaceUsers(openGastosDb(dbOptions), users)
  }

  async function saveSessions() {
    replaceSessions(openGastosDb(dbOptions), sessions)
  }

  async function seedUser(seed) {
    const existing = users.find((user) => user.username === seed.username)
    if (existing) return existing
    const user = {
      id: newId('usr'),
      name: seed.name,
      username: seed.username,
      role: normalizeRole(seed.role) || ROLE_ADMIN,
      passwordHash: await hashPassword(seed.password),
      photo: null,
    }
    users.push(user)
    return user
  }

  async function ensureSeeded() {
    await mkdir(avatarsDir, { recursive: true })
    await load()
    const required = getHouseholdSeeds()
    const requiredNames = new Set(required.map((seed) => seed.username))
    let changed = false
    let createdSeed = false

    const kept = users.filter(
      (user) => requiredNames.has(user.username) || !PLACEHOLDER_USERNAMES.has(user.username),
    )
    if (kept.length !== users.length) {
      users = kept
      changed = true
    }

    for (const seed of required) {
      const existing = findByUsername(seed.username)
      if (!existing) {
        while (users.length >= MAX_USERS) {
          const idx = users.findIndex((user) => !requiredNames.has(user.username))
          if (idx < 0) break
          users.splice(idx, 1)
          changed = true
        }
        if (users.length < MAX_USERS) {
          await seedUser(seed)
          changed = true
          createdSeed = true
        }
      } else {
        if (existing.role !== seed.role) {
          existing.role = seed.role
          changed = true
        }
        if (existing.name !== seed.name) {
          existing.name = seed.name
          changed = true
        }
      }
    }

    if (users.length > MAX_USERS) {
      const pinned = users.filter((user) => requiredNames.has(user.username))
      const rest = users.filter((user) => !requiredNames.has(user.username))
      users = [...pinned, ...rest].slice(0, MAX_USERS)
      changed = true
    }

    if (changed) {
      await saveUsers()
      if (pruneSessions()) await saveSessions()
    }

    if (
      createdSeed &&
      !process.env.GASTOS_ADMIN_PASSWORD &&
      !process.env.GASTOS_ADMIN2_PASSWORD
    ) {
      console.info(
        '[gastos] Semilla local: mgomez y lsotelon con contraseñas dummy de desarrollo. Define GASTOS_ADMIN_PASSWORD y GASTOS_ADMIN2_PASSWORD. Una base ya existente no cambia las claves.',
      )
    }
  }

  function findUser(id) {
    return users.find((user) => user.id === id) || null
  }

  function findByUsername(username) {
    const key = normalizeUsername(username)
    return users.find((user) => user.username === key) || null
  }

  function pruneSessions() {
    const now = Date.now()
    let changed = false
    for (const [token, session] of Object.entries(sessions)) {
      if (!session || session.expiresAt <= now || !findUser(session.userId)) {
        delete sessions[token]
        changed = true
      }
    }
    return changed
  }

  async function createSession(userId) {
    pruneSessions()
    const token = randomBytes(32).toString('base64url')
    sessions[token] = { userId, expiresAt: Date.now() + SESSION_MS }
    await saveSessions()
    return token
  }

  async function dropSession(token) {
    if (token && sessions[token]) {
      delete sessions[token]
      await saveSessions()
    }
  }

  function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
    if (!token) return null
    const session = sessions[token]
    if (!session || session.expiresAt <= Date.now()) return null
    return findUser(session.userId)
  }

  async function login(username, password) {
    const user = findByUsername(username)
    const stored = user?.passwordHash || (await dummyPasswordHash())
    const ok = await verifyPassword(password, stored)
    if (!user || !ok) return null
    const token = await createSession(user.id)
    return { user, token }
  }

  async function createProfile({ name, username, password, role }) {
    if (users.length >= MAX_USERS) {
      const error = new Error(`Solo pueden haber ${MAX_USERS} perfiles.`)
      error.code = 'USER_CAP'
      throw error
    }
    const trimmedName = String(name || '').trim()
    const userKey = normalizeUsername(username)
    if (!validName(trimmedName)) {
      const error = new Error('Escribe un nombre.')
      error.code = 'INVALID'
      throw error
    }
    if (!validUsername(userKey)) {
      const error = new Error('El usuario usa letras, números o _ (2 a 32).')
      error.code = 'INVALID'
      throw error
    }
    if (String(password || '').length < 6) {
      const error = new Error('La contraseña tiene que tener al menos 6 caracteres.')
      error.code = 'INVALID'
      throw error
    }
    if (!validRole(role)) {
      const error = new Error('Elige admin o solo lectura.')
      error.code = 'INVALID'
      throw error
    }
    if (findByUsername(userKey)) {
      const error = new Error('Ese usuario ya existe.')
      error.code = 'CONFLICT'
      throw error
    }
    const user = {
      id: newId('usr'),
      name: trimmedName,
      username: userKey,
      role: normalizeRole(role),
      passwordHash: await hashPassword(password),
      photo: null,
    }
    users.push(user)
    await saveUsers()
    return user
  }

  async function savePhoto(user, buffer, contentType) {
    const claimed = PHOTO_TYPES[String(contentType || '').toLowerCase()]
    const sniffed = sniffImageType(buffer)
    if (!claimed || !sniffed || claimed !== sniffed) {
      const error = new Error('Usa una foto JPG, PNG o WebP.')
      error.code = 'INVALID'
      throw error
    }
    if (!buffer.length) {
      const error = new Error('La foto está vacía.')
      error.code = 'INVALID'
      throw error
    }
    if (buffer.length > PHOTO_MAX_BYTES) {
      const error = new Error('La foto es demasiado grande.')
      error.code = 'PAYLOAD_TOO_LARGE'
      throw error
    }
    await mkdir(avatarsDir, { recursive: true })
    const filename = `${user.id}.${sniffed}`
    const dest = safeAvatarPath(avatarsDir, filename)
    if (!dest) {
      const error = new Error('No se pudo guardar la foto.')
      error.code = 'INVALID'
      throw error
    }
    const tmp = `${dest}.${process.pid}.tmp`
    await writeFile(tmp, buffer)
    await rename(tmp, dest)
    user.photo = path.basename(dest)
    await saveUsers()
    return user
  }

  async function sendPhoto(user, res) {
    if (user?.photo) {
      const file = safeAvatarPath(avatarsDir, user.photo)
      if (file) {
        try {
          const info = await stat(file)
          if (info.size > 0) {
            const ext = path.extname(file).slice(1).toLowerCase()
            const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
            res.statusCode = 200
            res.setHeader('Content-Type', type)
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('Content-Length', info.size)
            res.setHeader('Cache-Control', 'private, max-age=120')
            createReadStream(file).pipe(res)
            return
          }
        } catch {
          // Fall through to the L&M mark.
        }
      }
    }
    try {
      const info = await stat(markPath)
      if (info.size > 0) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/jpeg')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Length', info.size)
        res.setHeader('Cache-Control', 'private, max-age=300')
        createReadStream(markPath).pipe(res)
        return
      }
    } catch {
      // Last resort: never send SVG/HTML that browsers might execute.
    }
    sendMarkJpeg(res)
  }

  return {
    dbPath,
    usersPath,
    avatarsDir,
    loginLimiter,
    ensureSeeded,
    load,
    userFromRequest,
    login,
    dropSession,
    createProfile,
    savePhoto,
    sendPhoto,
    findUser,
    listUsers: () => users.map(publicUser),
    publicUser,
    userCount: () => users.length,
  }
}

function canWriteBudget(user) {
  return user?.role === ROLE_ADMIN
}

export async function handleAuthRequest(req, res, next, store) {
  const pathname = pathnameOf(req)

  if (isSensitivePath(pathname)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end('Not found')
    return true
  }

  if (pathname === '/login') {
    const user = store.userFromRequest(req)
    if (user) {
      res.writeHead(302, { Location: '/' })
      res.end()
      return true
    }
    req.url = '/login.html'
    next?.()
    return true
  }

  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const ip = clientIp(req)
        const raw = (await readRequestBody(req)).toString('utf8')
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, { error: 'JSON inválido' })
          return true
        }
        const username = body.username
        if (store.loginLimiter?.tooMany(ip, username)) {
          sendJson(res, 429, { error: 'Demasiados intentos. Espera un momento.' })
          return true
        }
        const result = await store.login(username, body.password)
        if (!result) {
          store.loginLimiter?.hit(ip, username)
          sendJson(res, 401, { error: LOGIN_ERROR })
          return true
        }
        store.loginLimiter?.clearUser(ip, username)
        res.setHeader(
          'Set-Cookie',
          sessionCookie(result.token, Math.floor(SESSION_MS / 1000), { secure: requestIsHttps(req) }),
        )
        sendJson(res, 200, { user: store.publicUser(result.user) })
        return true
      }

      const user = store.userFromRequest(req)
      req.gastosUser = user || null

      if (req.method === 'POST' && isLogoutPath(pathname)) {
        const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
        await store.dropSession(token)
        res.setHeader('Set-Cookie', sessionCookie('', 0, { secure: requestIsHttps(req) }))
        sendJson(res, 200, { ok: true })
        return true
      }

      if (!user) {
        sendJson(res, 401, { error: 'Inicia sesión.' })
        return true
      }

      const photoMatch = pathname.match(/^\/api\/users\/([^/]+)\/photo$/)
      if (req.method === 'GET' && photoMatch) {
        const target = store.findUser(photoMatch[1])
        await store.sendPhoto(target, res)
        return true
      }

      if (req.method === 'GET' && pathname === '/api/auth/me') {
        sendJson(res, 200, { user: store.publicUser(user) })
        return true
      }

      if (req.method === 'GET' && pathname === '/api/users') {
        sendJson(res, 200, { users: store.listUsers(), max: MAX_USERS })
        return true
      }

      if (req.method === 'POST' && pathname === '/api/users') {
        if (!canWriteBudget(user)) {
          sendJson(res, 403, { error: 'Solo un admin puede crear perfiles.' })
          return true
        }
        const raw = (await readRequestBody(req)).toString('utf8')
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, { error: 'JSON inválido' })
          return true
        }
        try {
          const created = await store.createProfile(body)
          sendJson(res, 201, { user: store.publicUser(created) })
        } catch (error) {
          const status =
            error.code === 'USER_CAP' || error.code === 'CONFLICT'
              ? 409
              : error.code === 'INVALID'
                ? 400
                : 500
          sendJson(res, status, { error: error.message })
        }
        return true
      }

      if (req.method === 'POST' && pathname === '/api/me/photo') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim()
        const buffer = await readRequestBody(req, PHOTO_MAX_BYTES)
        try {
          const updated = await store.savePhoto(user, buffer, type)
          sendJson(res, 200, { user: store.publicUser(updated) })
        } catch (error) {
          const status = error.code === 'PAYLOAD_TOO_LARGE' ? 413 : error.code === 'INVALID' ? 400 : 500
          sendJson(res, status, { error: error.message })
        }
        return true
      }

      if (pathname === '/api/gastos' || pathname === '/api/gastos/') {
        const mutating =
          req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
        if (mutating && !canWriteBudget(user)) {
          sendJson(res, 403, { error: 'Solo un admin puede guardar el presupuesto.' })
          return true
        }
        if (typeof next === 'function') await next()
        return false
      }

      sendJson(res, 404, { error: 'No está esa ruta.' })
      return true
    } catch (error) {
      if (error.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: 'El archivo es demasiado grande.' })
        return true
      }
      console.error(error)
      sendJson(res, 500, { error: 'No se pudo completar la petición.' })
      return true
    }
  }

  if (!store.userFromRequest(req) && wantsHtml(req) && !isPublicAsset(pathname)) {
    res.writeHead(302, { Location: '/login' })
    res.end()
    return true
  }

  next?.()
  return false
}

export function authPlugin(options = {}) {
  const store = createAuthStore(options)
  const middleware = (req, res, next) => {
    Promise.resolve(handleAuthRequest(req, res, next, store)).catch((error) => {
      console.error(error)
      if (!res.writableEnded) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'No se pudo completar la petición.' }))
      }
    })
  }

  return {
    name: 'gastos-auth',
    store,
    async configureServer(server) {
      await store.ensureSeeded()
      server.middlewares.use(middleware)
    },
    async configurePreviewServer(server) {
      await store.ensureSeeded()
      server.middlewares.use(middleware)
    },
  }
}
