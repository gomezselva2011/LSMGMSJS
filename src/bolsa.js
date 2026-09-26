import { escapeHtml, formatMoney, formatMonthLabel } from './format.js'
import { isPaidLine, paymentStatusLabel } from './payment-status.js'
import { bolsaProjectionFacts } from '../server/bolsa-projection.js'

export const TIGGO_BOLSA_ID = 'bolsa-tiggo-4-crediq'

function formatPct(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '—'
  return `${Number(rate).toFixed(2).replace(/\.?0+$/, '')}%`
}

function formatAppliedDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function movementTypeLabel(type) {
  if (type === 'extra_capital') return 'Extra capital'
  return 'Cuota'
}

function chargesForExpense(expense) {
  if (!expense || typeof expense !== 'object') return []
  const lists = [expense.charges, expense.subgastos, expense.cargos]
  let charges = Array.isArray(expense.charges) ? expense.charges : []
  for (const list of lists) {
    if (Array.isArray(list) && list.length > charges.length) charges = list
  }
  return charges
}

/** @returns {{ key: string, sourceMonthKey: string, expenseId: string, chargeId: string|null, label: string, amount: number, currency: string, paid: boolean }[]} */
export function listBolsaBudgetPaymentLines(state, budgetExpenseId) {
  if (!state?.months || !budgetExpenseId) return []
  const keys = Object.keys(state.months).filter((key) => /^\d{4}-\d{2}$/.test(key)).sort()
  const lines = []
  for (const monthKey of keys) {
    const month = state.months[monthKey]
    const expense = month?.expenses?.find((entry) => entry?.id === budgetExpenseId)
    if (!expense) continue
    const currency = expense.currency || 'USD'
    const pushLine = (item, chargeId) => {
      const amount = Number(item?.amount) || 0
      const name = item?.name || expense.name || 'Cuota'
      const paid = isPaidLine(item)
      const status = paymentStatusLabel(item)
      const chargeSuffix = chargeId ? ` · subcargo` : ''
      lines.push({
        key: `${monthKey}|${expense.id}|${chargeId || ''}`,
        sourceMonthKey: monthKey,
        expenseId: expense.id,
        chargeId,
        label: `${formatMonthLabel(monthKey)} · ${name}${chargeSuffix} · ${formatMoney(amount, currency)} · ${status}`,
        amount,
        currency,
        paid,
      })
    }
    const charges = chargesForExpense(expense)
    if (charges.length) {
      for (const charge of charges) {
        if (!charge?.id) continue
        pushLine(charge, charge.id)
      }
    } else {
      pushLine(expense, null)
    }
  }
  return lines
}

function projectionListHtml(bolsa) {
  const facts = bolsaProjectionFacts(bolsa)
  const pending = Number(bolsa.pendingInstallments) || 0
  const installment = Number(bolsa.installmentCents) || 0
  const items = []

  if (pending && facts?.calendarRange && facts.calendarRange !== '—') {
    items.push(`<li><strong>Calendario de cuotas:</strong> ${escapeHtml(facts.calendarRange)} (${pending} cuotas pendientes, día ${bolsa.paymentDay ?? '—'})</li>`)
  } else if (pending) {
    items.push(`<li><strong>Cuotas pendientes:</strong> ${pending}</li>`)
  }

  if (facts?.debtFreeLabel && facts.debtFreeLabel !== '—') {
    items.push(
      `<li><strong>Salida de deuda ~</strong> ${escapeHtml(facts.debtFreeLabel)} <span class="bolsa-projection-note">(última cuota programada; abonos extra de capital la adelantan)</span></li>`,
    )
  }

  if (pending && installment && facts?.flowTotalCents != null) {
    items.push(
      `<li><strong>Flujo total estimado:</strong> ${pending} × ${formatMoney(installment, 'USD')} ≈ ${formatMoney(facts.flowTotalCents, 'USD')} <span class="bolsa-projection-note">(interés y seguros incluidos; no es solo capital)</span></li>`,
    )
  }

  items.push(
    `<li><strong>Capital pendiente:</strong> ${formatMoney(bolsa.capitalBalanceCents, 'USD')} al corte${bolsa.cutDate ? ` (${formatAppliedDate(bolsa.cutDate)})` : ''}.</li>`,
  )

  if (!items.length) {
    return '<p class="bolsa-projection-note">Sin proyección: faltan cuotas o datos de calendario.</p>'
  }

  return `<ul class="bolsa-projection-list">${items.join('')}</ul>`
}

export function bolsaApplyPaymentHtml(bolsa, state, { canEdit = false } = {}) {
  if (!canEdit || !bolsa?.budgetExpenseId) return ''
  const lines = listBolsaBudgetPaymentLines(state, bolsa.budgetExpenseId)
  const monthKeys = state?.months
    ? Object.keys(state.months)
        .filter((key) => /^\d{4}-\d{2}$/.test(key))
        .sort()
    : []
  if (!lines.length || !monthKeys.length) {
    return `<section class="bolsa-apply" aria-labelledby="bolsa-apply-title">
      <h3 class="bolsa-table-title" id="bolsa-apply-title">Aplicar pago manual</h3>
      <p class="bolsa-empty">No hay líneas del presupuesto enlazadas (<code>${escapeHtml(bolsa.budgetExpenseId)}</code>) en los meses cargados.</p>
    </section>`
  }

  const lineOptions = lines
    .map(
      (line) =>
        `<option value="${escapeHtml(line.key)}">${escapeHtml(line.label)}</option>`,
    )
    .join('')
  const monthOptions = monthKeys
    .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(formatMonthLabel(key))}</option>`)
    .join('')

  return `
    <section class="bolsa-apply" aria-labelledby="bolsa-apply-title">
      <h3 class="bolsa-table-title" id="bolsa-apply-title">Aplicar pago manual</h3>
      <p class="bolsa-projection-note">Elige la línea del presupuesto y el mes donde debe quedar marcada como pagada. Se registra un movimiento en la bolsa; el capital del movimiento es aproximado (refinable después).</p>
      <form class="bolsa-apply-form" data-action="bolsa-apply-payment">
        <label class="field">
          <span>Línea de pago (mes del presupuesto)</span>
          <select name="paymentLine" required>${lineOptions}</select>
        </label>
        <label class="field">
          <span>Marcar pagado en mes</span>
          <select name="applyToMonth" required>${monthOptions}</select>
        </label>
        <label class="field">
          <span>Fecha aplicada (opcional)</span>
          <input type="date" name="appliedDate" />
        </label>
        <button type="submit" class="btn btn-secondary">Aplicar pago a la bolsa</button>
      </form>
    </section>
  `
}

export function bolsaSummaryHtml(bolsa) {
  if (!bolsa) {
    return '<p class="bolsa-empty">No hay bolsas de deuda todavía.</p>'
  }

  const meta = [
    bolsa.creditor,
    bolsa.product,
    bolsa.vehicle,
    bolsa.plate ? `Placa ${bolsa.plate}` : null,
    bolsa.accountNumber ? `Cuenta ${bolsa.accountNumber}` : null,
  ]
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join(' · ')

  return `
    <div class="bolsa-hero">
      <p class="eyebrow">Bolsa de deuda</p>
      <h2>${escapeHtml(bolsa.name)}</h2>
      ${meta ? `<p class="bolsa-meta">${meta}</p>` : ''}
    </div>
    <div class="insight-grid bolsa-metrics">
      <article class="insight-card tone-ok">
        <p class="eyebrow">Capital pendiente</p>
        <p class="bolsa-metric-value">${formatMoney(bolsa.capitalBalanceCents, 'USD')}</p>
        <p>Meta: llevar a $0 (saldo cancelación CrediQ${bolsa.cutDate ? `, corte ${formatAppliedDate(bolsa.cutDate)}` : ''}).</p>
      </article>
      <article class="insight-card">
        <p class="eyebrow">Total al día CrediQ</p>
        <p class="bolsa-metric-value">${formatMoney(bolsa.totalCurrentCents ?? bolsa.capitalBalanceCents, 'USD')}</p>
        <p>Incluye seguros por devengar${bolsa.accruedInsuranceCents ? ` (${formatMoney(bolsa.accruedInsuranceCents, 'USD')})` : ''}.</p>
      </article>
      <article class="insight-card">
        <p class="eyebrow">Cuota referencia</p>
        <p class="bolsa-metric-value">${formatMoney(bolsa.installmentCents, 'USD')}</p>
        <p>Día ${bolsa.paymentDay ?? '—'} · Tasa ${formatPct(bolsa.interestRate)} anual</p>
      </article>
    </div>
    <div class="bolsa-projection">${projectionListHtml(bolsa)}</div>
    <div class="bolsa-progress">
      <span>Cuotas: ${bolsa.paidInstallments ?? '—'} pagadas · ${bolsa.pendingInstallments ?? '—'} pendientes · ${bolsa.totalInstallments ?? '—'} total</span>
      ${
        bolsa.budgetExpenseId
          ? `<span class="bolsa-link">Enlazado al presupuesto: <code>${escapeHtml(bolsa.budgetExpenseId)}</code></span>`
          : ''
      }
    </div>
  `
}

export function bolsaMovementsHtml(bolsa) {
  const movements = Array.isArray(bolsa?.movements) ? bolsa.movements : []
  if (!movements.length) {
    return '<p class="bolsa-empty">Sin movimientos registrados.</p>'
  }

  const rows = movements
    .map(
      (mov) => `
    <tr>
      <td>${formatAppliedDate(mov.appliedDate)}</td>
      <td>${escapeHtml(mov.receipt || '—')}</td>
      <td class="num">${formatMoney(mov.paymentCents, 'USD')}</td>
      <td class="num">${formatMoney(mov.capitalCents, 'USD')}</td>
      <td class="num">${mov.balanceAfterCents == null ? '—' : formatMoney(mov.balanceAfterCents, 'USD')}</td>
      <td>${escapeHtml(movementTypeLabel(mov.movementType))}</td>
    </tr>`,
    )
    .join('')

  return `
    <h3 class="bolsa-table-title">Movimientos (${movements.length})</h3>
    <div class="bolsa-table-wrap">
      <table class="bolsa-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Recibo</th>
            <th>Pago</th>
            <th>Capital</th>
            <th>Saldo capital</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

export function bolsaPanelHtml(bolsa, state, options = {}) {
  return `${bolsaSummaryHtml(bolsa)}${bolsaApplyPaymentHtml(bolsa, state, options)}${bolsaMovementsHtml(bolsa)}`
}

export async function fetchBolsaDetail(bolsaId) {
  const res = await fetch(`/api/bolsas/${encodeURIComponent(bolsaId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `No se pudo cargar la bolsa (${res.status})`)
  }
  return res.json()
}

export async function fetchBolsaList() {
  const res = await fetch('/api/bolsas', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `No se pudieron cargar las bolsas (${res.status})`)
  }
  const data = await res.json()
  return Array.isArray(data.bolsas) ? data.bolsas : []
}

export async function applyBolsaPaymentRequest(bolsaId, payload) {
  const res = await fetch(`/api/bolsas/${encodeURIComponent(bolsaId)}/apply-payment`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `No se pudo aplicar el pago (${res.status})`)
  return body
}
