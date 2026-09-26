import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeGastosDb, ensureGastosDb, getMeta } from './db.js'
import { listBolsas, readBolsa } from './bolsa-db.js'
import { createTiggoBolsaSeed } from './bolsa-seed.js'

describe('bolsa db (Tiggo 4 Pro MVP)', () => {
  const dirs = []

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      closeGastosDb(path.join(dir, 'data', 'gastos.sqlite'))
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  async function tmpRoot() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-bolsa-'))
    dirs.push(dir)
    await fs.mkdir(path.join(dir, 'data'), { recursive: true })
    return dir
  }

  it('seeds one Tiggo 4 bolsa on first DB init with 25 movements', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    const bolsas = await listBolsas(db)
    assert.equal(bolsas.length, 1)
    assert.equal(bolsas[0].id, 'bolsa-tiggo-4-crediq')
    assert.equal(bolsas[0].name, 'Chery Tiggo 4 Pro (CrediQ)')
    assert.equal(bolsas[0].accountNumber, '0660000001280')
    assert.equal(bolsas[0].plate, 'M 419693')
    assert.notEqual(bolsas[0].accountNumber, '0660000001693')

    const detail = await readBolsa(db, bolsas[0].id)
    assert.equal(detail.capitalBalanceCents, 2007833)
    assert.equal(detail.totalCurrentCents, 2008171)
    assert.equal(detail.installmentCents, 43311)
    assert.equal(detail.paymentDay, 5)
    assert.equal(detail.interestRate, 14.68)
    assert.equal(detail.movements.length, 25)
    assert.equal(detail.budgetExpenseId, 'exp-ot-camioneta')

    const schemaVersion = Number(await getMeta(db, 'schema_version'))
    assert.equal(schemaVersion, 2)
  })

  it('does not re-seed when bolsas already exist', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    assert.equal((await listBolsas(db)).length, 1)
    const { bolsa } = createTiggoBolsaSeed()
    await db.prepare('UPDATE bolsas SET name = ? WHERE id = ?').run('Renamed Tiggo 4', bolsa.id)
    await ensureGastosDb({ root })
    const after = await listBolsas(db)
    assert.equal(after.length, 1)
    assert.equal(after[0].name, 'Renamed Tiggo 4')
  })
})
