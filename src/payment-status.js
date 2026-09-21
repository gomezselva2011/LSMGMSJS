import { formatDueDay, parseMonthKey } from './format.js'
import {
  PAYMENT_LATE,
  PAYMENT_PAID,
  PAYMENT_PARTIAL,
  PAYMENT_UNPAID,
  readPaymentStatus,
} from './payment-totals.js'

export const STATUS_PAID = PAYMENT_PAID
export const STATUS_PARTIAL = PAYMENT_PARTIAL
export const STATUS_UNPAID = PAYMENT_UNPAID
export const STATUS_LATE = PAYMENT_LATE

export function normalizePaymentStatus(item) {
  if (item != null && typeof item === 'object') return readPaymentStatus(item)
  return readPaymentStatus({ paymentStatus: item })
}

export function isOutstanding(item) {
  const status = normalizePaymentStatus(item)
  return status === PAYMENT_UNPAID || status === PAYMENT_PARTIAL || status === PAYMENT_LATE
}

export function startOfLocalDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return new Date(NaN)
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function dueDateFromMonth(dueDay, monthKey) {
  const day = Number(dueDay)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const parsed = parseMonthKey(monthKey)
  if (!parsed?.year || !parsed?.month) return null
  const lastDay = new Date(parsed.year, parsed.month, 0).getDate()
  if (!lastDay) return null
  return new Date(parsed.year, parsed.month - 1, Math.min(day, lastDay))
}

export function isDueBeforeToday(dueDay, monthKey, today = new Date()) {
  const due = dueDateFromMonth(dueDay, monthKey)
  if (!due) return false
  const now = startOfLocalDay(today)
  if (Number.isNaN(now.getTime())) return false
  return due.getTime() < now.getTime()
}

/** Unpaid lines whose due date is today or already passed count as overdue. */
export function isDueTodayOrPast(dueDay, monthKey, today = new Date()) {
  const due = dueDateFromMonth(dueDay, monthKey)
  if (!due) return false
  const now = startOfLocalDay(today)
  if (Number.isNaN(now.getTime())) return false
  return due.getTime() <= now.getTime()
}

export function isPaidLine(item) {
  return normalizePaymentStatus(item) === PAYMENT_PAID
}

export function setLinePaid(item, paid) {
  if (!item || typeof item !== 'object') return item
  const next = Boolean(paid)
  item.paymentStatus = next ? PAYMENT_PAID : PAYMENT_UNPAID
  item.paid = next
  if (typeof item.pagado === 'boolean') item.pagado = next
  return item
}

function ownDueDay(item) {
  const day = Number(item?.dueDay)
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}

function categoryName(month, categoryId) {
  const category = month?.categories?.find((entry) => entry.id === categoryId)
  return category?.name || 'Sin categoría'
}

function overdueLine({ item, expense, month, monthKey, kind, parentName, today }) {
  const dueDay = ownDueDay(item)
  if (!dueDay || isPaidLine(item) || !isOutstanding(item) || !isDueTodayOrPast(dueDay, monthKey, today)) {
    return null
  }
  const status = normalizePaymentStatus(item)
  return {
    id: kind === 'charge' ? `${expense.id}:${item.id}` : expense.id,
    expenseId: expense.id,
    chargeId: kind === 'charge' ? item.id : null,
    kind,
    name: item.name || (kind === 'charge' ? 'Subgasto' : 'Gasto'),
    parentName: parentName || '',
    amount: Number(item.amount) || 0,
    currency: item.currency || expense.currency || 'USD',
    categoryId: expense.categoryId,
    categoryName: categoryName(month, expense.categoryId),
    dueDay,
    dueLabel: formatDueDay(dueDay, monthKey),
    paymentStatus: status,
  }
}

export function listOverduePayments(month, monthKey, today = new Date()) {
  if (!month || !Array.isArray(month.expenses)) return []
  const lines = []
  for (const expense of month.expenses) {
    if (!expense || typeof expense !== 'object') continue
    const parent = overdueLine({
      item: expense,
      expense,
      month,
      monthKey,
      kind: 'expense',
      today,
    })
    if (parent) lines.push(parent)
    const charges = Array.isArray(expense.charges) ? expense.charges : []
    for (const charge of charges) {
      const child = overdueLine({
        item: charge,
        expense,
        month,
        monthKey,
        kind: 'charge',
        parentName: expense.name,
        today,
      })
      if (child) lines.push(child)
    }
  }
  return lines.sort(
    (a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id),
  )
}

export function paymentStatusLabel(status) {
  const normalized = normalizePaymentStatus(status)
  if (normalized === PAYMENT_PAID) return 'Pagado'
  if (normalized === PAYMENT_PARTIAL) return 'Pago parcial'
  if (normalized === PAYMENT_LATE) return 'Atrasado'
  return 'Sin pagar'
}

export function formatOverdueLede(count, monthTitle) {
  const n = Number(count) || 0
  const noun = n === 1 ? 'gasto' : 'gastos'
  const verb =
    n === 1
      ? 'ya venció o vence hoy y sigue sin pagar o solo se pagó en parte'
      : 'ya vencieron o vencen hoy y siguen sin pagar o solo se pagaron en parte'
  return `${n} ${noun} de ${monthTitle} ${verb}.`
}
