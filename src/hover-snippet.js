import { escapeHtml, formatDueDay, formatMoney } from './format.js'
import { isValidRate, normalizeCurrency, toNioCents, toUsdCents } from './money.js'
import { paymentStatusLabel } from './payment-status.js'
import { normalizeDetails } from './storage.js'

export const SNIPPET_HOVER_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 900px)'

const NOTE_LIMIT = 140

export function canShowExpenseSnippet(matchMedia = globalThis.matchMedia) {
  if (typeof matchMedia !== 'function') return false
  try {
    return Boolean(matchMedia(SNIPPET_HOVER_QUERY)?.matches)
  } catch {
    return false
  }
}

export function isMousePointer(event) {
  const type = event?.pointerType
  if (!type) return true
  return type === 'mouse'
}

function joinMoney(parts) {
  return parts.filter(Boolean).join(' · ')
}

function formatUsdNio(usdCents, nioCents) {
  const parts = []
  if (usdCents != null) parts.push(formatMoney(usdCents, 'USD'))
  if (nioCents != null) parts.push(formatMoney(nioCents, 'NIO'))
  return joinMoney(parts)
}

function formatLineMonto(item, rate) {
  const currency = normalizeCurrency(item?.currency)
  const amount = Math.round(Number(item?.amount) || 0)
  const primary = formatMoney(amount, currency)
  if (!isValidRate(rate)) return primary
  if (currency === 'USD') {
    const nio = toNioCents(amount, 'USD', rate)
    return nio == null ? primary : joinMoney([primary, formatMoney(nio, 'NIO')])
  }
  const usd = toUsdCents(amount, 'NIO', rate)
  return usd == null ? primary : joinMoney([primary, formatMoney(usd, 'USD')])
}

function expectedVsActual(item, details, rate) {
  const expected = formatUsdNio(details.expectedUsd, details.expectedNio)
  if (!expected) return null
  const lineUsd = toUsdCents(item?.amount, item?.currency, rate)
  const expectedUsd =
    details.expectedUsd != null
      ? details.expectedUsd
      : details.expectedNio != null
        ? toUsdCents(details.expectedNio, 'NIO', rate)
        : null
  if (lineUsd != null && expectedUsd != null && lineUsd !== expectedUsd) {
    return `${expected} · en la línea ${formatMoney(item.amount, item.currency)}`
  }
  return expected
}

function clipNotes(notes) {
  const text = String(notes || '').trim()
  if (!text) return ''
  if (text.length <= NOTE_LIMIT) return text
  return `${text.slice(0, NOTE_LIMIT - 1).trimEnd()}…`
}

function chargeCount(item) {
  return Array.isArray(item?.charges) ? item.charges.length : 0
}

export function expenseSnippetRows(item, { monthKey, rate } = {}) {
  if (!item || typeof item !== 'object') return []
  const details = normalizeDetails(item.details)
  const rows = []
  rows.push({ key: 'monto', label: 'Monto', value: formatLineMonto(item, rate) })
  rows.push({
    key: 'fecha',
    label: 'Fecha de pago',
    value: formatDueDay(item.dueDay, monthKey),
  })
  const paidLabel = paymentStatusLabel(item)
  rows.push({
    key: 'estado',
    label: 'Estado',
    value: paidLabel,
    tone: paidLabel === 'Pagado' ? 'paid' : 'unpaid',
  })
  if (details.accountNumber) {
    rows.push({ key: 'cuenta', label: 'Cuenta', value: details.accountNumber })
  }
  const monthly = formatUsdNio(details.monthlyUsd, details.monthlyNio)
  if (monthly) rows.push({ key: 'mensualidad', label: 'Mensualidad', value: monthly })
  const esperado = expectedVsActual(item, details, rate)
  if (esperado) rows.push({ key: 'esperado', label: 'Esperado', value: esperado })
  const notes = clipNotes(details.notes)
  if (notes) rows.push({ key: 'notas', label: 'Notas', value: notes, wide: true })
  const subs = chargeCount(item)
  if (subs > 0) {
    rows.push({
      key: 'subgastos',
      label: 'Subgastos',
      value: subs === 1 ? '1 cargo' : `${subs} cargos`,
    })
  }
  return rows
}

export function expenseSnippetHtml(item, options = {}) {
  const rows = expenseSnippetRows(item, options)
  if (rows.length === 0) return ''
  const name = String(item?.name || '').trim() || 'Gasto'
  const body = rows
    .map((row) => {
      const tone = row.tone === 'paid' ? ' is-paid' : row.tone === 'unpaid' ? ' is-unpaid' : ''
      const wide = row.wide ? ' snippet-notes' : ''
      return `<dt>${escapeHtml(row.label)}</dt><dd class="${`${tone}${wide}`.trim()}">${escapeHtml(row.value)}</dd>`
    })
    .join('')
  return `
    <p class="expense-snippet-kicker">Vista rápida</p>
    <h3>${escapeHtml(name)}</h3>
    <dl>${body}</dl>
  `
}

function clampPosition(el, clientX, clientY, row) {
  const gap = 12
  const pad = 8
  const width = el.offsetWidth || 280
  const height = el.offsetHeight || 160
  const rowRect = row?.getBoundingClientRect?.()
  let left = clientX + gap
  let top = rowRect ? rowRect.bottom + 8 : clientY + gap
  const maxLeft = window.innerWidth - width - pad
  const maxTop = window.innerHeight - height - pad
  if (left > maxLeft) left = Math.max(pad, clientX - width - gap)
  if (top > maxTop) {
    top = rowRect ? rowRect.top - height - 8 : clientY - height - gap
  }
  left = Math.min(Math.max(pad, left), Math.max(pad, maxLeft))
  top = Math.min(Math.max(pad, top), Math.max(pad, maxTop))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

export function bindExpenseHoverSnippet({
  root,
  snippetEl,
  getExpense,
  getMonthKey,
  getRate,
  isActive = () => true,
} = {}) {
  if (!root || !snippetEl) {
    return { hide() {}, destroy() {} }
  }

  let activeRow = null
  let media = null

  function hide() {
    activeRow = null
    snippetEl.hidden = true
    snippetEl.innerHTML = ''
    snippetEl.setAttribute('aria-hidden', 'true')
  }

  function allowed(event) {
    if (!isActive()) return false
    if (document.querySelector('dialog[open]')) return false
    if (!canShowExpenseSnippet()) return false
    if (event && !isMousePointer(event)) return false
    return true
  }

  function rowFrom(node) {
    const row = node?.closest?.('[data-expense-id].ledger-row')
    if (!row || !root.contains(row)) return null
    return row
  }

  function showFor(row, event) {
    if (!allowed(event)) {
      hide()
      return
    }
    if (activeRow === row && !snippetEl.hidden) {
      clampPosition(snippetEl, event.clientX, event.clientY, row)
      return
    }
    const expense = getExpense?.(row.dataset.expenseId)
    if (!expense) {
      hide()
      return
    }
    const html = expenseSnippetHtml(expense, {
      monthKey: getMonthKey?.(),
      rate: getRate?.(),
    })
    if (!html) {
      hide()
      return
    }
    activeRow = row
    snippetEl.innerHTML = html
    snippetEl.hidden = false
    snippetEl.setAttribute('aria-hidden', 'false')
    clampPosition(snippetEl, event.clientX, event.clientY, row)
  }

  function onPointerOver(event) {
    const row = rowFrom(event.target)
    if (!row) return
    showFor(row, event)
  }

  function onPointerOut(event) {
    const row = rowFrom(event.target)
    if (!row || row !== activeRow) return
    const next = event.relatedTarget
    if (next && row.contains(next)) return
    hide()
  }

  function onPointerMove(event) {
    if (!activeRow || snippetEl.hidden) return
    if (!allowed(event)) {
      hide()
      return
    }
    const row = rowFrom(event.target)
    if (row !== activeRow) return
    clampPosition(snippetEl, event.clientX, event.clientY, row)
  }

  function onMediaChange() {
    if (!canShowExpenseSnippet()) hide()
  }

  hide()
  root.addEventListener('pointerover', onPointerOver)
  root.addEventListener('pointerout', onPointerOut)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('dragstart', hide)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
  try {
    media = globalThis.matchMedia?.(SNIPPET_HOVER_QUERY) ?? null
    media?.addEventListener?.('change', onMediaChange)
  } catch {
    media = null
  }

  return {
    hide,
    destroy() {
      hide()
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerout', onPointerOut)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('dragstart', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      media?.removeEventListener?.('change', onMediaChange)
    },
  }
}
