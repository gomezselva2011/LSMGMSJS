import { escapeHtml, formatMoney, formatMonthLabel } from './format.js'
import { isPaidLine, paymentStatusLabel } from './payment-status.js'
import { bolsaProjectionFacts } from '../server/bolsa-projection.js'
import {
  TIGGO_BOLSA_ID,
  bolsaAllowsBudgetExpense,
  budgetLinksForBolsa,
} from './bolsa-budget-link.js'

export { TIGGO_BOLSA_ID }

function bolsaCurrency(bolsa) {
  return bolsa?.currency || 'USD'
}

function bolsaStatementKind(bolsa) {
  const creditor = String(bolsa?.creditor || '')
  if (/crediq/i.test(creditor)) return 'crediq'
  if (/ficohsa/i.test(creditor)) return 'ficohsa'
  if (/banpro|promerica/i.test(creditor)) return 'banpro'
  return 'generic'
}

function capitalGoalCopy(bolsa) {
  const currency = bolsaCurrency(bolsa)
  const cut = bolsa.cutDate ? `, corte ${formatAppliedDate(bolsa.cutDate)}` : ''
  const kind = bolsaStatementKind(bolsa)
  if (kind === 'crediq') {
    return `Meta: llevar a ${formatMoney(0, currency)} (saldo cancelación CrediQ${cut}).`
  }
  if (kind === 'ficohsa') {
    return `Meta: llevar a ${formatMoney(0, currency)} (saldo al corte Ficohsa${cut}).`
  }
  if (kind === 'banpro') {
    return `Meta: llevar a ${formatMoney(0, currency)} (saldo principal Banpro${cut}).`
  }
  return `Meta: llevar el capital a ${formatMoney(0, currency)}${cut}.`
}

function totalCurrentLabel(bolsa) {
  const kind = bolsaStatementKind(bolsa)
  if (kind === 'crediq') return 'Total al día CrediQ'
  if (kind === 'ficohsa') return 'Saldo al corte'
  if (kind === 'banpro') return 'Saldo principal'
  return 'Total al día'
}

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

/** Etiqueta de ayuda en UI (no renombra líneas del presupuesto). */
export function budgetLineLabelForBolsa(bolsa) {
  if (!bolsa) return 'Cuota'
  return bolsa.name || 'Cuota'
}

/** @returns {{ key: string, sourceMonthKey: string, expenseId: string, chargeId: string|null, label: string, amount: number, currency: string, paid: boolean }[]} */
export function listBolsaBudgetPaymentLines(state, bolsa, _options = {}) {
  if (!state?.months || !bolsa) return []
  const keys = Object.keys(state.months).filter((key) => /^\d{4}-\d{2}$/.test(key)).sort()
  const lines = []
  for (const monthKey of keys) {
    const month = state.months[monthKey]
    const expenses = Array.isArray(month?.expenses) ? month.expenses : []
    for (const expense of expenses) {
      if (!expense?.id || !bolsaAllowsBudgetExpense(bolsa, expense)) continue
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
  }
  return lines
}

function projectionListHtml(bolsa) {
  const currency = bolsaCurrency(bolsa)
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
      `<li><strong>Flujo total estimado:</strong> ${pending} × ${formatMoney(installment, currency)} ≈ ${formatMoney(facts.flowTotalCents, currency)} <span class="bolsa-projection-note">(interés y seguros incluidos; no es solo capital)</span></li>`,
    )
  }

  items.push(
    `<li><strong>Capital pendiente:</strong> ${formatMoney(bolsa.capitalBalanceCents, currency)} al corte${bolsa.cutDate ? ` (${formatAppliedDate(bolsa.cutDate)})` : ''}.</li>`,
  )

  if (!items.length) {
    return '<p class="bolsa-projection-note">Sin proyección: faltan cuotas o datos de calendario.</p>'
  }

  return `<ul class="bolsa-projection-list">${items.join('')}</ul>`
}

/** @param {{ appliedDate?: string, balanceAfterCents?: number|null, sortOrder?: number }[]} movements */
export function bolsaCapitalChartSeries(movements) {
  const list = Array.isArray(movements) ? [...movements] : []
  list.sort((a, b) => {
    const so = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    if (so !== 0) return so
    return String(a.appliedDate || '').localeCompare(String(b.appliedDate || ''))
  })
  return list
    .filter((mov) => mov.balanceAfterCents != null && Number.isFinite(Number(mov.balanceAfterCents)))
    .map((mov) => ({
      label: formatAppliedDate(mov.appliedDate),
      balanceCents: Number(mov.balanceAfterCents),
    }))
}

export function bolsaChartHtml(bolsa) {
  const currency = bolsaCurrency(bolsa)
  const series = bolsaCapitalChartSeries(bolsa?.movements)
  if (!series.length) {
    return ''
  }
  const maxBalance = Math.max(...series.map((entry) => entry.balanceCents), 1)
  const maxBarPx = 120
  const cols = series
    .map((entry) => {
      const height = Math.max(4, Math.round((entry.balanceCents / maxBalance) * maxBarPx))
      return `
        <div class="chart-col" title="${escapeHtml(formatMoney(entry.balanceCents, currency))}">
          <span class="chart-bar-label">${escapeHtml(formatMoney(entry.balanceCents, currency))}</span>
          <span class="chart-bar is-net-pos" style="height:${height}px"></span>
          <span class="chart-axis-label">${escapeHtml(entry.label)}</span>
        </div>`
    })
    .join('')

  return `
    <section class="chart-card bolsa-capital-chart" aria-labelledby="bolsa-chart-title">
      <div class="chart-head">
        <div>
          <h3 class="bolsa-table-title" id="bolsa-chart-title">Saldo capital por movimiento</h3>
          <p class="chart-caption">Cronológico (incluye pagos manuales). Altura = saldo capital después de cada movimiento.</p>
        </div>
      </div>
      <div class="chart-plot" role="img" aria-label="Saldo de capital después de cada movimiento de la bolsa">
        ${cols}
      </div>
    </section>
  `
}

/** @returns {{ id: string, name: string }[]} */
export function listPresupuestoExpenseLinkOptions(state) {
  if (!state?.months) return []
  const monthKeys = Object.keys(state.months)
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort()
  const byId = new Map()
  for (const monthKey of monthKeys) {
    const expenses = state.months[monthKey]?.expenses
    if (!Array.isArray(expenses)) continue
    for (const expense of expenses) {
      if (!expense?.id) continue
      byId.set(expense.id, { id: expense.id, name: String(expense.name || expense.id).trim() || expense.id })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function bolsaBudgetLinkHtml(bolsa, state, { canEdit = false } = {}) {
  if (!canEdit) {
    return bolsa?.budgetExpenseId
      ? `<p class="bolsa-link">Enlazado al presupuesto: <code>${escapeHtml(bolsa.budgetExpenseId)}</code></p>`
      : ''
  }
  const options = listPresupuestoExpenseLinkOptions(state)
  if (!options.length) {
    return `<section class="bolsa-link-setup" aria-labelledby="bolsa-link-title">
      <h3 class="bolsa-table-title" id="bolsa-link-title">Enlace al presupuesto</h3>
      <p class="bolsa-empty">No hay gastos en los meses cargados. Crea líneas en Presupuesto y vuelve aquí para enlazar.</p>
    </section>`
  }
  const selected = bolsa?.budgetExpenseId || ''
  const optionHtml = options
    .map(
      (row) =>
        `<option value="${escapeHtml(row.id)}"${row.id === selected ? ' selected' : ''}>${escapeHtml(row.name)} · <code>${escapeHtml(row.id)}</code></option>`,
    )
    .join('')
  return `
    <section class="bolsa-link-setup" aria-labelledby="bolsa-link-title">
      <h3 class="bolsa-table-title" id="bolsa-link-title">Enlace al presupuesto</h3>
      <p class="bolsa-projection-note">Elige qué <strong>id de gasto</strong> del presupuesto corresponde a esta bolsa. Los pagos manuales buscan esa línea en cada mes (en Tiggo 4, las líneas llamadas Himla en el id viejo no se mezclan).</p>
      <form class="bolsa-link-form" data-action="bolsa-set-budget-link">
        <label class="field">
          <span>Línea enlazada</span>
          <select name="budgetExpenseId" required>${optionHtml}</select>
        </label>
        <button type="submit" class="btn btn-secondary">Guardar enlace</button>
      </form>
    </section>`
}

export function bolsaApplyPaymentHtml(bolsa, state, { canEdit = false } = {}) {
  if (!canEdit) return ''
  if (!bolsa?.budgetExpenseId) {
    return `<section class="bolsa-apply" aria-labelledby="bolsa-apply-title">
      <h3 class="bolsa-table-title" id="bolsa-apply-title">Aplicar pago manual</h3>
      <p class="bolsa-empty">Guarda un enlace al presupuesto arriba para ver las cuotas disponibles.</p>
    </section>`
  }
  const lines = listBolsaBudgetPaymentLines(state, bolsa)
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
      <p class="bolsa-projection-note">Cuotas enlazadas (ids ${escapeHtml([...new Set(budgetLinksForBolsa(bolsa).map((l) => l.expenseId))].join(', '))}). Nombre real del presupuesto en cada mes.</p>
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

export function bolsaPickerTabsHtml(bolsas, selectedId) {
  const list = Array.isArray(bolsas) ? bolsas : []
  if (list.length <= 1) return ''
  const tabs = list
    .map((item) => {
      const current = item.id === selectedId
      return `<button type="button" class="bolsa-tab${current ? ' is-current' : ''}" data-action="bolsa-select" data-bolsa-id="${escapeHtml(item.id)}"${current ? ' aria-current="true"' : ''}>${escapeHtml(item.name || item.id)}</button>`
    })
    .join('')
  return `<nav class="bolsa-tabs" aria-label="Elegir bolsa">${tabs}</nav>`
}

export function bolsaSummaryHtml(bolsa) {
  if (!bolsa) {
    return '<p class="bolsa-empty">No hay bolsas de deuda todavía.</p>'
  }

  const currency = bolsaCurrency(bolsa)
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
        <p class="bolsa-metric-value">${formatMoney(bolsa.capitalBalanceCents, currency)}</p>
        <p>${escapeHtml(capitalGoalCopy(bolsa))}</p>
      </article>
      <article class="insight-card">
        <p class="eyebrow">${escapeHtml(totalCurrentLabel(bolsa))}</p>
        <p class="bolsa-metric-value">${formatMoney(bolsa.totalCurrentCents ?? bolsa.capitalBalanceCents, currency)}</p>
        <p>${
          bolsa.accruedInsuranceCents
            ? `Incluye seguros por devengar (${formatMoney(bolsa.accruedInsuranceCents, currency)}).`
            : 'Saldo de referencia al corte del acreedor.'
        }</p>
      </article>
      <article class="insight-card">
        <p class="eyebrow">Cuota referencia</p>
        <p class="bolsa-metric-value">${formatMoney(bolsa.installmentCents, currency)}</p>
        <p>Día ${bolsa.paymentDay ?? '—'}${bolsa.interestRate != null ? ` · Tasa ${formatPct(bolsa.interestRate)} anual` : ''}</p>
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
  const currency = bolsaCurrency(bolsa)
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
      <td class="num">${formatMoney(mov.paymentCents, currency)}</td>
      <td class="num">${formatMoney(mov.capitalCents, currency)}</td>
      <td class="num">${mov.balanceAfterCents == null ? '—' : formatMoney(mov.balanceAfterCents, currency)}</td>
      <td>${escapeHtml(movementTypeLabel(mov.movementType))}</td>
      <td class="bolsa-row-actions">${
        mov.deletable
          ? `<button type="button" class="btn btn-row" data-action="bolsa-delete-movement" data-movement-id="${escapeHtml(mov.id)}" title="Quitar pago y desvincular del presupuesto">Quitar pago</button>`
          : ''
      }</td>
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
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

export function bolsaPanelHtml(bolsa, state, options = {}) {
  const tabs = bolsaPickerTabsHtml(options.bolsas, bolsa?.id)
  return `${tabs}${bolsaSummaryHtml(bolsa)}${bolsaChartHtml(bolsa)}${bolsaBudgetLinkHtml(bolsa, state, options)}${bolsaApplyPaymentHtml(bolsa, state, options)}${bolsaMovementsHtml(bolsa)}`
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

export async function updateBolsaBudgetLinkRequest(bolsaId, budgetExpenseId) {
  const res = await fetch(`/api/bolsas/${encodeURIComponent(bolsaId)}/budget-link`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budgetExpenseId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `No se pudo guardar el enlace (${res.status})`)
  return body
}

export async function deleteBolsaMovementRequest(bolsaId, movementId) {
  const res = await fetch(
    `/api/bolsas/${encodeURIComponent(bolsaId)}/movements/${encodeURIComponent(movementId)}`,
    {
      method: 'DELETE',
      credentials: 'same-origin',
    },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `No se pudo quitar el pago (${res.status})`)
  return body
}
