import {
  STORAGE_KEY,
  SEEDED_MONTH,
  CATEGORY_OTROS,
  CATEGORY_PRADERAS,
  CATEGORY_SAN_ANDRES,
  createOctoberSeed,
  createEmptyMonth,
} from './seed.js'
import { newId } from './format.js'
import {
  DEFAULT_EXCHANGE_RATE,
  convertCents,
  isValidRate,
  normalizeCurrency,
} from './money.js'

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
  return {
    id,
    name,
    amount: Math.round(amount),
    currency: normalizeCurrency(raw.currency),
  }
}

export function emptyDetails() {
  return {
    accountNumber: '',
    monthlyUsd: null,
    monthlyNio: null,
    expectedUsd: null,
    expectedNio: null,
    notes: '',
  }
}

function normalizeOptionalCents(value) {
  if (value == null || value === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount)
}

export function normalizeDetails(raw) {
  if (!raw || typeof raw !== 'object') return emptyDetails()
  return {
    accountNumber: String(raw.accountNumber ?? '').trim().slice(0, 80),
    monthlyUsd: normalizeOptionalCents(raw.monthlyUsd),
    monthlyNio: normalizeOptionalCents(raw.monthlyNio),
    expectedUsd: normalizeOptionalCents(raw.expectedUsd),
    expectedNio: normalizeOptionalCents(raw.expectedNio),
    notes: String(raw.notes ?? '').slice(0, 2000),
  }
}

export function detailsAreEmpty(details) {
  const d = normalizeDetails(details)
  return (
    !d.accountNumber &&
    d.monthlyUsd == null &&
    d.monthlyNio == null &&
    d.expectedUsd == null &&
    d.expectedNio == null &&
    !d.notes.trim()
  )
}

export function normalizeIncome(raw) {
  if (!raw || typeof raw !== 'object') return raw
  raw.currency = normalizeCurrency(raw.currency)
  return raw
}

export function normalizeExpense(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const hasExplicit = typeof raw.isCard === 'boolean'
  raw.isCard = hasExplicit ? raw.isCard : looksLikeCardName(raw.name)
  raw.charges = Array.isArray(raw.charges) ? raw.charges.map(normalizeCharge).filter(Boolean) : []
  raw.currency = normalizeCurrency(raw.currency)
  raw.details = normalizeDetails(raw.details)
  return raw
}

export const LAYOUT_HALF = 'half'
export const LAYOUT_FULL = 'full'

export function normalizeLayout(value) {
  return value === LAYOUT_HALF ? LAYOUT_HALF : value === LAYOUT_FULL ? LAYOUT_FULL : null
}

export function inferredCategoryLayout(category, index, total) {
  if (category?.id === CATEGORY_SAN_ANDRES || category?.id === CATEGORY_PRADERAS) return LAYOUT_HALF
  if (category?.id === CATEGORY_OTROS) return LAYOUT_FULL
  if (total % 2 === 1 && index === total - 1) return LAYOUT_FULL
  return LAYOUT_HALF
}

export function normalizeCategory(raw, index = 0, total = 1) {
  if (!raw || typeof raw !== 'object') return raw
  raw.layout = normalizeLayout(raw.layout) ?? inferredCategoryLayout(raw, index, total)
  return raw
}

export function normalizeMonth(month) {
  if (!month || typeof month !== 'object') return createEmptyMonth()
  if (!Array.isArray(month.incomes)) month.incomes = []
  if (!Array.isArray(month.categories)) month.categories = []
  if (!Array.isArray(month.expenses)) month.expenses = []
  if (!Object.prototype.hasOwnProperty.call(month, 'exchangeRate') || month.exchangeRate === undefined) {
    month.exchangeRate = DEFAULT_EXCHANGE_RATE
  }
  month.incomes.forEach(normalizeIncome)
  month.categories.forEach((category, index) =>
    normalizeCategory(category, index, month.categories.length),
  )
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

export function sumCharges(expense, rate, targetCurrency) {
  const target = normalizeCurrency(targetCurrency ?? expense?.currency)
  let total = 0
  for (const charge of expense?.charges ?? []) {
    const converted = convertCents(charge.amount, charge.currency, target, rate)
    if (converted == null) return null
    total += converted
  }
  return total
}

export function cardSummary(expense, rate) {
  const currency = normalizeCurrency(expense?.currency)
  const pago = expense?.amount || 0
  const needsRate = (expense?.charges ?? []).some(
    (charge) => normalizeCurrency(charge.currency) !== currency,
  )
  if (needsRate && !isValidRate(rate)) {
    return { pago, cargado: null, disponible: null, currency, ok: false }
  }
  const cargado = sumCharges(expense, rate, currency)
  if (cargado == null) {
    return { pago, cargado: null, disponible: null, currency, ok: false }
  }
  return { pago, cargado, disponible: pago - cargado, currency, ok: true }
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
