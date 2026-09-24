import {
  STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  CURRENT_VERSION,
  SEEDED_MONTH,
  CATEGORY_OTROS,
  CATEGORY_PRADERAS,
  CATEGORY_SAN_ANDRES,
  createOctoberSeed,
  createEmptyMonth,
  cloneMonth as duplicateMonth,
} from './seed.js'
import { isMonthKey, newId, shiftMonth } from './format.js'
import {
  DEFAULT_EXCHANGE_RATE,
  convertCents,
  isValidRate,
  normalizeCurrency,
} from './money.js'
import { normalizeRubro } from './rubros.js'

export function looksLikeCardName(name) {
  const text = String(name ?? '')
  return /^TC\b/i.test(text) || /tarjeta/i.test(text)
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function firstAmount(...values) {
  for (const value of values) {
    if (value == null || value === '') continue
    const amount = Number(value)
    if (Number.isFinite(amount) && amount >= 0) return Math.round(amount)
  }
  return null
}

function ownDueDay(value) {
  const day = Number(value)
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}

export function normalizeCharge(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = firstText(raw.name, raw.nombre, raw.title, raw.concepto, raw.label)
  const amount = firstAmount(raw.amount, raw.monto, raw.cents, raw.value, raw.pago)
  if (!name && amount == null) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : newId('chg')
  const charge = {
    id,
    name: name || 'Subgasto',
    amount: amount ?? 0,
    currency: normalizeCurrency(raw.currency ?? raw.moneda),
  }
  const dueDay = ownDueDay(raw.dueDay ?? raw.dia)
  if (dueDay != null) charge.dueDay = dueDay
  if (raw.paymentStatus != null && raw.paymentStatus !== '') charge.paymentStatus = raw.paymentStatus
  else if (raw.pagoEstado != null && raw.pagoEstado !== '') charge.paymentStatus = raw.pagoEstado
  else if (typeof raw.paid === 'boolean') charge.paymentStatus = raw.paid ? 'paid' : 'unpaid'
  return charge
}

function asChargeList(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

export function readExpenseCharges(raw) {
  const lists = [
    asChargeList(raw?.charges),
    asChargeList(raw?.subgastos),
    asChargeList(raw?.cargos),
  ]
  let best = lists[0]
  for (const list of lists) {
    if (list.length > best.length) best = list
  }
  return best
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
  raw.charges = readExpenseCharges(raw).map(normalizeCharge).filter(Boolean)
  raw.currency = normalizeCurrency(raw.currency)
  raw.details = normalizeDetails(raw.details)
  const dueDay = ownDueDay(raw.dueDay)
  raw.dueDay = dueDay
  if (raw.paymentStatus == null || raw.paymentStatus === '') {
    if (raw.pagoEstado != null && raw.pagoEstado !== '') raw.paymentStatus = raw.pagoEstado
    else if (typeof raw.paid === 'boolean') raw.paymentStatus = raw.paid ? 'paid' : 'unpaid'
  }
  normalizeRubro(raw)
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
  raw.layout =
    normalizeLayout(raw.layout) ??
    normalizeLayout(raw.width) ??
    inferredCategoryLayout(raw, index, total)
  if ('width' in raw) delete raw.width
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

export function cloneMonth(month) {
  if (!month || typeof month !== 'object' || Array.isArray(month)) return null
  return normalizeMonth(duplicateMonth(month))
}

export function copyMonthAdjacent(state, delta, fromKey) {
  if (!state || typeof state !== 'object') return null
  if (!isPlainObject(state.months)) state.months = {}
  const originKey = isMonthKey(fromKey) ? fromKey : state.currentMonth
  const source = state.months[originKey]
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const target = shiftMonth(originKey, delta)
  if (!isMonthKey(target) || target === originKey) return null
  const cloned = cloneMonth(source)
  if (!cloned) return null
  const sourceExpenses = Array.isArray(source.expenses) ? source.expenses.length : 0
  const clonedExpenses = Array.isArray(cloned.expenses) ? cloned.expenses.length : 0
  if (sourceExpenses > 0 && clonedExpenses === 0) return null
  state.months[target] = cloned
  state.currentMonth = target
  return target
}

export function applyCategoryLayout(month, id, layout) {
  if (!month || !Array.isArray(month.categories)) return null
  const category = month.categories.find((entry) => entry.id === id)
  const next = normalizeLayout(layout)
  if (!category || !next || category.layout === next) return null
  category.layout = next
  return category
}

export function reorderCategories(month, sourceId, targetId, place) {
  if (!month || !Array.isArray(month.categories)) return false
  const list = month.categories
  const from = list.findIndex((entry) => entry.id === sourceId)
  if (from < 0 || !targetId) return false
  const next = [...list]
  const [moved] = next.splice(from, 1)
  let insertAt = next.findIndex((entry) => entry.id === targetId)
  if (insertAt < 0) return false
  if (place === 'after') insertAt += 1
  next.splice(insertAt, 0, moved)
  const unchanged = next.every((entry, index) => entry.id === list[index].id)
  if (unchanged) return false
  month.categories = next
  return true
}

export function normalizeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return createInitialState()
  if (!state.months || typeof state.months !== 'object' || Array.isArray(state.months)) {
    state.months = {}
  }
  for (const key of Object.keys(state.months)) {
    state.months[key] = normalizeMonth(state.months[key])
  }
  state.version = CURRENT_VERSION
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(raw) {
  if (raw == null || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function storageKeyList() {
  const keys = new Set([STORAGE_KEY, ...LEGACY_STORAGE_KEYS])
  try {
    const ls = window.localStorage
    const len = Number(ls.length) || 0
    for (let i = 0; i < len; i += 1) {
      const key = ls.key?.(i)
      if (typeof key === 'string' && /gastos/i.test(key) && key !== '__gastos-probe__') {
        keys.add(key)
      }
    }
  } catch {
    // Some browsers expose getItem but not key enumeration.
  }
  return [...keys]
}

function readStoredPayloads() {
  const payloads = []
  const seen = new Set()
  for (const key of storageKeyList()) {
    let raw = null
    try {
      raw = window.localStorage.getItem(key)
    } catch {
      continue
    }
    if (!raw || seen.has(raw)) continue
    const parsed = parseJson(raw)
    if (!parsed) continue
    seen.add(raw)
    payloads.push({ key, parsed })
  }
  return payloads
}

export function coerceState(parsed) {
  if (!isPlainObject(parsed)) return null

  let months = parsed.months
  if (!isPlainObject(months)) {
    if (Array.isArray(parsed.expenses) || Array.isArray(parsed.incomes)) {
      months = { [SEEDED_MONTH]: parsed }
    } else {
      const monthKeys = Object.keys(parsed).filter(isMonthKey)
      if (!monthKeys.length || !monthKeys.some((key) => isPlainObject(parsed[key]))) {
        return null
      }
      months = {}
      for (const key of monthKeys) {
        if (isPlainObject(parsed[key])) months[key] = parsed[key]
      }
    }
  }

  const monthKeys = Object.keys(months).filter(isMonthKey)
  const currentMonth = isMonthKey(parsed.currentMonth)
    ? parsed.currentMonth
    : monthKeys.includes(SEEDED_MONTH)
      ? SEEDED_MONTH
      : (monthKeys[0] ?? SEEDED_MONTH)

  return {
    ...parsed,
    version: CURRENT_VERSION,
    currentMonth,
    months: { ...months },
  }
}

function chargeCount(month) {
  return (month?.expenses ?? []).reduce((sum, expense) => {
    const charges = readExpenseCharges(expense)
    return sum + charges.length
  }, 0)
}

function mergeExpense(primary, extra) {
  if (!primary) return extra
  if (!extra) return primary
  const primaryCharges = readExpenseCharges(primary)
  const extraCharges = readExpenseCharges(extra)
  const charges = extraCharges.length > primaryCharges.length ? extraCharges : primaryCharges
  return { ...extra, ...primary, charges }
}

function mergeMonth(primary, extra) {
  if (!primary) return extra
  if (!extra) return primary
  const byId = new Map()
  for (const expense of extra.expenses ?? []) {
    if (expense?.id) byId.set(expense.id, expense)
  }
  const expenses = []
  const seen = new Set()
  for (const expense of primary.expenses ?? []) {
    if (expense?.id) seen.add(expense.id)
    expenses.push(mergeExpense(expense, expense?.id ? byId.get(expense.id) : null))
  }
  for (const expense of extra.expenses ?? []) {
    if (expense?.id && seen.has(expense.id)) continue
    expenses.push(expense)
  }
  const useExtraShape = chargeCount(extra) > chargeCount(primary)
  const base = useExtraShape ? extra : primary
  const other = useExtraShape ? primary : extra
  return {
    ...other,
    ...base,
    expenses,
    incomes: (base.incomes?.length ? base.incomes : other.incomes) ?? [],
    categories: (base.categories?.length ? base.categories : other.categories) ?? [],
    exchangeRate: base.exchangeRate ?? other.exchangeRate,
  }
}

function mergeStates(primary, extra) {
  const months = {}
  const keys = new Set([...Object.keys(primary.months || {}), ...Object.keys(extra.months || {})])
  for (const key of keys) {
    months[key] = mergeMonth(primary.months?.[key], extra.months?.[key])
  }
  const current =
    primary.currentMonth && months[primary.currentMonth]
      ? primary.currentMonth
      : extra.currentMonth && months[extra.currentMonth]
        ? extra.currentMonth
        : null
  return {
    ...extra,
    ...primary,
    version: CURRENT_VERSION,
    months,
    currentMonth: current,
  }
}

function pickCurrentMonth(state) {
  const keys = Object.keys(state.months || {})
    .filter(isMonthKey)
    .sort()
  if (isMonthKey(state.currentMonth) && state.months?.[state.currentMonth]) return state.currentMonth
  if (keys.includes(SEEDED_MONTH)) return SEEDED_MONTH
  return keys[0] ?? SEEDED_MONTH
}

export function createInitialState() {
  return normalizeState({
    version: CURRENT_VERSION,
    currentMonth: SEEDED_MONTH,
    months: {
      [SEEDED_MONTH]: createOctoberSeed(),
    },
  })
}

export function emptyMonthFor(_monthKey) {
  return normalizeMonth(createEmptyMonth())
}

export function restoreOctoberMonth(state) {
  const next = isPlainObject(state) ? state : createInitialState()
  if (!isPlainObject(next.months)) next.months = {}
  next.months[SEEDED_MONTH] = createOctoberSeed()
  next.currentMonth = SEEDED_MONTH
  next.version = CURRENT_VERSION
  return normalizeState(next)
}

export function restoreOctoberPreservingOthers() {
  const kept = {}
  for (const { parsed } of readStoredPayloads()) {
    const coerced = coerceState(parsed)
    if (!coerced?.months) continue
    for (const [key, month] of Object.entries(coerced.months)) {
      if (key === SEEDED_MONTH) continue
      kept[key] = mergeMonth(kept[key], month)
    }
  }
  const state = createInitialState()
  state.months = { ...kept, [SEEDED_MONTH]: createOctoberSeed() }
  state.currentMonth = SEEDED_MONTH
  return normalizeState(state)
}

export function hasHouseholdData(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false
  const months = state.months
  if (!isPlainObject(months)) return false
  return Object.keys(months).some((key) => isMonthKey(key) && isPlainObject(months[key]))
}

export function monthHasExpenses(month) {
  return Array.isArray(month?.expenses) && month.expenses.length > 0
}

function finalizeState(state) {
  normalizeState(state)
  state.currentMonth = pickCurrentMonth(state)
  if (!state.months[state.currentMonth]) {
    state.months[state.currentMonth] = emptyMonthFor(state.currentMonth)
  }
  return state
}

export function readLocalState() {
  let currentRaw = null
  try {
    currentRaw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    currentRaw = null
  }

  const payloads = readStoredPayloads()
  const currentParsed = parseJson(currentRaw)

  if (!currentRaw && payloads.length === 0) {
    return { state: null, fromStorage: false }
  }

  const ordered = []
  if (currentParsed) ordered.push(currentParsed)
  for (const { key, parsed } of payloads) {
    if (key === STORAGE_KEY) continue
    ordered.push(parsed)
  }

  let merged = null
  for (const payload of ordered) {
    const coerced = coerceState(payload)
    if (!coerced) continue
    merged = merged ? mergeStates(merged, coerced) : coerced
  }

  if (!merged) {
    throw new Error('El archivo guardado no tiene un formato reconocido.')
  }

  return { state: finalizeState(merged), fromStorage: true }
}

export function loadState() {
  const local = readLocalState()
  if (!local.state) {
    const state = createInitialState()
    saveState(state)
    return { state, fromStorage: false }
  }
  saveState(local.state)
  return { state: local.state, fromStorage: true }
}

export const GASTOS_API_PATH = '/api/gastos'

function canTalkToServer() {
  return typeof window !== 'undefined' && typeof window.fetch === 'function'
}

let householdWritesEnabled = true

export function setHouseholdWritesEnabled(enabled) {
  householdWritesEnabled = Boolean(enabled)
}

async function fetchServerSnapshot() {
  if (!canTalkToServer()) return { status: 'unavailable', state: null }
  try {
    const res = await window.fetch(GASTOS_API_PATH, { cache: 'no-store', credentials: 'same-origin' })
    if (res.status === 401 || res.status === 403) return { status: 'unauthorized', state: null }
    if (!res.ok) return { status: 'error', state: null }
    const parsed = await res.json()
    const coerced = coerceState(parsed)
    if (!coerced || !hasHouseholdData(coerced)) return { status: 'empty', state: null }
    return { status: 'ok', state: finalizeState(coerced) }
  } catch {
    return { status: 'error', state: null }
  }
}

export async function fetchServerState() {
  const snap = await fetchServerSnapshot()
  return snap.status === 'ok' ? snap.state : null
}

let pendingServerPayload = null
let serverSaveTimer = 0

export function queueServerSave(state, options = {}) {
  if (!householdWritesEnabled || !state || !canTalkToServer()) return Promise.resolve()
  normalizeState(state)
  const currentMonth = pickCurrentMonth(state)
  state.currentMonth = currentMonth
  pendingServerPayload = JSON.stringify({
    ...state,
    currentMonth,
    saveScope: options.allMonths ? 'all' : 'current',
  })
  if (typeof window.setTimeout !== 'function') {
    return flushServerSave()
  }
  window.clearTimeout(serverSaveTimer)
  serverSaveTimer = window.setTimeout(() => {
    flushServerSave().catch((error) => console.error(error))
  }, 250)
  return Promise.resolve()
}

export async function flushServerSave() {
  if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
    window.clearTimeout(serverSaveTimer)
  }
  if (!pendingServerPayload || !canTalkToServer() || !householdWritesEnabled) return
  const payload = pendingServerPayload
  pendingServerPayload = null
  const res = await window.fetch(GASTOS_API_PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    pendingServerPayload = payload
    throw new Error('No se pudo guardar el presupuesto en el servidor.')
  }
}

async function finishLoadedState(state, flags) {
  finalizeState(state)
  try {
    saveState(state)
  } catch {
    // localStorage may be blocked; sqlite remains the source of truth after login.
  }
  if (flags.upload) {
    try {
      await queueServerSave(state, flags.allMonths ? { allMonths: true } : {})
      await flushServerSave()
    } catch (error) {
      console.error(error)
    }
  }
  return {
    state,
    fromStorage: Boolean(flags.fromStorage),
    fromServer: Boolean(flags.fromServer),
    uploadBlocked: Boolean(flags.uploadBlocked),
  }
}

export async function loadHousehold() {
  const snap = await fetchServerSnapshot()
  let local = null
  try {
    local = readLocalState().state
  } catch (error) {
    if (snap.status !== 'ok') throw error
  }

  if (snap.status === 'ok' && snap.state) {
    // After login, sqlite is the source of truth. Do not merge stale/empty
    // localStorage on top, and do not PUT the browser copy back — that path
    // used to reseed October or wipe month_key 2026-10.
    return finishLoadedState(snap.state, { fromServer: true, fromStorage: false, upload: false })
  }

  const serverEmpty = snap.status === 'empty'
  if (local && hasHouseholdData(local)) {
    return finishLoadedState(local, {
      fromStorage: true,
      fromServer: false,
      upload: serverEmpty,
      allMonths: true,
      uploadBlocked: !serverEmpty,
    })
  }

  if (!serverEmpty) {
    const state = createInitialState()
    finalizeState(state)
    return {
      state,
      fromStorage: false,
      fromServer: false,
      uploadBlocked: true,
    }
  }

  const state = createInitialState()
  return finishLoadedState(state, {
    fromStorage: false,
    fromServer: false,
    upload: true,
    allMonths: true,
  })
}

export function importStateFromText(raw) {
  const parsed = parseJson(raw)
  const coerced = coerceState(parsed)
  if (!coerced || !hasHouseholdData(coerced)) {
    throw new Error('El archivo no tiene un presupuesto reconocido.')
  }
  return finalizeState(coerced)
}

export function saveState(state) {
  normalizeState(state)
  state.version = CURRENT_VERSION
  state.currentMonth = pickCurrentMonth(state)
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
