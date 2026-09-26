import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTiggoBolsaSeed } from './bolsa-seed.js'
import {
  bolsaProjectionFacts,
  computePendingInstallmentSchedule,
  formatProjectionRange,
} from './bolsa-projection.js'

describe('bolsa projection schedule', () => {
  it('Tiggo seed: 86 cuotas from oct 2026 through nov 2033 (día 5, corte 2026-09-26)', () => {
    const { bolsa, movements } = createTiggoBolsaSeed()
    bolsa.movements = movements
    const facts = bolsaProjectionFacts(bolsa, { today: new Date(2026, 8, 26) })
    assert.ok(facts.schedule)
    assert.equal(facts.schedule.dates.length, 86)
    assert.equal(formatProjectionRange(facts.schedule.firstDate, facts.schedule.lastDate), 'oct 2026 – nov 2033')
    assert.equal(facts.schedule.firstDate.getFullYear(), 2026)
    assert.equal(facts.schedule.firstDate.getMonth(), 9)
    assert.equal(facts.schedule.firstDate.getDate(), 5)
    assert.equal(facts.schedule.lastDate.getFullYear(), 2033)
    assert.equal(facts.schedule.lastDate.getMonth(), 10)
    assert.equal(facts.schedule.lastDate.getDate(), 5)
    assert.equal(facts.debtFreeLabel, '05/11/2033')
  })

  it('returns null schedule when there are no pending installments', () => {
    const schedule = computePendingInstallmentSchedule({
      paymentDay: 5,
      pendingInstallments: 0,
      cutDate: '2026-09-26',
    })
    assert.equal(schedule, null)
  })
})
