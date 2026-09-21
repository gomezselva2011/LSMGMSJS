import { STORAGE_KEY, SEEDED_MONTH, createOctoberSeed, createEmptyMonth } from './seed.js'
import { newId } from './format.js'

export function looksLikeCardName(name) {
  const text = String(name ?? '')
  return /^TC\b/i.test(text) || /tarjeta/i.test(text)
}

export function normalizeCharge(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name ?? '').trim()
  if (!name) return null
  const amount = Number(raw.amount)
  if (!Number.isFinite(amount) || amount < 0) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId('chg')
  return { id, name, amount: Math.round(amount) }
}

export function normalizeExpense(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const hasExplicit = typeof raw.isCard === 'boolean'
  raw.isCard = hasExplicit ? raw.isCard : looksLikeCardName(raw.name)
  raw.charges = Array.isArray(raw.charges) ? raw.charges.map(normalizeCharge).filter(Boolean) : []
  return raw
}

export function normalizeMonth(month) {
  if (!month || typeof month !== 'object') return createEmptyMonth()
  if (!Array.isArray(month.incomes)) month.incomes = []
  if (!Array.isArray(month.categories)) month.categories = []
  if (!Array.isArray(month.expenses)) month.expenses = []
  month.expenses.forEach(normalizeExpense)
  return month
}

export function normalizeState(state) {
  if (!state || typeof state !== 'object') return createInitialState()
  if (!state.months || typeof state.months !== 'object') {
    state.months = {}
  }
  for (const key of Object.keys(state.months)) {
    state.months[key] = normalizeMonth(state.months[key])
  }
  return state
}

export function sumCharges(expense) {
  return (expense?.charges ?? []).reduce((sum, charge) => sum + (charge.amount || 0), 0)
}

export function cardSummary(expense) {
  const pago = expense?.amount || 0
  const cargado = sumCharges(expense)
  return { pago, cargado, disponible: pago - cargado }
}

export function createInitialState() {
  return normalizeState({
    version: 1,
    currentMonth: SEEDED_MONTH,
    months: {
      [SEEDED_MONTH]: createOctoberSeed(),
    },
  })
}

export function emptyMonthFor(monthKey) {
  if (monthKey === SEEDED_MONTH) return normalizeMonth(createOctoberSeed())
  return normalizeMonth(createEmptyMonth())
}

export function loadState() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const state = createInitialState()
    saveState(state)
    return { state, fromStorage: false }
  }

  const parsed = JSON.parse(raw)
  if (!parsed || parsed.version !== 1 || !parsed.months || typeof parsed.months !== 'object') {
    throw new Error('El archivo guardado no tiene un formato reconocido.')
  }

  if (!parsed.currentMonth || !/^\d{4}-\d{2}$/.test(parsed.currentMonth)) {
    parsed.currentMonth = SEEDED_MONTH
  }

  normalizeState(parsed)

  if (!parsed.months[parsed.currentMonth]) {
    parsed.months[parsed.currentMonth] = emptyMonthFor(parsed.currentMonth)
  }

  saveState(parsed)
  return { state: parsed, fromStorage: true }
}

export function saveState(state) {
  normalizeState(state)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function storageAvailable() {
  try {
    const probe = '__gastos-probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
