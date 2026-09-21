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
import { HOUSEHOLD_SEEDS, PLACEHOLDER_USERNAMES, SEED_ADMIN, SEED_ADMIN_2 } from './household-users.js'

const scrypt = promisify(scryptCb)

export const COOKIE_NAME = 'gastos_session'
export const MAX_USERS = 3
export { SEED_ADMIN, SEED_ADMIN_2 }
export const ROLE_ADMIN = 'admin'
export const ROLE_VIEWER = 'viewer'
export const ROLE_USER = 'usuario'
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const KEYLEN = 64
const PHOTO_MAX_BYTES = 1_500_000

const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MARK_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#f7f4ee"/><text x="48" y="56" text-anchor="middle" font-family="serif" font-size="20" fill="#1b2a4e">L&amp;M</text></svg>`,
)

function sendMarkSvg(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.setHeader('Content-Length', String(MARK_SVG.length))
  res.end(MARK_SVG)
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
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
  const hash = await scrypt(String(password), salt, KEYLEN)
  return `scrypt:${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const parts = stored.split(':')
  if (parts[0] !== 'scrypt' || parts.length !== 3) return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  if (!salt.length || !expected.length) return false
  const actual = Buffer.from(await scrypt(String(password), salt, expected.length))
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
  return `${prefix}_${randomBytes(8).toString('hex')}`
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

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (maxAgeSeconds <= 0) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  }
  return parts.join('; ')
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

export function createAuthStore(options = {}) {
  const root = options.root || process.cwd()
  const dataDir = path.join(root, 'data')
  const dbPath = resolveDbPath(options)
  const usersPath = options.usersPath || path.join(dataDir, 'users.json')
  const sessionsPath = options.sessionsPath || path.join(dataDir, 'sessions.json')
  const avatarsDir = options.avatarsDir || path.join(dataDir, 'avatars')
  const markPath = options.markPath || path.join(root, 'public', 'lm-mark.jpg')
  const dbOptions = { ...options, root, dbPath, usersPath, sessionsPath }

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
    const required = HOUSEHOLD_SEEDS
    const requiredNames = new Set(required.map((seed) => seed.username))
    let changed = false

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
    const token = randomBytes(24).toString('base64url')
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
    if (!user) return null
    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) return null
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
    const ext = PHOTO_TYPES[String(contentType || '').toLowerCase()]
    if (!ext) {
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
    const filename = `${user.id}.${ext}`
    const dest = path.join(avatarsDir, filename)
    const tmp = `${dest}.${process.pid}.tmp`
    await writeFile(tmp, buffer)
    await rename(tmp, dest)
    user.photo = filename
    await saveUsers()
    return user
  }

  async function sendPhoto(user, res) {
    if (user?.photo) {
      const file = path.join(avatarsDir, user.photo)
      try {
        const info = await stat(file)
        if (info.size > 0) {
          const ext = path.extname(file).slice(1)
          const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
          res.statusCode = 200
          res.setHeader('Content-Type', type)
          res.setHeader('Content-Length', info.size)
          res.setHeader('Cache-Control', 'private, max-age=120')
          createReadStream(file).pipe(res)
          return
        }
      } catch {
        // Fall through to the L&M mark.
      }
    }
    try {
      const info = await stat(markPath)
      if (info.size > 0) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/jpeg')
        res.setHeader('Content-Length', info.size)
        res.setHeader('Cache-Control', 'private, max-age=300')
        createReadStream(markPath).pipe(res)
        return
      }
    } catch {
      // Last resort: never send JSON/HTML that browsers show as a broken image.
    }
    sendMarkSvg(res)
  }

  return {
    dbPath,
    usersPath,
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

export async function handleAuthRequest(req, res, next, store) {
  const pathname = pathnameOf(req)

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
        const raw = (await readRequestBody(req)).toString('utf8')
        let body
        try {
          body = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, { error: 'JSON inválido' })
          return true
        }
        const result = await store.login(body.username, body.password)
        if (!result) {
          sendJson(res, 401, { error: 'Usuario o contraseña incorrectos.' })
          return true
        }
        res.setHeader('Set-Cookie', sessionCookie(result.token, Math.floor(SESSION_MS / 1000)))
        sendJson(res, 200, { user: store.publicUser(result.user) })
        return true
      }

      const photoMatch = pathname.match(/^\/api\/users\/([^/]+)\/photo$/)
      if (req.method === 'GET' && photoMatch) {
        const target = store.findUser(photoMatch[1])
        await store.sendPhoto(target, res)
        return true
      }

      const user = store.userFromRequest(req)

      if (req.method === 'POST' && isLogoutPath(pathname)) {
        const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
        await store.dropSession(token)
        res.setHeader('Set-Cookie', sessionCookie('', 0))
        sendJson(res, 200, { ok: true })
        return true
      }

      if (!user) {
        sendJson(res, 401, { error: 'Inicia sesión.' })
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
        if (user.role !== ROLE_ADMIN) {
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
        const mutating = req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
        if (mutating && user.role !== ROLE_ADMIN) {
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
