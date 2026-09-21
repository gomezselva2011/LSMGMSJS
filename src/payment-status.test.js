import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createOctoberSeed } from './seed.js'
import {
  STATUS_PAID,
  STATUS_PARTIAL,
  STATUS_UNPAID,
  formatOverdueLede,
  dueDateFromMonth,
  isDueBeforeToday,
  isDueTodayOrPast,
  isOutstanding,
  isPaidLine,
  listOverduePayments,
  normalizePaymentStatus,
  paymentStatusLabel,
  setLinePaid,
} from './payment-status.js'

const TODAY = new Date(2026, 8, 21)

function monthFixture() {
  return {
    categories: [
      { id: 'cat-otros', name: 'Otros gastos' },
      { id: 'cat-praderas', name: 'Casa Praderas de Sandino' },
    ],
    expenses: [
      {
        id: 'exp-luz',
        name: 'Luz',
        amount: 30400,
        categoryId: 'cat-praderas',
        dueDay: 10,
        currency: 'USD',
        paymentStatus: 'unpaid',
      },
      {
        id: 'exp-casa',
        name: 'Casa',
        amount: 22000,
        categoryId: 'cat-praderas',
        dueDay: 15,
        currency: 'USD',
        paymentStatus: 'paid',
      },
      {
        id: 'exp-iglesia',
        name: 'Iglesia',
        amount: 50000,
        categoryId: 'cat-otros',
        dueDay: null,
        currency: 'NIO',
      },
      {
        id: 'exp-tc',
        name: 'TC Melissa',
        amount: 90000,
        categoryId: 'cat-otros',
        dueDay: 8,
        currency: 'USD',
        paymentStatus: 'partial',
        charges: [
          { id: 'chg-lentes', name: 'Lentes', amount: 20000, dueDay: 5, paymentStatus: 'unpaid' },
          { id: 'chg-comida', name: 'Comida', amount: 10000 },
        ],
      },
    ],
  }
}

describe('normalizePaymentStatus', () => {
  it('defaults missing status to unpaid', () => {
    assert.equal(normalizePaymentStatus({}), STATUS_UNPAID)
    assert.equal(normalizePaymentStatus(null), STATUS_UNPAID)
  })

  it('reads paid, partial, unpaid and Spanish aliases', () => {
    assert.equal(normalizePaymentStatus({ paymentStatus: 'paid' }), STATUS_PAID)
    assert.equal(normalizePaymentStatus({ paymentStatus: 'parcial' }), STATUS_PARTIAL)
    assert.equal(normalizePaymentStatus({ paid: true }), STATUS_PAID)
    assert.equal(normalizePaymentStatus({ estado: 'atrasado' }), 'late')
  })
})

describe('isDueBeforeToday', () => {
  it('uses dueDay + month key against today', () => {
    assert.equal(isDueBeforeToday(10, '2026-09', TODAY), true)
    assert.equal(isDueBeforeToday(21, '2026-09', TODAY), false)
    assert.equal(isDueBeforeToday(22, '2026-09', TODAY), false)
    assert.equal(isDueBeforeToday(1, '2026-10', TODAY), false)
    assert.equal(isDueBeforeToday(31, '2026-08', TODAY), true)
    assert.equal(isDueBeforeToday(null, '2026-09', TODAY), false)
  })
})

describe('isDueTodayOrPast', () => {
  it('counts today and past days, not future days, using local calendar dates', () => {
    assert.equal(isDueTodayOrPast(10, '2026-09', TODAY), true)
    assert.equal(isDueTodayOrPast(21, '2026-09', TODAY), true)
    assert.equal(isDueTodayOrPast(22, '2026-09', TODAY), false)
    assert.equal(isDueTodayOrPast(1, '2026-10', TODAY), false)
    assert.equal(isDueTodayOrPast(31, '2026-08', TODAY), true)
    assert.equal(isDueTodayOrPast(null, '2026-09', TODAY), false)
  })

  it('builds due dates from the month key in local time, not UTC midnight', () => {
    const due = dueDateFromMonth(21, '2026-09')
    assert.equal(due.getFullYear(), 2026)
    assert.equal(due.getMonth(), 8)
    assert.equal(due.getDate(), 21)
  })
})

describe('setLinePaid', () => {
  it('marks paid and unpaid on the line without dropping the amount', () => {
    const item = { name: 'Luz', amount: 30400, paymentStatus: 'unpaid', paid: false }
    setLinePaid(item, true)
    assert.equal(item.paymentStatus, STATUS_PAID)
    assert.equal(item.paid, true)
    assert.equal(item.amount, 30400)
    assert.equal(isPaidLine(item), true)
    assert.equal(isOutstanding(item), false)
    setLinePaid(item, false)
    assert.equal(item.paymentStatus, STATUS_UNPAID)
    assert.equal(item.paid, false)
    assert.equal(isPaidLine(item), false)
    assert.equal(isOutstanding(item), true)
  })

  it('overrides a leftover paid boolean so unchecking is unpaid', () => {
    const item = { paymentStatus: 'unpaid', paid: true }
    assert.equal(isPaidLine(item), true)
    setLinePaid(item, false)
    assert.equal(isPaidLine(item), false)
    assert.equal(normalizePaymentStatus(item), STATUS_UNPAID)
  })
})

describe('listOverduePayments', () => {
  it('lists unpaid and partial expenses whose due date is today or already passed', () => {
    const lines = listOverduePayments(monthFixture(), '2026-09', TODAY)
    assert.deepEqual(
      lines.map((line) => line.id),
      ['exp-tc:chg-lentes', 'exp-tc', 'exp-luz'],
    )
    assert.equal(lines[0].kind, 'charge')
    assert.equal(lines[0].parentName, 'TC Melissa')
    assert.equal(lines[0].categoryName, 'Otros gastos')
    assert.equal(lines[2].name, 'Luz')
    assert.equal(lines[2].dueDay, 10)
  })

  it('includes an unpaid line due today and skips paid past-due and future unpaid', () => {
    const month = monthFixture()
    month.expenses.push(
      {
        id: 'exp-hoy',
        name: 'Internet',
        amount: 6000,
        categoryId: 'cat-otros',
        dueDay: 21,
        currency: 'USD',
        paymentStatus: 'unpaid',
      },
      {
        id: 'exp-futuro',
        name: 'Celular',
        amount: 4000,
        categoryId: 'cat-otros',
        dueDay: 28,
        currency: 'USD',
        paymentStatus: 'unpaid',
      },
    )
    const lines = listOverduePayments(month, '2026-09', TODAY)
    assert.equal(lines.some((line) => line.name === 'Internet'), true)
    assert.equal(lines.some((line) => line.name === 'Celular'), false)
    assert.equal(lines.some((line) => line.name === 'Casa'), false)
    const casa = month.expenses.find((item) => item.id === 'exp-casa')
    setLinePaid(casa, false)
    const afterUncheck = listOverduePayments(month, '2026-09', TODAY)
    assert.equal(afterUncheck.some((line) => line.name === 'Casa'), true)
    setLinePaid(month.expenses.find((item) => item.id === 'exp-luz'), true)
    const afterPay = listOverduePayments(month, '2026-09', TODAY)
    assert.equal(afterPay.some((line) => line.name === 'Luz'), false)
  })

  it('omits paid lines, lines without a due day, and future months', () => {
    const september = listOverduePayments(monthFixture(), '2026-09', TODAY)
    assert.equal(september.some((line) => line.name === 'Casa'), false)
    assert.equal(september.some((line) => line.name === 'Iglesia'), false)
    assert.equal(september.some((line) => line.name === 'Comida'), false)
    assert.deepEqual(listOverduePayments(monthFixture(), '2026-10', TODAY), [])
  })

  it('is outstanding for unpaid, partial, and late — not paid', () => {
    assert.equal(isOutstanding({ paymentStatus: 'paid' }), false)
    assert.equal(isOutstanding({ paymentStatus: 'partial' }), true)
    assert.equal(isOutstanding({ paymentStatus: 'late' }), true)
    assert.equal(paymentStatusLabel('partial'), 'Pago parcial')
  })

  it('finds no October seed dues late on 21 Sep 2026, and finds them after the month ends', () => {
    const october = createOctoberSeed()
    assert.deepEqual(listOverduePayments(october, '2026-10', TODAY), [])
    const afterOctober = listOverduePayments(october, '2026-10', new Date(2026, 10, 1))
    assert.ok(afterOctober.length > 0)
    assert.ok(afterOctober.every((line) => line.dueDay && line.dueDay <= 31))
    assert.equal(afterOctober.some((line) => line.name === 'Iglesia'), false)
  })
})

describe('formatOverdueLede', () => {
  it('keeps singular and plural nouns defined', () => {
    assert.equal(
      formatOverdueLede(1, 'septiembre 2026'),
      '1 gasto de septiembre 2026 ya venció o vence hoy y sigue sin pagar o solo se pagó en parte.',
    )
    assert.equal(
      formatOverdueLede(3, 'agosto 2026'),
      '3 gastos de agosto 2026 ya vencieron o vencen hoy y siguen sin pagar o solo se pagaron en parte.',
    )
  })
})
