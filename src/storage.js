import { STORAGE_KEY, SEEDED_MONTH, createOctoberSeed, createEmptyMonth } from './seed.js'

export function createInitialState() {
  return {
    version: 1,
    currentMonth: SEEDED_MONTH,
    months: {
      [SEEDED_MONTH]: createOctoberSeed(),
    },
  }
}

export function emptyMonthFor(monthKey) {
  if (monthKey === SEEDED_MONTH) return createOctoberSeed()
  return createEmptyMonth()
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

  if (!parsed.months[parsed.currentMonth]) {
    parsed.months[parsed.currentMonth] = emptyMonthFor(parsed.currentMonth)
  }

  return { state: parsed, fromStorage: true }
}

export function saveState(state) {
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
