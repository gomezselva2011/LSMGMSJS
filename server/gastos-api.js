import path from 'node:path'
import {
  defaultDbPath,
  defaultGastosJsonPath,
  ensureGastosDb,
  readHouseholdState,
  resolveDbPath,
  writeHouseholdState,
} from './db.js'
import { ROLE_ADMIN } from './household-users.js'

export const GASTOS_API_PATH = '/api/gastos'
const MAX_BYTES = 2_000_000

export function defaultDataPath(root) {
  return defaultGastosJsonPath(root)
}

export { defaultDbPath, resolveDbPath }

export function isGastosApiUrl(url = '') {
  const pathname = String(url).split('?')[0]
  return pathname === GASTOS_API_PATH || pathname === `${GASTOS_API_PATH}/`
}

function dbOptionsFrom(filePath, options = {}) {
  if (options.dbPath || options.root || options.dataPath) return options
  if (!filePath) return options
  if (String(filePath).endsWith('.sqlite')) return { ...options, dbPath: filePath }
  return {
    ...options,
    dataPath: filePath,
    dbPath: path.join(path.dirname(filePath), 'gastos.sqlite'),
  }
}

export async function readGastosFile(filePath, options = {}) {
  const db = await ensureGastosDb(dbOptionsFrom(filePath, options))
  return readHouseholdState(db)
}

export async function writeGastosFile(filePath, data, options = {}) {
  const db = await ensureGastosDb(dbOptionsFrom(filePath, options))
  writeHouseholdState(db, data)
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

async function readRequestBody(req, limit = MAX_BYTES) {
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
  return Buffer.concat(chunks).toString('utf8')
}

export async function handleGastosApi(req, res, next, options = {}) {
  if (!isGastosApiUrl(req.url)) {
    next?.()
    return false
  }

  const dbOptions = {
    root: options.root,
    dbPath: options.dbPath || resolveDbPath(options),
    dataPath: options.dataPath || defaultDataPath(options.root),
    gastosJsonPath: options.gastosJsonPath || options.dataPath,
    usersPath: options.usersPath,
    sessionsPath: options.sessionsPath,
  }

  try {
    if (typeof options.getUser === 'function') {
      const user = options.getUser(req)
      const mutating =
        req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE'
      if (!user) {
        sendJson(res, 401, { error: 'Inicia sesión.' })
        return true
      }
      if (mutating && user.role !== ROLE_ADMIN) {
        sendJson(res, 403, { error: 'Solo un admin puede guardar el presupuesto.' })
        return true
      }
    }

    const db = await ensureGastosDb(dbOptions)

    if (req.method === 'GET') {
      const data = readHouseholdState(db)
      sendJson(res, 200, data)
      return true
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const raw = await readRequestBody(req)
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        sendJson(res, 400, { error: 'JSON inválido' })
        return true
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'El cuerpo tiene que ser un objeto JSON' })
        return true
      }
      writeHouseholdState(db, parsed)
      sendJson(res, 200, { ok: true })
      return true
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('Allow', 'GET, PUT, POST, OPTIONS')
      res.end()
      return true
    }

    res.statusCode = 405
    res.setHeader('Allow', 'GET, PUT, POST, OPTIONS')
    res.end()
    return true
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'El archivo es demasiado grande' })
      return true
    }
    console.error(error)
    sendJson(res, 500, { error: 'No se pudo leer o escribir el presupuesto' })
    return true
  }
}

export function gastosApiPlugin(options = {}) {
  const middleware = (req, res, next) => {
    Promise.resolve(handleGastosApi(req, res, next, options)).catch((error) => {
      console.error(error)
      if (!res.writableEnded) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'No se pudo leer o escribir el presupuesto' }))
      }
    })
  }

  return {
    name: 'gastos-api',
    async configureServer(server) {
      await ensureGastosDb(options)
      server.middlewares.use(middleware)
    },
    async configurePreviewServer(server) {
      await ensureGastosDb(options)
      server.middlewares.use(middleware)
    },
  }
}
