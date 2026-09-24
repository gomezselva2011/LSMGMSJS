import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const DRIVER_SQLITE = 'sqlite'
export const DRIVER_TURSO = 'turso'

const mutexes = new WeakMap()

export class Mutex {
  constructor() {
    this._queue = Promise.resolve()
  }

  runExclusive(fn) {
    const next = this._queue.then(() => fn(), () => fn())
    this._queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

export function mutexFor(db) {
  if (db && typeof db.runExclusive === 'function') {
    return db
  }
  let mutex = mutexes.get(db)
  if (!mutex) {
    mutex = new Mutex()
    mutexes.set(db, mutex)
  }
  return mutex
}

export function resolveTursoConfig(env = process.env) {
  const url = String(env?.TURSO_DATABASE_URL || '').trim()
  if (!url) return null
  const authToken = String(env?.TURSO_AUTH_TOKEN || '').trim()
  const remote = isRemoteLibsqlUrl(url)
  if (remote && !authToken) {
    throw new Error('[gastos] TURSO_AUTH_TOKEN es obligatorio con TURSO_DATABASE_URL remoto.')
  }
  return { url, authToken: authToken || undefined, remote }
}

export function isRemoteLibsqlUrl(url) {
  return /^(libsql|https|http|wss|ws):/i.test(String(url || '').trim())
}

/**
 * Turso wins when TURSO_DATABASE_URL is set, even if auth also resolved a local dbPath
 * (avatars still use GASTOS_DATA_DIR / data/). Pass driver: 'sqlite' to force the file.
 */
export function shouldUseTurso(options = {}) {
  if (options.driver === DRIVER_SQLITE) return false
  if (options.libsqlClient || options.turso) return true
  return Boolean(resolveTursoConfig(options.env || process.env))
}

export function connectionKey(options = {}) {
  if (options.connectionKey) return options.connectionKey
  if (!shouldUseTurso(options)) return null
  if (options.turso?.url) return `turso:${options.turso.url}`
  const config = resolveTursoConfig(options.env || process.env)
  if (config) return `turso:${config.url}`
  return `turso:client`
}

function firstKeyword(sql) {
  return String(sql || '')
    .trim()
    .split(/\s+/, 1)[0]
    .toUpperCase()
}

function looksLikeScript(sql) {
  const text = String(sql || '').trim()
  if (!text) return false
  const stripped = text.replace(/;+\s*$/, '')
  return stripped.includes(';')
}

function rowToObject(row, columns) {
  if (row == null) return undefined
  const obj = {}
  const cols = columns && columns.length ? columns : Object.keys(row).filter((key) => Number.isNaN(Number(key)))
  for (const col of cols) {
    let value = row[col]
    if (typeof value === 'bigint') {
      value = Number(value)
    }
    obj[col] = value
  }
  return obj
}

function rowsFromResult(result) {
  const columns = result?.columns || []
  return (result?.rows || []).map((row) => rowToObject(row, columns))
}

function bindArgs(args) {
  if (!args || args.length === 0) return undefined
  return args
}

class TursoStatement {
  constructor(db, sql) {
    this._db = db
    this._sql = sql
  }

  get(...args) {
    return this._db._execute(this._sql, args).then((result) => rowsFromResult(result)[0])
  }

  all(...args) {
    return this._db._execute(this._sql, args).then((result) => rowsFromResult(result))
  }

  run(...args) {
    return this._db._execute(this._sql, args).then((result) => ({
      changes: Number(result?.rowsAffected || 0),
      lastInsertRowid: result?.lastInsertRowid ?? 0,
    }))
  }
}

export class TursoDatabase {
  constructor(client, { remote = true } = {}) {
    this._client = client
    this._txn = null
    this._mutex = new Mutex()
    this.driver = DRIVER_TURSO
    this.remote = Boolean(remote)
  }

  runExclusive(fn) {
    return this._mutex.runExclusive(fn)
  }

  prepare(sql) {
    return new TursoStatement(this, sql)
  }

  async _execute(sql, args) {
    const target = this._txn || this._client
    const bound = bindArgs(args)
    if (bound) {
      return target.execute({ sql, args: bound })
    }
    return target.execute(sql)
  }

  async exec(sql) {
    const keyword = firstKeyword(sql)
    if (keyword === 'BEGIN') {
      if (this._txn) throw new Error('[gastos] Ya hay una transacción Turso abierta.')
      this._txn = await this._client.transaction('write')
      return
    }
    if (keyword === 'COMMIT') {
      if (!this._txn) return
      try {
        await this._txn.commit()
      } finally {
        try {
          this._txn.close()
        } catch {
          // Already closed after commit.
        }
        this._txn = null
      }
      return
    }
    if (keyword === 'ROLLBACK') {
      if (!this._txn) return
      try {
        await this._txn.rollback()
      } finally {
        try {
          this._txn.close()
        } catch {
          // Already closed after rollback.
        }
        this._txn = null
      }
      return
    }

    const target = this._txn || this._client
    if (looksLikeScript(sql) && typeof target.executeMultiple === 'function') {
      await target.executeMultiple(sql)
      return
    }
    await target.execute(sql)
  }

  close() {
    if (this._txn) {
      try {
        this._txn.close()
      } catch {
        // Ignore.
      }
      this._txn = null
    }
    try {
      this._client.close()
    } catch {
      // Already closed.
    }
  }
}

export async function openTursoDatabase(options = {}) {
  const config = options.turso || resolveTursoConfig(options.env || process.env)
  const client =
    options.libsqlClient ||
    (await import('@libsql/client')).createClient({
      url: config.url,
      authToken: config.authToken,
      intMode: 'number',
    })
  return new TursoDatabase(client, { remote: config?.remote !== false })
}

export function openSqliteFile(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.driver = DRIVER_SQLITE
  db.remote = false
  return db
}

export async function applyPragmas(db) {
  if (db.remote || db.driver === DRIVER_TURSO) {
    try {
      await db.exec('PRAGMA foreign_keys = ON')
    } catch {
      // Remote libSQL may ignore or reject file-only PRAGMAs.
    }
    return
  }
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
}
