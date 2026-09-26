import { ensureGastosDb, resolveDbPath } from './db.js'
import { applyBolsaPayment, deleteBolsaMovement, ensureBolsaReady, listBolsas, readBolsa } from './bolsa-db.js'
import { ROLE_ADMIN } from './household-users.js'

export const BOLSAS_API_PREFIX = '/api/bolsas'

export function parseBolsasApiUrl(url = '') {
  const pathname = String(url).split('?')[0].replace(/\/$/, '')
  if (pathname === BOLSAS_API_PREFIX) return { list: true }
  const prefix = `${BOLSAS_API_PREFIX}/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const parts = rest.split('/').filter(Boolean)
  if (parts.length === 1) return { list: false, id: decodeURIComponent(parts[0]) }
  if (parts.length === 2 && parts[1] === 'apply-payment') {
    return { applyPayment: true, id: decodeURIComponent(parts[0]) }
  }
  if (parts.length === 3 && parts[1] === 'movements') {
    return {
      deleteMovement: true,
      id: decodeURIComponent(parts[0]),
      movementId: decodeURIComponent(parts[2]),
    }
  }
  return null
}

export function isBolsasApiUrl(url = '') {
  return parseBolsasApiUrl(url) != null
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

async function readRequestBody(req, limit = 100_000) {
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

export async function handleBolsasApi(req, res, next, options = {}) {
  const match = parseBolsasApiUrl(req.url)
  if (!match) {
    next?.()
    return false
  }

  const dbOptions = dbOptionsFrom(options)

  try {
    const user = typeof options.getUser === 'function' ? options.getUser(req) : null
    if (!user) {
      sendJson(res, 401, { error: 'Inicia sesión.' })
      return true
    }

    const mutating = req.method === 'POST' || req.method === 'DELETE'
    if (mutating && user.role !== ROLE_ADMIN) {
      sendJson(res, 403, { error: 'Solo un admin puede modificar la bolsa.' })
      return true
    }

    if (match.deleteMovement) {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Allow', 'DELETE, OPTIONS')
        res.end()
        return true
      }
      if (req.method !== 'DELETE') {
        res.statusCode = 405
        res.setHeader('Allow', 'DELETE, OPTIONS')
        res.end()
        return true
      }

      const db = await ensureGastosDb(dbOptions)
      await ensureBolsaReady(db)

      try {
        const bolsa = await deleteBolsaMovement(db, match.id, match.movementId)
        sendJson(res, 200, bolsa)
      } catch (error) {
        const status =
          error.status ||
          (error.code === 'NOT_FOUND' ? 404 : error.code === 'NOT_DELETABLE' ? 403 : 400)
        sendJson(res, status, { error: error.message || 'No se pudo quitar el pago.' })
      }
      return true
    }

    if (match.applyPayment) {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Allow', 'POST, OPTIONS')
        res.end()
        return true
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Allow', 'POST, OPTIONS')
        res.end()
        return true
      }

      const db = await ensureGastosDb(dbOptions)
      await ensureBolsaReady(db)

      let body
      try {
        body = JSON.parse((await readRequestBody(req)) || '{}')
      } catch {
        sendJson(res, 400, { error: 'JSON inválido' })
        return true
      }

      try {
        const bolsa = await applyBolsaPayment(db, match.id, body)
        sendJson(res, 200, bolsa)
      } catch (error) {
        const status = error.status || (error.code === 'NOT_FOUND' ? 404 : error.code === 'DUPLICATE' ? 409 : 400)
        sendJson(res, status, { error: error.message || 'No se pudo aplicar el pago.' })
      }
      return true
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
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'El archivo es demasiado grande.' })
      return true
    }
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
