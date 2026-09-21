import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeGastosDb, openGastosDb, readHouseholdState } from './db.js'
import { handleGastosApi, readGastosFile } from './gastos-api.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(value = '') {
      this.body = String(value)
      this.ended = true
    },
  }
}

function getReq() {
  return { method: 'GET', url: '/api/gastos' }
}

function putReq(body) {
  const req = Readable.from([Buffer.from(body)])
  req.method = 'PUT'
  req.url = '/api/gastos'
  return req
}

describe('gastos API sqlite store', () => {
  let dir
  let dataPath
  let dbPath

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-api-'))
    dataPath = path.join(dir, 'gastos.json')
    dbPath = path.join(dir, 'gastos.sqlite')
  })

  afterEach(async () => {
    closeGastosDb(dbPath)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('GET returns {} when the database is empty', async () => {
    const res = mockRes()
    const handled = await handleGastosApi(getReq(), res, () => {}, { dbPath, dataPath })
    assert.equal(handled, true)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Cache-Control'], 'no-store')
    assert.deepEqual(JSON.parse(res.body), {})
  })

  it('PUT writes tables that survive a later GET and a reopened connection', async () => {
    const payload = {
      version: 1,
      currentMonth: '2026-10',
      months: {
        '2026-10': {
          expenses: [
            {
              id: 'exp-ot-tc-melissa',
              name: 'TC Melissa',
              charges: [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }],
            },
          ],
        },
      },
    }
    const writeRes = mockRes()
    await handleGastosApi(putReq(JSON.stringify(payload)), writeRes, () => {}, { dbPath, dataPath })
    assert.equal(writeRes.statusCode, 200)
    assert.equal(JSON.parse(writeRes.body).ok, true)

    const onDisk = await readGastosFile(dataPath, { dbPath })
    assert.equal(onDisk.months['2026-10'].expenses[0].charges[0].name, 'Lentes')

    const db = openGastosDb({ dbPath })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM charges').get().n, 1)
    assert.equal(db.prepare('SELECT name FROM charges').get().name, 'Lentes')

    const readRes = mockRes()
    await handleGastosApi(getReq(), readRes, () => {}, { dbPath, dataPath })
    const again = JSON.parse(readRes.body)
    assert.equal(again.months['2026-10'].expenses[0].charges[0].name, 'Lentes')

    closeGastosDb(dbPath)
    const reopened = openGastosDb({ dbPath })
    const afterRestart = readHouseholdState(reopened)
    assert.equal(afterRestart.months['2026-10'].expenses[0].charges[0].name, 'Lentes')
  })

  it('rejects invalid JSON without writing months', async () => {
    const res = mockRes()
    await handleGastosApi(putReq('{not-json'), res, () => {}, { dbPath, dataPath })
    assert.equal(res.statusCode, 400)
    const db = openGastosDb({ dbPath })
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM months').get().n, 0)
  })
})
