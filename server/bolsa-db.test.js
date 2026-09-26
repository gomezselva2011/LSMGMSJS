import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeGastosDb, ensureGastosDb, getMeta, readHouseholdState } from './db.js'
import { applyBolsaPayment, deleteBolsaMovement, listBolsas, readBolsa } from './bolsa-db.js'
import { writeHouseholdState } from './db.js'
import { createTiggoBolsaSeed } from './bolsa-seed.js'
import { TIGGO_BUDGET_EXPENSE_ID } from '../src/bolsa-budget-link.js'

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
    assert.equal(detail.budgetExpenseId, TIGGO_BUDGET_EXPENSE_ID)

    const schemaVersion = Number(await getMeta(db, 'schema_version'))
    assert.equal(schemaVersion, 2)
  })

  it('applyBolsaPayment marks apply-to month and inserts movement', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    const bolsas = await listBolsas(db)
    const bolsaId = bolsas[0].id
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      saveScope: 'all',
      months: {
        '2026-10': {
          expenses: [
            { id: TIGGO_BUDGET_EXPENSE_ID, name: 'Cuota Tiggo 4 Pro', amount: 43311, paymentStatus: 'unpaid' },
          ],
        },
        '2026-11': {
          expenses: [
            { id: TIGGO_BUDGET_EXPENSE_ID, name: 'Cuota Tiggo 4 Pro', amount: 43311, paymentStatus: 'unpaid' },
          ],
        },
      },
    })
    const before = await readBolsa(db, bolsaId)
    await applyBolsaPayment(db, bolsaId, {
      sourceMonthKey: '2026-10',
      expenseId: TIGGO_BUDGET_EXPENSE_ID,
      applyToMonthKey: '2026-11',
      appliedDate: '2026-11-05',
    })
    const state = await readHouseholdState(db)
    assert.equal(state.months['2026-11'].expenses[0].paymentStatus, 'paid')
    const after = await readBolsa(db, bolsaId)
    assert.equal(after.movements.length, before.movements.length + 1)
    assert.ok(after.capitalBalanceCents < before.capitalBalanceCents)
    assert.equal(after.pendingInstallments, before.pendingInstallments - 1)
    assert.equal(after.paidInstallments, before.paidInstallments + 1)
    const last = after.movements[after.movements.length - 1]
    assert.equal(last.balanceAfterCents, after.capitalBalanceCents)
    assert.equal(last.deletable, true)
  })

  it('deleteBolsaMovement restores capital and budget unpaid', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    const bolsas = await listBolsas(db)
    const bolsaId = bolsas[0].id
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      saveScope: 'all',
      months: {
        '2026-10': {
          expenses: [
            { id: TIGGO_BUDGET_EXPENSE_ID, name: 'Cuota Tiggo 4 Pro', amount: 43311, paymentStatus: 'unpaid' },
          ],
        },
        '2026-11': {
          expenses: [
            { id: TIGGO_BUDGET_EXPENSE_ID, name: 'Cuota Tiggo 4 Pro', amount: 43311, paymentStatus: 'unpaid' },
          ],
        },
      },
    })
    const before = await readBolsa(db, bolsaId)
    await applyBolsaPayment(db, bolsaId, {
      sourceMonthKey: '2026-10',
      expenseId: TIGGO_BUDGET_EXPENSE_ID,
      applyToMonthKey: '2026-11',
      appliedDate: '2026-11-05',
    })
    const applied = await readBolsa(db, bolsaId)
    const manualId = applied.movements[applied.movements.length - 1].id
    await deleteBolsaMovement(db, bolsaId, manualId)
    const after = await readBolsa(db, bolsaId)
    assert.equal(after.movements.length, before.movements.length)
    assert.equal(after.capitalBalanceCents, before.capitalBalanceCents)
    assert.equal(after.pendingInstallments, before.pendingInstallments)
    const state = await readHouseholdState(db)
    assert.equal(state.months['2026-11'].expenses[0].paymentStatus, 'unpaid')
  })

  it('applyBolsaPayment rejects Himla line for Tiggo bolsa', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    const bolsaId = (await listBolsas(db))[0].id
    await writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      saveScope: 'all',
      months: {
        '2026-10': {
          expenses: [{ id: 'exp-ot-camioneta', name: 'Himla', amount: 62000, paymentStatus: 'unpaid' }],
        },
        '2026-11': {
          expenses: [{ id: 'exp-ot-camioneta', name: 'Himla', amount: 62000, paymentStatus: 'unpaid' }],
        },
      },
    })
    await assert.rejects(
      () =>
        applyBolsaPayment(db, bolsaId, {
          sourceMonthKey: '2026-10',
          expenseId: 'exp-ot-camioneta',
          applyToMonthKey: '2026-11',
          appliedDate: '2026-11-20',
        }),
      (error) => {
        assert.equal(error.code, 'EXPENSE_MISMATCH')
        return true
      },
    )
  })

  it('deleteBolsaMovement rejects seeded PDF movements', async () => {
    const root = await tmpRoot()
    const db = await ensureGastosDb({ root })
    const bolsaId = (await listBolsas(db))[0].id
    const detail = await readBolsa(db, bolsaId)
    await assert.rejects(() => deleteBolsaMovement(db, bolsaId, detail.movements[0].id), (error) => {
      assert.equal(error.code, 'NOT_DELETABLE')
      return true
    })
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
