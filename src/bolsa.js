import { escapeHtml, formatMoney } from './format.js'

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

function projectionNote(bolsa) {
  const pending = bolsa.pendingInstallments ?? 0
  const installment = bolsa.installmentCents ?? 0
  if (!pending || !installment) {
    return 'Proyección simple: faltan cuotas por pagar el capital pendiente más interés y seguros según CrediQ.'
  }
  const flowTotal = pending * installment
  return `Proyección simple: ${pending} cuotas × ${formatMoney(installment, 'USD')} ≈ ${formatMoney(flowTotal, 'USD')} de flujo total (incluye interés y seguros; no es solo capital). Capital pendiente ${formatMoney(bolsa.capitalBalanceCents, 'USD')} al corte.`
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
    <p class="bolsa-projection">${escapeHtml(projectionNote(bolsa))}</p>
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

export function bolsaPanelHtml(bolsa) {
  return `${bolsaSummaryHtml(bolsa)}${bolsaMovementsHtml(bolsa)}`
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
