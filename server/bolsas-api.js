import { ensureGastosDb, resolveDbPath } from './db.js'
import { ensureBolsaReady, listBolsas, readBolsa } from './bolsa-db.js'

export const BOLSAS_API_PREFIX = '/api/bolsas'

export function isBolsasApiUrl(url = '') {
  const pathname = String(url).split('?')[0].replace(/\/$/, '')
  if (pathname === BOLSAS_API_PREFIX) return { list: true }
  const prefix = `${BOLSAS_API_PREFIX}/`
  if (pathname.startsWith(prefix)) {
    const id = decodeURIComponent(pathname.slice(prefix.length))
    if (id && !id.includes('/')) return { list: false, id }
  }
  return null
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function dbOptionsFrom(options = {}) {
  return {
    root: options.root,
    dbPath: options.dbPath || resolveDbPath(options),
    dataPath: options.dataPath,
    gastosJsonPath: options.gastosJsonPath,
    usersPath: options.usersPath,
    sessionsPath: options.sessionsPath,
  }
}

export async function handleBolsasApi(req, res, next, options = {}) {
  const match = isBolsasApiUrl(req.url)
  if (!match) {
    next?.()
    return false
  }

  const dbOptions = dbOptionsFrom(options)

  try {
    if (typeof options.getUser === 'function') {
      const user = options.getUser(req)
      if (!user) {
        sendJson(res, 401, { error: 'Inicia sesión.' })
        return true
      }
    }

    if (req.method !== 'GET') {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Allow', 'GET, OPTIONS')
        res.end()
        return true
      }
      res.statusCode = 405
      res.setHeader('Allow', 'GET, OPTIONS')
      res.end()
      return true
    }

    const db = await ensureGastosDb(dbOptions)
    await ensureBolsaReady(db)

    if (match.list) {
      sendJson(res, 200, { bolsas: await listBolsas(db) })
      return true
    }

    const bolsa = await readBolsa(db, match.id)
    if (!bolsa) {
      sendJson(res, 404, { error: 'Bolsa no encontrada.' })
      return true
    }
    sendJson(res, 200, bolsa)
    return true
  } catch (error) {
    console.error(error)
    sendJson(res, 500, { error: 'No se pudieron leer las bolsas.' })
    return true
  }
}

export function bolsasApiPlugin(options = {}) {
  const middleware = (req, res, next) => {
    Promise.resolve(handleBolsasApi(req, res, next, options)).catch((error) => {
      console.error(error)
      if (!res.writableEnded) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'No se pudieron leer las bolsas.' }))
      }
    })
  }

  return {
    name: 'bolsas-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
