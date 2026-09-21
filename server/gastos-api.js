import fs from 'node:fs/promises'
import path from 'node:path'

export const GASTOS_API_PATH = '/api/gastos'
const MAX_BYTES = 2_000_000

export function defaultDataPath(root = process.cwd()) {
  return path.join(root, 'data', 'gastos.json')
}

export function isGastosApiUrl(url = '') {
  const pathname = String(url).split('?')[0]
  return pathname === GASTOS_API_PATH || pathname === `${GASTOS_API_PATH}/`
}

export async function readGastosFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    if (!raw.trim()) return {}
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export async function writeGastosFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, filePath)
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

  const dataPath = options.dataPath || defaultDataPath()

  try {
    if (req.method === 'GET') {
      const data = await readGastosFile(dataPath)
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
      await writeGastosFile(dataPath, parsed)
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
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
