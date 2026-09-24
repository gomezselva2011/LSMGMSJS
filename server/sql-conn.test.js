import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  closeGastosDb,
  openGastosDb,
  readHouseholdState,
  writeHouseholdState,
} from './db.js'
import {
  DRIVER_TURSO,
  TursoDatabase,
  isRemoteLibsqlUrl,
  resolveTursoConfig,
  shouldUseTurso,
} from './sql-conn.js'

function keyword(sql) {
  return String(sql || '')
    .trim()
    .split(/\s+/, 1)[0]
    .toUpperCase()
}

function fakeLibsqlFromSqlite(sqlite) {
  function execute(sqlOrObj, args) {
    const sql = typeof sqlOrObj === 'string' ? sqlOrObj : sqlOrObj.sql
    const bound = args || (typeof sqlOrObj === 'object' && sqlOrObj.args) || []
    const head = keyword(sql)
    if (head === 'SELECT' || head === 'PRAGMA') {
      const stmt = sqlite.prepare(sql)
      const rows = bound.length ? stmt.all(...bound) : stmt.all()
      const columns = rows[0] ? Object.keys(rows[0]) : []
      return {
        columns,
        rows,
        rowsAffected: 0,
        lastInsertRowid: 0,
      }
    }
    if (!bound.length && (head === 'CREATE' || head === 'DROP' || head === 'ALTER' || head === 'BEGIN' || head === 'COMMIT' || head === 'ROLLBACK')) {
      sqlite.exec(sql)
      return { columns: [], rows: [], rowsAffected: 0, lastInsertRowid: 0 }
    }
    const result = sqlite.prepare(sql).run(...(bound || []))
    return {
      columns: [],
      rows: [],
      rowsAffected: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    }
  }

  return {
    protocol: 'file',
    closed: false,
    execute(sqlOrObj, args) {
      return Promise.resolve(execute(sqlOrObj, args))
    },
    executeMultiple(sql) {
      sqlite.exec(sql)
      return Promise.resolve()
    },
    batch(stmts) {
      return Promise.all(stmts.map((stmt) => Promise.resolve(execute(stmt))))
    },
    async transaction() {
      sqlite.exec('BEGIN IMMEDIATE')
      return {
        execute(sqlOrObj, args) {
          return Promise.resolve(execute(sqlOrObj, args))
        },
        executeMultiple(sql) {
          sqlite.exec(sql)
          return Promise.resolve()
        },
        async commit() {
          sqlite.exec('COMMIT')
        },
        async rollback() {
          sqlite.exec('ROLLBACK')
        },
        close() {},
        closed: false,
      }
    },
    close() {
      this.closed = true
      try {
        sqlite.close()
      } catch {
        // Already closed.
      }
    },
  }
}

describe('turso env and adapter', () => {
  const dirs = []

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      closeGastosDb(`turso:fake:${dir}`)
      closeGastosDb(`turso:file:${path.join(dir, 'gastos.sqlite')}`)
      closeGastosDb(path.join(dir, 'gastos.sqlite'))
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('reads TURSO_DATABASE_URL and requires a token only for remote URLs', () => {
    assert.equal(resolveTursoConfig({}), null)
    assert.equal(isRemoteLibsqlUrl('file:./gastos.sqlite'), false)
    assert.equal(isRemoteLibsqlUrl('libsql://gastos-user.turso.io'), true)
    assert.deepEqual(resolveTursoConfig({ TURSO_DATABASE_URL: 'file:./local.db' }), {
      url: 'file:./local.db',
      authToken: undefined,
      remote: false,
    })
    assert.throws(
      () => resolveTursoConfig({ TURSO_DATABASE_URL: 'libsql://gastos-user.turso.io' }),
      /TURSO_AUTH_TOKEN/,
    )
    const remote = resolveTursoConfig({
      TURSO_DATABASE_URL: 'libsql://gastos-user.turso.io',
      TURSO_AUTH_TOKEN: 'token-value',
    })
    assert.equal(remote.url, 'libsql://gastos-user.turso.io')
    assert.equal(remote.remote, true)
    assert.equal(shouldUseTurso({ driver: 'sqlite', env: { TURSO_DATABASE_URL: 'libsql://x' } }), false)
    assert.equal(shouldUseTurso({ env: { TURSO_DATABASE_URL: 'libsql://x', TURSO_AUTH_TOKEN: 't' } }), true)
  })

  it('writes the same household schema through the async Turso wrapper', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-turso-'))
    dirs.push(dir)
    const sqlitePath = path.join(dir, 'backing.sqlite')
    const sqlite = new DatabaseSync(sqlitePath)
    const client = fakeLibsqlFromSqlite(sqlite)
    const url = `fake:${dir}`
    const db = await openGastosDb({
      libsqlClient: client,
      turso: { url, remote: false },
    })
    assert.equal(db.driver, DRIVER_TURSO)
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      months: {
        '2026-10': {
          expenses: [
            {
              id: 'exp-ot-tc-melissa',
              name: 'TC Melissa',
              amount: 80000,
              charges: [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }],
              details: { accountNumber: '123', notes: 'optica' },
            },
          ],
        },
      },
    })
    const state = await readHouseholdState(db)
    assert.equal(state.currentMonth, '2026-10')
    assert.equal(state.months['2026-10'].expenses[0].charges[0].name, 'Lentes')
    assert.equal(state.months['2026-10'].expenses[0].details.accountNumber, '123')

    closeGastosDb(`turso:${url}`)
    const again = await openGastosDb({
      libsqlClient: fakeLibsqlFromSqlite(new DatabaseSync(sqlitePath)),
      turso: { url, remote: false },
    })
    const persisted = await readHouseholdState(again)
    assert.equal(persisted.months['2026-10'].expenses[0].charges[0].name, 'Lentes')
    closeGastosDb(`turso:${url}`)
  })

  it('BEGIN/COMMIT on the wrapper maps to libSQL interactive write transactions', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new TursoDatabase(fakeLibsqlFromSqlite(sqlite), { remote: false })
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)')
    await db.exec('BEGIN IMMEDIATE')
    await db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('a', 1)
    await db.exec('COMMIT')
    const row = await db.prepare('SELECT n FROM t WHERE id = ?').get('a')
    assert.equal(row.n, 1)
    db.close()
  })

  it('uses real @libsql/client against a local file URL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-libsql-'))
    dirs.push(dir)
    const url = `file:${path.join(dir, 'gastos.sqlite')}`
    const db = await openGastosDb({ turso: { url, remote: false } })
    assert.equal(db.driver, DRIVER_TURSO)
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-11',
      months: {
        '2026-11': {
          expenses: [{ id: 'exp-1', name: 'TC Melissa', charges: [{ id: 'chg-persist', name: 'Subgasto persistente', amount: 1500, currency: 'NIO' }] }],
        },
      },
    })
    closeGastosDb(`turso:${url}`)
    const again = await readHouseholdState(await openGastosDb({ turso: { url, remote: false } }))
    assert.equal(again.months['2026-11'].expenses[0].charges[0].name, 'Subgasto persistente')
    closeGastosDb(`turso:${url}`)
  })
})
