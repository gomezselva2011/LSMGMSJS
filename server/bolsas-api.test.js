import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeGastosDb, ensureGastosDb, readHouseholdState, writeHouseholdState } from './db.js'
import { ensureBolsaReady, readBolsa } from './bolsa-db.js'
import { handleBolsasApi, parseBolsasApiUrl } from './bolsas-api.js'
import { TIGGO_BOLSA_ID } from './bolsa-seed.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(value = '') {
      this.body = String(value ?? '')
    },
  }
}

function jsonReq(method, url, body, user) {
  const payload = body == null ? null : JSON.stringify(body)
  return {
    method,
    url,
    headers: body == null ? {} : { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () {
      if (payload) yield Buffer.from(payload)
    },
    gastosUser: user,
  }
}

describe('bolsas API apply-payment', () => {
  let dir
  let dbPath

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-bolsas-api-'))
    await fs.mkdir(path.join(dir, 'data'), { recursive: true })
    dbPath = path.join(dir, 'data', 'gastos.sqlite')
  })

  afterEach(async () => {
    closeGastosDb(dbPath)
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function seedBudget() {
    const db = await ensureGastosDb({ root: dir, dbPath })
    await ensureBolsaReady(db)
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      saveScope: 'all',
      months: {
        '2026-10': {
          expenses: [
            {
              id: 'exp-ot-camioneta',
              name: 'Cuota Tiggo',
              amount: 43311,
              currency: 'USD',
              paymentStatus: 'unpaid',
            },
          ],
        },
        '2026-11': {
          expenses: [
            {
              id: 'exp-ot-camioneta',
              name: 'Cuota Tiggo',
              amount: 43311,
              currency: 'USD',
              paymentStatus: 'unpaid',
            },
          ],
        },
      },
    })
  }

  it('parses apply-payment URL', () => {
    assert.deepEqual(parseBolsasApiUrl('/api/bolsas/bolsa-tiggo-4-crediq/apply-payment'), {
      applyPayment: true,
      id: 'bolsa-tiggo-4-crediq',
    })
  })

  it('applies payment and marks budget line paid', async () => {
    await seedBudget()
    const admin = { id: 'u1', role: 'admin' }
    const req = jsonReq(
      'POST',
      `/api/bolsas/${TIGGO_BOLSA_ID}/apply-payment`,
      {
        sourceMonthKey: '2026-10',
        expenseId: 'exp-ot-camioneta',
        applyToMonthKey: '2026-11',
        appliedDate: '2026-11-05',
      },
      admin,
    )
    const res = mockRes()
    const handled = await handleBolsasApi(req, res, () => {}, {
      dbPath,
      getUser: () => admin,
    })
    assert.equal(handled, true)
    assert.equal(res.statusCode, 200)
    const bolsa = JSON.parse(res.body)
    assert.equal(bolsa.movements.length, 26)

    const db = await ensureGastosDb({ root: dir, dbPath })
    const state = await readHouseholdState(db)
    assert.equal(state.months['2026-11'].expenses[0].paymentStatus, 'paid')
    assert.equal(state.months['2026-10'].expenses[0].paymentStatus, 'unpaid')

    const detail = await readBolsa(db, TIGGO_BOLSA_ID)
    const last = detail.movements[detail.movements.length - 1]
    assert.equal(last.paymentCents, 43311)
    assert.equal(last.appliedDate, '2026-11-05')
    assert.ok(bolsa.capitalBalanceCents < 2007833)
    assert.equal(bolsa.pendingInstallments, 85)
  })

  it('rejects duplicate application', async () => {
    await seedBudget()
    const admin = { id: 'u1', role: 'admin' }
    const payload = {
      sourceMonthKey: '2026-10',
      expenseId: 'exp-ot-camioneta',
      applyToMonthKey: '2026-11',
      appliedDate: '2026-11-05',
    }
    const options = { dbPath, getUser: () => admin }
    await handleBolsasApi(jsonReq('POST', `/api/bolsas/${TIGGO_BOLSA_ID}/apply-payment`, payload, admin), mockRes(), () => {}, options)
    const res = mockRes()
    await handleBolsasApi(jsonReq('POST', `/api/bolsas/${TIGGO_BOLSA_ID}/apply-payment`, payload, admin), res, () => {}, options)
    assert.equal(res.statusCode, 409)
  })

  it('deletes manual movement and reverts budget line', async () => {
    await seedBudget()
    const admin = { id: 'u1', role: 'admin' }
    const options = { dbPath, getUser: () => admin }
    const payload = {
      sourceMonthKey: '2026-10',
      expenseId: 'exp-ot-camioneta',
      applyToMonthKey: '2026-11',
      appliedDate: '2026-11-05',
    }
    const applyRes = mockRes()
    await handleBolsasApi(
      jsonReq('POST', `/api/bolsas/${TIGGO_BOLSA_ID}/apply-payment`, payload, admin),
      applyRes,
      () => {},
      options,
    )
    const applied = JSON.parse(applyRes.body)
    const manualId = applied.movements[applied.movements.length - 1].id

    const delRes = mockRes()
    await handleBolsasApi(
      jsonReq('DELETE', `/api/bolsas/${TIGGO_BOLSA_ID}/movements/${manualId}`, null, admin),
      delRes,
      () => {},
      options,
    )
    assert.equal(delRes.statusCode, 200)
    const bolsa = JSON.parse(delRes.body)
    assert.equal(bolsa.movements.length, 25)

    const db = await ensureGastosDb({ root: dir, dbPath })
    const state = await readHouseholdState(db)
    assert.equal(state.months['2026-11'].expenses[0].paymentStatus, 'unpaid')
  })

  it('forbids deleting seeded movements via API', async () => {
    await seedBudget()
    const admin = { id: 'u1', role: 'admin' }
    const db = await ensureGastosDb({ root: dir, dbPath })
    const detail = await readBolsa(db, TIGGO_BOLSA_ID)
    const res = mockRes()
    await handleBolsasApi(
      jsonReq('DELETE', `/api/bolsas/${TIGGO_BOLSA_ID}/movements/${detail.movements[0].id}`, null, admin),
      res,
      () => {},
      { dbPath, getUser: () => admin },
    )
    assert.equal(res.statusCode, 403)
  })

  it('forbids viewers from applying payment', async () => {
    await seedBudget()
    const viewer = { id: 'u2', role: 'viewer' }
    const res = mockRes()
    await handleBolsasApi(
      jsonReq('POST', `/api/bolsas/${TIGGO_BOLSA_ID}/apply-payment`, {}, viewer),
      res,
      () => {},
      { dbPath, getUser: () => viewer },
    )
    assert.equal(res.statusCode, 403)
  })
})
