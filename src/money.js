export const CURRENCY_USD = 'USD'
export const CURRENCY_NIO = 'NIO'
export const DEFAULT_EXCHANGE_RATE = 36.6

export function normalizeCurrency(value) {
  return value === CURRENCY_NIO ? CURRENCY_NIO : CURRENCY_USD
}

export function isValidRate(rate) {
  if (typeof rate === 'number') return Number.isFinite(rate) && rate > 0
  return parseRate(rate) != null
}

export function parseRate(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.')
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function formatRate(rate) {
  if (!isValidRate(rate)) return ''
  const n = Number(rate)
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function toUsdCents(amountCents, currency, rate) {
  const amount = Math.round(Number(amountCents) || 0)
  if (normalizeCurrency(currency) === CURRENCY_USD) return amount
  if (!isValidRate(rate)) return null
  return Math.round(amount / Number(rate))
}

export function toNioCents(amountCents, currency, rate) {
  const amount = Math.round(Number(amountCents) || 0)
  if (normalizeCurrency(currency) === CURRENCY_NIO) return amount
  if (!isValidRate(rate)) return null
  return Math.round(amount * Number(rate))
}

export function convertCents(amountCents, fromCurrency, toCurrency, rate) {
  const from = normalizeCurrency(fromCurrency)
  const to = normalizeCurrency(toCurrency)
  const amount = Math.round(Number(amountCents) || 0)
  if (from === to) return amount
  if (!isValidRate(rate)) return null
  if (from === CURRENCY_NIO && to === CURRENCY_USD) {
    return Math.round(amount / Number(rate))
  }
  return Math.round(amount * Number(rate))
}

function sumToCurrency(items, rate, target) {
  let total = 0
  for (const item of items ?? []) {
    const converted = convertCents(item.amount, item.currency, target, rate)
    if (converted == null) return null
    total += converted
  }
  return total
}

export function monthTotals(month) {
  const rate = month?.exchangeRate
  if (!isValidRate(rate)) {
    return {
      ok: false,
      rate,
      incomeUsd: null,
      expensesUsd: null,
      netUsd: null,
      incomeNio: null,
      expensesNio: null,
      netNio: null,
    }
  }

  const incomeUsd = sumToCurrency(month?.incomes, rate, CURRENCY_USD)
  const expensesUsd = sumToCurrency(month?.expenses, rate, CURRENCY_USD)
  if (incomeUsd == null || expensesUsd == null) {
    return {
      ok: false,
      rate,
      incomeUsd: null,
      expensesUsd: null,
      netUsd: null,
      incomeNio: null,
      expensesNio: null,
      netNio: null,
    }
  }

  const netUsd = incomeUsd - expensesUsd
  const nioRate = Number(rate)
  return {
    ok: true,
    rate: nioRate,
    incomeUsd,
    expensesUsd,
    netUsd,
    incomeNio: Math.round(incomeUsd * nioRate),
    expensesNio: Math.round(expensesUsd * nioRate),
    netNio: Math.round(netUsd * nioRate),
  }
}

export function categoryTotalUsd(month, categoryId) {
  const items = (month?.expenses ?? []).filter((item) => item.categoryId === categoryId)
  return sumToCurrency(items, month?.exchangeRate, CURRENCY_USD)
}
