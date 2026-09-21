import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { STORAGE_KEY, SEEDED_MONTH, createOctoberSeed } from './seed.js'

function installLocalStorage() {
  const data = new Map()
  const localStorage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(String(key), String(value))
    },
    removeItem(key) {
      data.delete(String(key))
    },
    clear() {
      data.clear()
    },
    key(index) {
      return [...data.keys()][index] ?? null
    },
    get length() {
      return data.size
    },
  }
  globalThis.window = { localStorage }
  return data
}

const memory = installLocalStorage()
const {
  loadState,
  saveState,
  loadHousehold,
  emptyMonthFor,
  restoreOctoberMonth,
  restoreOctoberPreservingOthers,
  createInitialState,
  normalizeExpense,
  coerceState,
  importStateFromText,
  cloneMonth,
  GASTOS_API_PATH,
} = await import('./storage.js')

const LENTES = { id: 'chg-lentes', name: 'Lentes', amount: 20000, currency: 'USD' }
const CELULAR = { id: 'chg-celular', name: 'Celular', amount: 30000, currency: 'USD' }

function octoberWithCharges(charges) {
  const month = createOctoberSeed()
  const card = month.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
  card.charges = charges
  return month
}

function savedState(overrides = {}) {
  return {
    version: 1,
    currentMonth: SEEDED_MONTH,
    months: {
      [SEEDED_MONTH]: octoberWithCharges([LENTES, CELULAR]),
    },
    ...overrides,
  }
}

beforeEach(() => {
  memory.clear()
  delete window.fetch
})

describe('emptyMonthFor', () => {
  it('does not plant the October seed (empty charges on TC lines)', () => {
    const month = emptyMonthFor(SEEDED_MONTH)
    assert.equal(month.expenses.length, 0)
    assert.equal(
      month.expenses.some((item) => item.id === 'exp-ot-tc-melissa'),
      false,
    )
  })
})

describe('cloneMonth', () => {
  it('copies incomes, expenses, charges, layouts, statuses and rubros without sharing objects', () => {
    const source = createOctoberSeed()
    const card = source.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    card.charges = [{ id: 'chg-lentes', name: 'Lentes', amount: 20000, currency: 'USD' }]
    card.paymentStatus = 'paid'
    card.rubro = 'credito'
    source.categories[0].layout = 'full'

    const copy = cloneMonth(source)
    assert.equal(copy.incomes.length, source.incomes.length)
    assert.equal(copy.expenses.length, source.expenses.length)
    assert.equal(copy.categories[0].layout, 'full')
    const copyCard = copy.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(copyCard.charges[0].name, 'Lentes')
    assert.equal(copyCard.paymentStatus, 'paid')
    assert.equal(copyCard.rubro, 'credito')

    copyCard.amount = 1
    copyCard.charges[0].name = 'changed'
    copy.incomes[0].amount = 1
    copy.categories[0].layout = 'half'
    assert.equal(card.amount, 80000)
    assert.equal(card.charges[0].name, 'Lentes')
    assert.equal(source.incomes[0].amount, 258000)
    assert.equal(source.categories[0].layout, 'full')
  })

  it('Crear septiembre copies into 2026-09 without sharing the October object', () => {
    const october = createOctoberSeed()
    const card = october.expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    card.amount = 80000
    const months = { '2026-10': october }
    months['2026-09'] = cloneMonth(months['2026-10'])
    const september = months['2026-09']
    september.expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount = 90000
    september.exchangeRate = 40
    assert.equal(months['2026-10'].expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount, 80000)
    assert.equal(months['2026-10'].exchangeRate, october.exchangeRate)
    assert.equal(september.expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount, 90000)
  })
})

describe('normalizeExpense charges', () => {
  it('keeps existing charges and fills [] only when missing', () => {
    const withCharges = normalizeExpense({
      id: 'exp-ot-tc-melissa',
      name: 'TC Melissa',
      amount: 80000,
      charges: [LENTES, CELULAR],
    })
    assert.equal(withCharges.charges.length, 2)
    assert.equal(withCharges.charges[0].name, 'Lentes')
    assert.equal(withCharges.charges[1].amount, 30000)

    const missing = normalizeExpense({ id: 'exp-x', name: 'Luz', amount: 0 })
    assert.deepEqual(missing.charges, [])
  })

  it('does not drop charges stored as subgastos or unknown extra fields', () => {
    const next = normalizeExpense({
      id: 'exp-ot-tc-melissa',
      name: 'TC Melissa',
      amount: 80000,
      extra: 'keep-me',
      subgastos: [{ nombre: 'Lentes', monto: 20000, moneda: 'USD' }],
    })
    assert.equal(next.extra, 'keep-me')
    assert.equal(next.charges.length, 1)
    assert.equal(next.charges[0].name, 'Lentes')
    assert.equal(next.charges[0].amount, 20000)
  })
})

describe('saveState / loadState charges', () => {
  it('round-trips subgastos on TC Melissa', () => {
    const state = savedState()
    saveState(state)
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(loaded.fromStorage, true)
    assert.equal(card.charges.length, 2)
    assert.equal(card.charges[0].name, 'Lentes')
    assert.equal(card.charges[1].name, 'Celular')
    assert.equal(card.charges[0].amount, 20000)
    assert.equal(card.charges[1].currency, 'USD')
  })

  it('keeps charges when the saved schema version is unknown', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(savedState({ version: 7, extraMeta: { foo: 1 } })),
    )
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 2)
    assert.equal(loaded.state.extraMeta.foo, 1)
  })

  it('keeps charges when version is missing', () => {
    const payload = savedState()
    delete payload.version
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 2)
  })

  it('does not replace a saved October with seed on boot', () => {
    saveState(savedState())
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    const seedCard = createOctoberSeed().expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(seedCard.charges.length, 0)
    assert.equal(card.charges.length, 2)
  })

  it('does not plant seed October when only November exists', () => {
    const november = octoberWithCharges([LENTES, CELULAR])
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        currentMonth: SEEDED_MONTH,
        months: { '2026-11': november },
      }),
    )
    const loaded = loadState()
    assert.equal(loaded.state.currentMonth, '2026-11')
    assert.equal(Boolean(loaded.state.months[SEEDED_MONTH]), false)
    const card = loaded.state.months['2026-11'].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 2)
  })

  it('migrates charges from a legacy storage key instead of reseeding', () => {
    window.localStorage.setItem(
      'gastos-hogar-v2',
      JSON.stringify(savedState({ version: 2 })),
    )
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 2)
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY))
    const persistedCard = persisted.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(persistedCard.charges.length, 2)
  })

  it('prefers saved charges over a seed copy of the same month', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(createInitialState()))
    window.localStorage.setItem('gastos-hogar-v2', JSON.stringify(savedState({ version: 2 })))
    const loaded = loadState()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 2)
  })

  it('does not overwrite corrupt JSON with the October seed', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not-json')
    assert.throws(() => loadState(), /formato reconocido/)
    assert.equal(window.localStorage.getItem(STORAGE_KEY), '{not-json')
  })
})

describe('Restaurar octubre', () => {
  it('resets October seed charges but keeps other months', () => {
    const state = savedState({
      months: {
        [SEEDED_MONTH]: octoberWithCharges([LENTES]),
        '2026-11': octoberWithCharges([CELULAR]),
      },
    })
    restoreOctoberMonth(state)
    const october = state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    const november = state.months['2026-11'].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(october.charges.length, 0)
    assert.equal(november.charges.length, 1)
    assert.equal(november.charges[0].name, 'Celular')
  })

  it('fatal restore keeps November charges when October is reset', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        savedState({
          months: {
            [SEEDED_MONTH]: octoberWithCharges([LENTES]),
            '2026-11': octoberWithCharges([CELULAR]),
          },
        }),
      ),
    )
    const state = restoreOctoberPreservingOthers()
    const october = state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    const november = state.months['2026-11'].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(october.charges.length, 0)
    assert.equal(november.charges[0].name, 'Celular')
  })
})

describe('coerceState', () => {
  it('accepts a months map without a version field', () => {
    const next = coerceState({
      currentMonth: SEEDED_MONTH,
      months: { [SEEDED_MONTH]: octoberWithCharges([LENTES]) },
    })
    const card = next.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges[0].name, 'Lentes')
    assert.equal(next.version, 1)
  })
})

describe('loadHousehold server store', () => {
  let stored
  let puts

  beforeEach(() => {
    stored = null
    puts = []
    window.fetch = async (url, opts = {}) => {
      assert.equal(String(url).split('?')[0], GASTOS_API_PATH)
      const method = String(opts.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return {
          ok: true,
          async json() {
            return stored ?? {}
          },
        }
      }
      if (method === 'PUT' || method === 'POST') {
        const body = JSON.parse(String(opts.body))
        puts.push(body)
        stored = body
        return { ok: true, async json() { return { ok: true } } }
      }
      return { ok: false, async json() { return {} } }
    }
  })

  it('uses the server file and does not replace it with the October seed', async () => {
    stored = savedState()
    const loaded = await loadHousehold()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    const seedCard = createOctoberSeed().expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(loaded.fromServer, true)
    assert.equal(seedCard.charges.length, 0)
    assert.equal(card.charges.length, 2)
    assert.equal(card.charges[0].name, 'Lentes')
    assert.equal(puts.length >= 1, true)
    assert.equal(
      puts.at(-1).months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa').charges.length,
      2,
    )
  })

  it('seeds once when server and browser are empty, then writes the server file', async () => {
    stored = {}
    const loaded = await loadHousehold()
    assert.equal(loaded.fromStorage, false)
    assert.equal(loaded.fromServer, false)
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges.length, 0)
    assert.equal(puts.length >= 1, true)
    assert.equal(puts.at(-1).currentMonth, SEEDED_MONTH)
  })

  it('copies localStorage to the server when the server file is empty', async () => {
    saveState(savedState())
    stored = {}
    const loaded = await loadHousehold()
    const card = loaded.state.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(loaded.fromStorage, true)
    assert.equal(loaded.fromServer, false)
    assert.equal(card.charges[1].name, 'Celular')
    assert.equal(
      puts.at(-1).months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa').charges[1].name,
      'Celular',
    )
  })

  it('PUT uses currentMonth as the save key when November is open', async () => {
    const october = octoberWithCharges([LENTES])
    const november = octoberWithCharges([CELULAR])
    november.expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount = 90000
    stored = {
      version: 1,
      currentMonth: '2026-11',
      months: {
        [SEEDED_MONTH]: october,
        '2026-11': november,
      },
    }
    const loaded = await loadHousehold()
    assert.equal(loaded.state.currentMonth, '2026-11')
    assert.equal(puts.at(-1).currentMonth, '2026-11')
    assert.equal(puts.at(-1).saveScope, 'current')
    assert.equal(
      puts.at(-1).months['2026-11'].expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount,
      90000,
    )
    assert.equal(
      puts.at(-1).months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa').amount,
      80000,
    )
  })
})

describe('importStateFromText', () => {
  it('loads a downloaded backup without reseeding', () => {
    const next = importStateFromText(JSON.stringify(savedState()))
    const card = next.months[SEEDED_MONTH].expenses.find((item) => item.id === 'exp-ot-tc-melissa')
    assert.equal(card.charges[0].name, 'Lentes')
  })

  it('rejects junk', () => {
    assert.throws(() => importStateFromText('{not-json'), /presupuesto reconocido/)
    assert.throws(() => importStateFromText('{}'), /presupuesto reconocido/)
  })
})
