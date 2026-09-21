import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

describe('gastos API file store', () => {
  let dir
  let dataPath

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-api-'))
    dataPath = path.join(dir, 'gastos.json')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('GET returns {} when the file is missing', async () => {
    const res = mockRes()
    const handled = await handleGastosApi(getReq(), res, () => {}, { dataPath })
    assert.equal(handled, true)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['Cache-Control'], 'no-store')
    assert.deepEqual(JSON.parse(res.body), {})
  })

  it('PUT writes JSON that survives a later GET', async () => {
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
    await handleGastosApi(putReq(JSON.stringify(payload)), writeRes, () => {}, { dataPath })
    assert.equal(writeRes.statusCode, 200)
    assert.equal(JSON.parse(writeRes.body).ok, true)

    const onDisk = await readGastosFile(dataPath)
    assert.equal(onDisk.months['2026-10'].expenses[0].charges[0].name, 'Lentes')

    const readRes = mockRes()
    await handleGastosApi(getReq(), readRes, () => {}, { dataPath })
    const again = JSON.parse(readRes.body)
    assert.equal(again.months['2026-10'].expenses[0].charges[0].name, 'Lentes')
  })

  it('rejects invalid JSON without creating the file', async () => {
    const res = mockRes()
    await handleGastosApi(putReq('{not-json'), res, () => {}, { dataPath })
    assert.equal(res.statusCode, 400)
    await assert.rejects(() => fs.access(dataPath), /ENOENT/)
  })
})
