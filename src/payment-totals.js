import { isValidRate, toUsdCents } from './money.js'

export const PAYMENT_PAID = 'paid'
export const PAYMENT_PARTIAL = 'partial'
export const PAYMENT_UNPAID = 'unpaid'
export const PAYMENT_LATE = 'late'

const PAID_ALIASES = new Set(['paid', 'pagado', 'pagada'])
const PARTIAL_ALIASES = new Set(['partial', 'parcial', 'abono'])
const LATE_ALIASES = new Set(['late', 'atrasado', 'atrasada', 'overdue', 'vencido', 'vencida'])
const UNPAID_ALIASES = new Set([
  'unpaid',
  'no_pagado',
  'nopagado',
  'no-pagado',
  'pendiente',
  'due',
])

function firstDefined(...values) {
  for (const value of values) {
    if (value != null && value !== '') return value
  }
  return undefined
}

export function normalizePaymentStatus(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (PAID_ALIASES.has(raw)) return PAYMENT_PAID
  if (PARTIAL_ALIASES.has(raw)) return PAYMENT_PARTIAL
  if (LATE_ALIASES.has(raw)) return PAYMENT_LATE
  if (UNPAID_ALIASES.has(raw)) return PAYMENT_UNPAID
  return PAYMENT_UNPAID
}

export function readPaymentStatus(item) {
  return normalizePaymentStatus(
    firstDefined(item?.paymentStatus, item?.payment_status, item?.estadoPago, item?.pagoEstado, item?.status),
  )
}

function readPaidAmountCents(item) {
  const raw = firstDefined(item?.paidAmount, item?.paid_amount, item?.montoPagado, item?.pagado)
  if (raw == null || raw === '') return null
  const amount = Math.round(Number(raw))
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

function readPaidCurrency(item) {
  return firstDefined(item?.paidCurrency, item?.paid_currency, item?.currency)
}

/**
 * Split one parent partida into pagado / no pagado USD cents.
 * Subgastos are ignored; only the line amount counts.
 *
 * pagado: status paid (full parent), or the paidAmount slice of a partial.
 * no pagado: unpaid, late, and partial (full parent until paid, or the remainder
 * when paidAmount exists). Missing status counts as unpaid.
 */
export function splitParentPaidUnpaid(item, rate) {
  const parentUsd = toUsdCents(item?.amount, item?.currency, rate)
  if (parentUsd == null) return { ok: false, paidUsd: null, unpaidUsd: null }

  const status = readPaymentStatus(item)
  if (status === PAYMENT_PAID) {
    return { ok: true, paidUsd: parentUsd, unpaidUsd: 0 }
  }

  if (status === PAYMENT_PARTIAL) {
    const paidAmount = readPaidAmountCents(item)
    if (paidAmount == null) {
      return { ok: true, paidUsd: 0, unpaidUsd: parentUsd }
    }
    const paidUsdRaw = toUsdCents(paidAmount, readPaidCurrency(item), rate)
    if (paidUsdRaw == null) return { ok: false, paidUsd: null, unpaidUsd: null }
    const paidUsd = Math.min(parentUsd, Math.max(0, paidUsdRaw))
    return { ok: true, paidUsd, unpaidUsd: parentUsd - paidUsd }
  }

  return { ok: true, paidUsd: 0, unpaidUsd: parentUsd }
}

export function monthPaidUnpaidTotals(month) {
  const rate = month?.exchangeRate
  if (!isValidRate(rate)) {
    return {
      ok: false,
      rate,
      paidUsd: null,
      unpaidUsd: null,
      paidNio: null,
      unpaidNio: null,
    }
  }

  let paidUsd = 0
  let unpaidUsd = 0
  for (const item of month?.expenses ?? []) {
    const split = splitParentPaidUnpaid(item, rate)
    if (!split.ok) {
      return {
        ok: false,
        rate,
        paidUsd: null,
        unpaidUsd: null,
        paidNio: null,
        unpaidNio: null,
      }
    }
    paidUsd += split.paidUsd
    unpaidUsd += split.unpaidUsd
  }

  const nioRate = Number(rate)
  return {
    ok: true,
    rate: nioRate,
    paidUsd,
    unpaidUsd,
    paidNio: Math.round(paidUsd * nioRate),
    unpaidNio: Math.round(unpaidUsd * nioRate),
  }
}
