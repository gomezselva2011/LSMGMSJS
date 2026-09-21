import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createOctoberSeed } from './seed.js'
import { monthTotals } from './money.js'
import {
  monthPaidUnpaidTotals,
  normalizePaymentStatus,
  splitParentPaidUnpaid,
} from './payment-totals.js'
import { analyticsHtml } from './analytics.js'
import { setLinePaid } from './payment-status.js'

describe('normalizePaymentStatus', () => {
  it('maps paid, partial, unpaid, and late aliases', () => {
    assert.equal(normalizePaymentStatus('paid'), 'paid')
    assert.equal(normalizePaymentStatus('Pagado'), 'paid')
    assert.equal(normalizePaymentStatus('partial'), 'partial')
    assert.equal(normalizePaymentStatus('parcial'), 'partial')
    assert.equal(normalizePaymentStatus('late'), 'late')
    assert.equal(normalizePaymentStatus('atrasado'), 'late')
    assert.equal(normalizePaymentStatus('unpaid'), 'unpaid')
    assert.equal(normalizePaymentStatus('pendiente'), 'unpaid')
  })

  it('treats missing or unknown status as unpaid', () => {
    assert.equal(normalizePaymentStatus(undefined), 'unpaid')
    assert.equal(normalizePaymentStatus(''), 'unpaid')
    assert.equal(normalizePaymentStatus('mystery'), 'unpaid')
  })
})

describe('splitParentPaidUnpaid', () => {
  it('puts a paid parent fully in pagado', () => {
    const split = splitParentPaidUnpaid(
      { amount: 80000, currency: 'USD', paymentStatus: 'paid' },
      36.6,
    )
    assert.deepEqual(split, { ok: true, paidUsd: 80000, unpaidUsd: 0 })
    assert.deepEqual(
      splitParentPaidUnpaid({ amount: 17200, currency: 'USD', paid: true }, 36.6),
      { ok: true, paidUsd: 17200, unpaidUsd: 0 },
    )
  })

  it('puts unpaid and late parents fully in no pagado', () => {
    assert.deepEqual(
      splitParentPaidUnpaid({ amount: 17200, currency: 'USD', paymentStatus: 'unpaid' }, 36.6),
      { ok: true, paidUsd: 0, unpaidUsd: 17200 },
    )
    assert.deepEqual(
      splitParentPaidUnpaid({ amount: 17200, currency: 'USD', paymentStatus: 'late' }, 36.6),
      { ok: true, paidUsd: 0, unpaidUsd: 17200 },
    )
  })

  it('keeps a partial’s full parent in no pagado until paidAmount exists', () => {
    const split = splitParentPaidUnpaid(
      { amount: 80000, currency: 'USD', paymentStatus: 'partial' },
      36.6,
    )
    assert.deepEqual(split, { ok: true, paidUsd: 0, unpaidUsd: 80000 })
  })

  it('splits a partial when paidAmount exists', () => {
    const split = splitParentPaidUnpaid(
      { amount: 80000, currency: 'USD', paymentStatus: 'partial', paidAmount: 30000 },
      36.6,
    )
    assert.deepEqual(split, { ok: true, paidUsd: 30000, unpaidUsd: 50000 })
  })

  it('converts NIO parent amounts with the month rate', () => {
    const split = splitParentPaidUnpaid(
      { amount: 36600, currency: 'NIO', paymentStatus: 'paid' },
      36.6,
    )
    assert.equal(split.paidUsd, 1000)
    assert.equal(split.unpaidUsd, 0)
  })

  it('ignores subgastos on the parent line', () => {
    const split = splitParentPaidUnpaid(
      {
        amount: 80000,
        currency: 'USD',
        paymentStatus: 'unpaid',
        charges: [{ amount: 20000, currency: 'USD', paymentStatus: 'paid' }],
      },
      36.6,
    )
    assert.deepEqual(split, { ok: true, paidUsd: 0, unpaidUsd: 80000 })
  })
})

describe('monthPaidUnpaidTotals', () => {
  it('counts October seed as all unpaid when no status is set', () => {
    const month = createOctoberSeed()
    const totals = monthPaidUnpaidTotals(month)
    const budget = monthTotals(month)
    assert.equal(totals.ok, true)
    assert.equal(totals.paidUsd, 0)
    assert.equal(totals.unpaidUsd, budget.expensesUsd)
    assert.equal(totals.unpaidUsd, 498114)
  })

  it('moves a paid parent from no pagado to pagado without counting charges', () => {
    const month = createOctoberSeed()
    const before = monthPaidUnpaidTotals(month)
    const card = month.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    card.charges = [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }]
    card.paymentStatus = 'paid'
    const after = monthPaidUnpaidTotals(month)
    assert.equal(after.paidUsd, before.paidUsd + 80000)
    assert.equal(after.unpaidUsd, before.unpaidUsd - 80000)
    assert.equal(after.paidUsd + after.unpaidUsd, before.unpaidUsd)
  })

  it('counts a checkbox-paid parent in ya pagados without dropping the month total', () => {
    const month = createOctoberSeed()
    const budget = monthTotals(month)
    const before = monthPaidUnpaidTotals(month)
    const casa = month.expenses.find((item) => item.id === 'exp-sa-casa')
    setLinePaid(casa, true)
    const after = monthPaidUnpaidTotals(month)
    const still = monthTotals(month)
    assert.equal(after.paidUsd, before.paidUsd + 17200)
    assert.equal(after.unpaidUsd, before.unpaidUsd - 17200)
    assert.equal(still.expensesUsd, budget.expensesUsd)
    setLinePaid(casa, false)
    const restored = monthPaidUnpaidTotals(month)
    assert.equal(restored.paidUsd, before.paidUsd)
    assert.equal(restored.unpaidUsd, before.unpaidUsd)
  })

  it('returns nulls when the month rate is missing', () => {
    const totals = monthPaidUnpaidTotals({ exchangeRate: 0, expenses: [{ amount: 100, currency: 'USD' }] })
    assert.equal(totals.ok, false)
    assert.equal(totals.paidUsd, null)
    assert.equal(totals.unpaidUsd, null)
  })
})

describe('analyticsHtml payment cards', () => {
  it('renders the two cards first, above mes a mes and the charts', () => {
    const month = createOctoberSeed()
    const html = analyticsHtml(
      { currentMonth: '2026-10', months: { '2026-10': month } },
      { currentKey: '2026-10' },
    )
    const paid = html.indexOf('Lo que ya se pagó')
    const unpaid = html.indexOf('Lo que no se ha pagado')
    const mom = html.indexOf('Mes a mes')
    const bars = html.indexOf('Ingresos y gastos')
    assert.ok(paid > 0)
    assert.ok(paid < unpaid)
    assert.ok(unpaid < mom)
    assert.ok(mom < bars)
    assert.match(html, /id="analytics-paid"[^>]*>\$0\.00/)
    assert.match(html, /id="analytics-unpaid"[^>]*>\$4,981\.14/)
  })

  it('renders paid totals after a parent checkbox is marked pagado', () => {
    const month = createOctoberSeed()
    const casa = month.expenses.find((item) => item.id === 'exp-sa-casa')
    setLinePaid(casa, true)
    const html = analyticsHtml(
      { currentMonth: '2026-10', months: { '2026-10': month } },
      { currentKey: '2026-10' },
    )
    assert.match(html, /id="analytics-paid"[^>]*>\$172\.00/)
    assert.match(html, /id="analytics-unpaid"[^>]*>\$4,809\.14/)
  })
})
