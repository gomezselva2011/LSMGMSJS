const ES_MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

export function parseIsoDate(iso) {
  if (!iso) return null
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export function startOfLocalDay(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return null
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function clampPaymentDay(year, monthIndex0, paymentDay) {
  const day = Number(paymentDay)
  if (!Number.isInteger(day) || day < 1 || day > 31) return 1
  const last = new Date(year, monthIndex0 + 1, 0).getDate()
  return Math.min(day, last)
}

/** @returns {{ year: number, monthIndex0: number }} */
export function addCalendarMonths(year, monthIndex0, delta) {
  const total = year * 12 + monthIndex0 + delta
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 }
}

export function scheduleAnchorDate({ cutDate, lastMovementDate, today = new Date() } = {}) {
  const candidates = []
  const cut = parseIsoDate(cutDate)
  if (cut) candidates.push(startOfLocalDay(cut))
  const last = parseIsoDate(lastMovementDate)
  if (last) {
    candidates.push(startOfLocalDay(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)))
  }
  const now = startOfLocalDay(today)
  if (now) candidates.push(now)
  if (!candidates.length) return null
  return new Date(Math.max(...candidates.map((d) => d.getTime())))
}

export function firstPendingPaymentDate(anchor, paymentDay) {
  const base = startOfLocalDay(anchor)
  if (!base) return null
  const day = Number(paymentDay)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  let year = base.getFullYear()
  let monthIndex0 = base.getMonth()
  let paymentOn = new Date(year, monthIndex0, clampPaymentDay(year, monthIndex0, day))
  if (paymentOn.getTime() < base.getTime()) {
    const next = addCalendarMonths(year, monthIndex0, 1)
    year = next.year
    monthIndex0 = next.monthIndex0
    paymentOn = new Date(year, monthIndex0, clampPaymentDay(year, monthIndex0, day))
  }
  return paymentOn
}

/**
 * @param {{ paymentDay?: number, pendingInstallments?: number, cutDate?: string, lastMovementDate?: string, today?: Date }} input
 */
export function computePendingInstallmentSchedule(input = {}) {
  const pending = Number(input.pendingInstallments) || 0
  const paymentDay = Number(input.paymentDay)
  if (!pending || !Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    return null
  }

  const anchor = scheduleAnchorDate({
    cutDate: input.cutDate,
    lastMovementDate: input.lastMovementDate,
    today: input.today,
  })
  if (!anchor) return null

  const first = firstPendingPaymentDate(anchor, paymentDay)
  if (!first) return null

  const dates = []
  let year = first.getFullYear()
  let monthIndex0 = first.getMonth()
  for (let i = 0; i < pending; i += 1) {
    dates.push(new Date(year, monthIndex0, clampPaymentDay(year, monthIndex0, paymentDay)))
    const next = addCalendarMonths(year, monthIndex0, 1)
    year = next.year
    monthIndex0 = next.monthIndex0
  }

  return {
    anchor,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    dates,
  }
}

export function formatMonthYearShort(date) {
  if (!date || Number.isNaN(date.getTime())) return '—'
  return `${ES_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

export function formatShortDateEs(date) {
  if (!date || Number.isNaN(date.getTime())) return '—'
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}/${m}/${date.getFullYear()}`
}

export function formatProjectionRange(firstDate, lastDate) {
  if (!firstDate || !lastDate) return '—'
  const first = formatMonthYearShort(firstDate)
  const last = formatMonthYearShort(lastDate)
  if (first === last) return first
  return `${first} – ${last}`
}

export function lastMovementAppliedDate(movements) {
  if (!Array.isArray(movements) || !movements.length) return null
  let best = null
  for (const mov of movements) {
    const iso = mov?.appliedDate
    if (!iso) continue
    if (!best || iso > best) best = iso
  }
  return best
}

export function bolsaProjectionFacts(bolsa, { today = new Date() } = {}) {
  if (!bolsa) return null
  const schedule = computePendingInstallmentSchedule({
    paymentDay: bolsa.paymentDay,
    pendingInstallments: bolsa.pendingInstallments,
    cutDate: bolsa.cutDate,
    lastMovementDate: lastMovementAppliedDate(bolsa.movements),
    today,
  })

  const pending = Number(bolsa.pendingInstallments) || 0
  const installment = Number(bolsa.installmentCents) || 0
  const flowTotalCents = pending && installment ? pending * installment : null

  return {
    schedule,
    calendarRange: schedule ? formatProjectionRange(schedule.firstDate, schedule.lastDate) : '—',
    debtFreeDate: schedule?.lastDate ?? null,
    debtFreeLabel: schedule ? formatShortDateEs(schedule.lastDate) : '—',
    flowTotalCents,
  }
}
