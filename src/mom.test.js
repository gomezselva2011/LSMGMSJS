import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cloneMonth, createOctoberSeed } from './seed.js'
import {
  compareSavedMonths,
  defaultComparePair,
  matchExpenseLines,
  normalizeExpenseName,
  parentExpenseLines,
} from './mom.js'

describe('normalizeExpenseName', () => {
  it('ignores case, accents, and extra punctuation', () => {
    assert.equal(normalizeExpenseName('TC Melissa'), normalizeExpenseName('tc  melissa'))
    assert.equal(normalizeExpenseName('Comida'), normalizeExpenseName('comida.'))
    assert.equal(normalizeExpenseName('Luz'), normalizeExpenseName('LUZ'))
    assert.equal(normalizeExpenseName('Agua RSA'), 'agua rsa')
  })
})

describe('parentExpenseLines', () => {
  it('uses the parent amount and ignores subgastos', () => {
    const month = createOctoberSeed()
    const card = month.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    card.charges = [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }]
    const line = parentExpenseLines(month).find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(line.usd, 80000)
  })

  it('converts NIO with that month’s rate', () => {
    const month = createOctoberSeed()
    month.exchangeRate = 36.6
    month.expenses = [
      { id: 'exp-nio', name: 'Agua extra', amount: 36600, currency: 'NIO', categoryId: 'cat-otros' },
    ]
    const line = parentExpenseLines(month)[0]
    assert.equal(line.usd, 1000)
  })
})

describe('matchExpenseLines', () => {
  it('classifies rise, fall, new, and gone by normalized name', () => {
    const prev = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Casa' }],
      expenses: [
        { id: 'exp-tc', name: 'TC Melissa', amount: 80000, categoryId: 'cat-a' },
        { id: 'exp-food', name: 'Comida', amount: 50000, categoryId: 'cat-a' },
        { id: 'exp-gone', name: 'Doña Pina', amount: 12000, categoryId: 'cat-a' },
      ],
    })
    const next = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Casa' }],
      expenses: [
        { id: 'exp-tc', name: 'TC Melissa', amount: 90000, categoryId: 'cat-a' },
        { id: 'exp-food', name: 'Comida', amount: 40000, categoryId: 'cat-a' },
        { id: 'exp-new', name: 'Seguro auto', amount: 15000, categoryId: 'cat-a' },
      ],
    })
    const diff = matchExpenseLines(prev, next)
    assert.equal(diff.risen[0].next.name, 'TC Melissa')
    assert.equal(diff.risen[0].delta, 10000)
    assert.equal(diff.fallen[0].next.name, 'Comida')
    assert.equal(diff.fallen[0].delta, -10000)
    assert.equal(diff.added[0].name, 'Seguro auto')
    assert.equal(diff.removed[0].name, 'Doña Pina')
  })

  it('treats a renamed copy as new + gone even when the id is the same', () => {
    const prev = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Otros' }],
      expenses: [{ id: 'exp-ot-tc-melissa', name: 'TC Melissa', amount: 80000, categoryId: 'cat-a' }],
    })
    const next = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Otros' }],
      expenses: [{ id: 'exp-ot-tc-melissa', name: 'Tarjeta Melissa', amount: 80000, categoryId: 'cat-a' }],
    })
    const diff = matchExpenseLines(prev, next)
    assert.equal(diff.added[0].name, 'Tarjeta Melissa')
    assert.equal(diff.removed[0].name, 'TC Melissa')
    assert.equal(diff.risen.length, 0)
    assert.equal(diff.fallen.length, 0)
  })

  it('keeps two homonyms apart by id after Crear mes', () => {
    const prev = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [
        { id: 'sa', name: 'San Andrés' },
        { id: 'pr', name: 'Praderas' },
      ],
      expenses: [
        { id: 'luz-sa', name: 'Luz', amount: 0, categoryId: 'sa' },
        { id: 'luz-pr', name: 'Luz', amount: 30400, categoryId: 'pr' },
      ],
    })
    const next = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [
        { id: 'sa', name: 'San Andrés' },
        { id: 'pr', name: 'Praderas' },
      ],
      expenses: [
        { id: 'luz-sa', name: 'Luz', amount: 0, categoryId: 'sa' },
        { id: 'luz-pr', name: 'Luz', amount: 35000, categoryId: 'pr' },
      ],
    })
    const diff = matchExpenseLines(prev, next)
    assert.equal(diff.risen.length, 1)
    assert.equal(diff.risen[0].prev.id, 'luz-pr')
    assert.equal(diff.risen[0].delta, 4600)
    assert.equal(diff.unchanged.length, 1)
    assert.equal(diff.unchanged[0].next.id, 'luz-sa')
  })

  it('matches a replacement line by name when the id is new', () => {
    const prev = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Casa' }],
      expenses: [{ id: 'old', name: 'Internet', amount: 7000, categoryId: 'cat-a' }],
    })
    const next = parentExpenseLines({
      exchangeRate: 36.6,
      categories: [{ id: 'cat-a', name: 'Casa' }],
      expenses: [{ id: 'new', name: 'Internet', amount: 8000, categoryId: 'cat-a' }],
    })
    const diff = matchExpenseLines(prev, next)
    assert.equal(diff.risen[0].delta, 1000)
    assert.equal(diff.added.length, 0)
    assert.equal(diff.removed.length, 0)
  })
})

describe('compareSavedMonths', () => {
  it('compares consecutive copied months on parent USD amounts', () => {
    const october = createOctoberSeed()
    const november = cloneMonth(october)
    november.expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount = 90000
    november.expenses.find((item) => item.id === 'exp-pr-comida').amount = 40000
    november.expenses.push({
      id: 'exp-seguro',
      name: 'Seguro auto',
      amount: 15000,
      categoryId: 'cat-otros',
      dueDay: 5,
    })
    const state = { months: { '2026-10': october, '2026-11': november } }
    const diff = compareSavedMonths(state, '2026-10', '2026-11')
    assert.equal(diff.ok, true)
    assert.equal(diff.risen.some((row) => row.next.name === 'TC Melissa' && row.delta === 10000), true)
    assert.equal(diff.fallen.some((row) => row.next.name === 'Comida' && row.delta === -10000), true)
    assert.equal(diff.added.some((row) => row.name === 'Seguro auto'), true)
  })
})

describe('defaultComparePair', () => {
  it('defaults to the month before the current one', () => {
    assert.deepEqual(defaultComparePair(['2026-10', '2026-11', '2026-12'], '2026-11'), {
      from: '2026-10',
      to: '2026-11',
    })
  })

  it('keeps a valid A vs B pick', () => {
    assert.deepEqual(
      defaultComparePair(['2026-10', '2026-11', '2026-12'], '2026-12', '2026-10', '2026-12'),
      { from: '2026-10', to: '2026-12' },
    )
  })
})
