import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createOctoberSeed } from './seed.js'
import {
  STATUS_PAID,
  STATUS_PARTIAL,
  STATUS_UNPAID,
  formatOverdueLede,
  isDueBeforeToday,
  isOutstanding,
  listOverduePayments,
  normalizePaymentStatus,
  paymentStatusLabel,
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

describe('listOverduePayments', () => {
  it('lists unpaid and partial expenses whose due date is before today', () => {
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
      '1 gasto de septiembre 2026 ya pasó su fecha y sigue sin pagar o solo se pagó en parte.',
    )
    assert.equal(
      formatOverdueLede(3, 'agosto 2026'),
      '3 gastos de agosto 2026 ya pasaron su fecha y siguen sin pagar o solo se pagaron en parte.',
    )
  })
})
