const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export function parseMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return { year, month }
}

export function shiftMonth(monthKey, delta) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1 + delta, 1)
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${nextMonth}`
}

export function formatMonthTitle(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  const name = MONTH_NAMES[month - 1]
  return `${name} ${year}`
}

export function formatMonthLabel(monthKey) {
  const title = formatMonthTitle(monthKey)
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function formatMoney(cents) {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents) / 100
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${sign}$${formatted}`
}

export function formatDueDay(dueDay, monthKey) {
  if (!dueDay) return 'Sin fecha'
  const { month } = parseMonthKey(monthKey)
  return `${dueDay} de ${MONTH_NAMES[month - 1]}`
}

export function dollarsToCents(value) {
  const normalized = String(value).trim().replace(/,/g, '')
  if (!normalized || Number.isNaN(Number(normalized))) return null
  return Math.round(Number(normalized) * 100)
}

export function centsToInput(cents) {
  return (cents / 100).toFixed(2)
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

export function newId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
