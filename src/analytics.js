import {
  CATEGORY_OTROS,
  CATEGORY_PRADERAS,
  CATEGORY_SAN_ANDRES,
} from './seed.js'
import {
  escapeHtml,
  formatCreateNextLabel,
  formatDueDay,
  formatMoney,
  formatMonthLabel,
  formatMonthTitle,
} from './format.js'
import { categoryTotalUsd, formatRate, isValidRate, monthTotals } from './money.js'
import { monthOverMonthHtml } from './mom.js'
import { buildRubroBreakdown, rubroMeta, rubroUsd, summarizeRubros } from './rubros.js'

export const MODE_TOTALS = 'totals'
export const MODE_CLASSIFICATION = 'classification'
export const MODE_RUBRO = 'rubro'

export function parseAnalyticsMode(value) {
  if (value === MODE_CLASSIFICATION) return MODE_CLASSIFICATION
  if (value === MODE_RUBRO) return MODE_RUBRO
  return MODE_TOTALS
}

const HOUSE_PRIORITY = [CATEGORY_SAN_ANDRES, CATEGORY_PRADERAS, CATEGORY_OTROS]
const HOUSE_FALLBACK = {
  [CATEGORY_SAN_ANDRES]: 'Casa San Andrés',
  [CATEGORY_PRADERAS]: 'Casa Praderas de Sandino',
  [CATEGORY_OTROS]: 'Otros gastos',
}

export function savedMonthKeys(state) {
  return Object.keys(state?.months ?? {}).sort()
}

export function categoryColor(id, index = 0) {
  if (id === CATEGORY_SAN_ANDRES) return 'var(--terracotta)'
  if (id === CATEGORY_PRADERAS) return 'var(--pine)'
  if (id === CATEGORY_OTROS) return '#5c5346'
  const extras = ['#3d5a80', '#8a5a2b', '#215549', '#7a2d13']
  return extras[index % extras.length]
}

export function buildMonthEntries(state) {
  return savedMonthKeys(state).map((key) => {
    const month = state.months[key]
    const totals = monthTotals(month)
    const categories = (month?.categories ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      usd: categoryTotalUsd(month, category.id),
    }))
    const rubros = summarizeRubros(month)
    return {
      key,
      label: formatMonthLabel(key),
      title: formatMonthTitle(key),
      rate: month?.exchangeRate,
      totals,
      categories,
      rubros,
    }
  })
}

export function unionCategories(entries) {
  const names = new Map()
  for (const entry of entries) {
    for (const category of entry.categories) {
      if (!names.has(category.id)) names.set(category.id, category.name)
    }
  }
  const ids = [...names.keys()]
  ids.sort((a, b) => {
    const ia = HOUSE_PRIORITY.indexOf(a)
    const ib = HOUSE_PRIORITY.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return String(names.get(a)).localeCompare(String(names.get(b)), 'es')
  })
  return ids.map((id) => ({ id, name: names.get(id) ?? HOUSE_FALLBACK[id] ?? id }))
}

export function categoryUsd(entry, categoryId) {
  if (!entry?.totals?.ok) return null
  const row = entry.categories.find((category) => category.id === categoryId)
  return row ? (row.usd ?? 0) : 0
}

function houseName(entries, id) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const row = entries[i].categories.find((category) => category.id === id)
    if (row?.name) return row.name
  }
  return HOUSE_FALLBACK[id] ?? id
}

function comparable(entries) {
  return entries.filter((entry) => entry.totals.ok)
}

function sharePct(part, whole) {
  if (!whole) return null
  return Math.round((Math.abs(part) / Math.abs(whole)) * 100)
}

function insightBiggest(entries, currentKey) {
  const ok = comparable(entries)
  const current = ok.find((entry) => entry.key === currentKey) ?? ok.at(-1)
  if (!current) {
    const broken = entries[0]
    return {
      title: 'El rubro que más pesa',
      body: broken
        ? `Falta una tasa válida en ${broken.title} para convertir C$ y $ al mismo dólar.`
        : 'No hay un mes guardado para leer los tipos de gasto.',
      tone: 'warn',
    }
  }
  const expenses = current.totals.expensesUsd
  const ranked = current.rubros?.items ?? []
  const top = ranked[0]
  if (!top || !expenses) {
    return {
      title: 'El rubro que más pesa',
      body: `${current.label} no tiene gastos anotados. Añádelos en Presupuesto; el mes cuenta solo el monto de cada partida.`,
      tone: 'empty',
    }
  }
  const pct = sharePct(top.usd, expenses)
  return {
    title: 'El rubro que más pesa',
    body: `En ${current.title}, ${top.label} se lleva ${formatMoney(top.usd, 'USD')}${
      pct == null ? '' : ` (${pct}% de los gastos)`
    }. Agrupa las dos casas; los subgastos no inflan este total.`,
    tone: 'default',
  }
}

function insightMom(entries) {
  if (entries.length < 2) {
    const one = entries[0]
    const nextLabel = one ? formatCreateNextLabel(one.key) : 'Crear el mes siguiente'
    return {
      title: 'Mes contra mes',
      body: one
        ? `Solo está guardado ${one.title}. En Presupuesto pulsa «${nextLabel}» para copiarlo y ver si el hogar sube o baja.`
        : 'Guarda un mes en Presupuesto para empezar a comparar.',
      tone: 'empty',
    }
  }
  const ok = comparable(entries)
  if (ok.length < 2) {
    const broken = entries.filter((entry) => !entry.totals.ok).map((entry) => entry.title)
    return {
      title: 'Mes contra mes',
      body: `Hay ${entries.length} meses, pero falta la tasa en ${broken.join(
        ' y ',
      )}. Cada mes convierte con su propia tasa; sin ella no hay dólares comparables.`,
      tone: 'warn',
    }
  }
  const prev = ok[ok.length - 2]
  const next = ok[ok.length - 1]
  const deltaExp = next.totals.expensesUsd - prev.totals.expensesUsd
  const deltaInc = next.totals.incomeUsd - prev.totals.incomeUsd
  let exp
  if (deltaExp === 0) {
    exp = `${next.label} gasta lo mismo que ${prev.label} (${formatMoney(next.totals.expensesUsd, 'USD')}).`
  } else if (deltaExp > 0) {
    exp = `${next.label} gasta ${formatMoney(deltaExp, 'USD')} más que ${prev.label} (${formatMoney(
      next.totals.expensesUsd,
      'USD',
    )} frente a ${formatMoney(prev.totals.expensesUsd, 'USD')}).`
  } else {
    exp = `${next.label} gasta ${formatMoney(-deltaExp, 'USD')} menos que ${prev.label} (${formatMoney(
      next.totals.expensesUsd,
      'USD',
    )} frente a ${formatMoney(prev.totals.expensesUsd, 'USD')}).`
  }
  let inc
  if (deltaInc === 0) inc = 'Los ingresos no se movieron.'
  else if (deltaInc > 0) inc = `Entraron ${formatMoney(deltaInc, 'USD')} más.`
  else inc = `Entraron ${formatMoney(-deltaInc, 'USD')} menos.`
  const net = next.totals.netUsd
  const netPhrase =
    net < 0
      ? `El balance de ${next.title} queda en ${formatMoney(net, 'USD')}.`
      : net > 0
        ? `El balance de ${next.title} queda a favor: ${formatMoney(net, 'USD')}.`
        : `En ${next.title} ingresos y gastos quedan a mano.`
  return {
    title: 'Mes contra mes',
    body: `${exp} ${inc} ${netPhrase}`,
    tone: deltaExp > 0 ? 'warn' : 'ok',
  }
}

function insightHouses(entries) {
  const ok = comparable(entries)
  if (!ok.length) {
    return {
      title: 'Qué casa se movió',
      body: 'Corrige la tasa del mes para ver cuánto lleva cada casa en dólares.',
      tone: 'warn',
    }
  }
  const saName = houseName(ok, CATEGORY_SAN_ANDRES)
  const prName = houseName(ok, CATEGORY_PRADERAS)
  if (ok.length === 1) {
    const month = ok[0]
    const sa = categoryUsd(month, CATEGORY_SAN_ANDRES) ?? 0
    const pr = categoryUsd(month, CATEGORY_PRADERAS) ?? 0
    const heavier = pr === sa ? null : pr > sa ? prName : saName
    const heavierPhrase = heavier ? ` Esta vez pesa más ${heavier}.` : ''
    return {
      title: 'Las dos casas',
      body: `En ${month.title}, ${prName} lleva ${formatMoney(pr, 'USD')} y ${saName} ${formatMoney(
        sa,
        'USD',
      )}.${heavierPhrase} Crea otro mes para ver cuál casa se mueve.`,
      tone: 'default',
    }
  }
  const prev = ok[ok.length - 2]
  const next = ok[ok.length - 1]
  const moves = [
    { id: CATEGORY_SAN_ANDRES, name: saName },
    { id: CATEGORY_PRADERAS, name: prName },
  ].map((house) => ({
    ...house,
    delta: (categoryUsd(next, house.id) ?? 0) - (categoryUsd(prev, house.id) ?? 0),
  }))
  const changed = moves.filter((house) => house.delta !== 0)
  if (!changed.length) {
    return {
      title: 'Qué casa se movió',
      body: `De ${prev.title} a ${next.title}, ${saName} y ${prName} gastaron lo mismo. Si el total cambió, está en otras categorías.`,
      tone: 'ok',
    }
  }
  const phrases = moves.map((house) => {
    if (house.delta === 0) return `${house.name} no cambió`
    if (house.delta > 0) return `${house.name} subió ${formatMoney(house.delta, 'USD')}`
    return `${house.name} bajó ${formatMoney(-house.delta, 'USD')}`
  })
  const biggest = [...changed].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
  return {
    title: 'Qué casa se movió',
    body: `${phrases.join('; ')}. El mayor cambio está en ${biggest.name}.`,
    tone: biggest.delta > 0 ? 'warn' : 'ok',
  }
}

export function buildInsights(entries, currentKey) {
  return [insightBiggest(entries, currentKey), insightMom(entries), insightHouses(entries)]
}

function moneyOrDash(cents) {
  return cents == null ? '—' : formatMoney(cents, 'USD')
}

function rateLabel(rate) {
  return isValidRate(rate) ? formatRate(rate) : 'Sin tasa'
}

function deltaCell(next, prev) {
  if (next == null || prev == null) return '—'
  const delta = next - prev
  if (delta === 0) return 'Sin cambio'
  const sign = delta > 0 ? '+' : '−'
  return `${sign}${formatMoney(Math.abs(delta), 'USD')}`
}

function nowStrip(entry) {
  if (!entry) return ''
  if (!entry.totals.ok) {
    return `<p class="analytics-now is-warn" id="analytics-now">Este mes en Presupuesto es ${escapeHtml(
      entry.label,
    )}: falta la tasa para sumar ingresos y gastos.</p>`
  }
  return `<p class="analytics-now" id="analytics-now">Este mes en Presupuesto es ${escapeHtml(
    entry.label,
  )}: ingresos ${escapeHtml(formatMoney(entry.totals.incomeUsd, 'USD'))} · gastos ${escapeHtml(
    formatMoney(entry.totals.expensesUsd, 'USD'),
  )} · balance ${escapeHtml(formatMoney(entry.totals.netUsd, 'USD'))} · tasa ${escapeHtml(
    rateLabel(entry.rate),
  )} C$ por 1 USD.</p>`
}

function insightCards(insights) {
  return `
    <section class="insight-grid" aria-label="Lectura del hogar">
      ${insights
        .map(
          (item) => `
        <article class="insight-card tone-${escapeHtml(item.tone)}">
          <p class="eyebrow">${escapeHtml(item.title)}</p>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `,
        )
        .join('')}
    </section>
  `
}

function modeTab(mode, id, label) {
  const current = mode === id
  return `<button type="button" class="view-tab${
    current ? ' is-current' : ''
  }" data-action="analytics-mode" data-mode="${id}" aria-pressed="${current}">${label}</button>`
}

function modeTabs(mode) {
  return `
    <div class="mode-tabs" role="group" aria-label="Cómo ver la analítica">
      ${modeTab(mode, MODE_TOTALS, 'Totales')}
      ${modeTab(mode, MODE_CLASSIFICATION, 'Por casa')}
      ${modeTab(mode, MODE_RUBRO, 'Por rubro')}
    </div>
  `
}

function compareTable(entries) {
  const showDelta = entries.length >= 2
  const lastOk = comparable(entries)
  const prev = lastOk.length >= 2 ? lastOk[lastOk.length - 2] : null
  const next = lastOk.length >= 2 ? lastOk[lastOk.length - 1] : lastOk[0] ?? null
  const head = entries
    .map((entry) => `<th scope="col">${escapeHtml(entry.label)}</th>`)
    .join('')
  const cells = (getValue) =>
    entries
      .map((entry) => `<td>${escapeHtml(moneyOrDash(getValue(entry)))}</td>`)
      .join('')
  const rateCells = entries
    .map((entry) => `<td>${escapeHtml(rateLabel(entry.rate))}</td>`)
    .join('')
  const deltaHead = showDelta ? '<th class="compare-delta" scope="col">Cambio</th>' : ''
  const delta = (getter) => {
    if (!showDelta) return ''
    if (!prev || !next) return '<td class="compare-delta">—</td>'
    return `<td class="compare-delta">${escapeHtml(deltaCell(getter(next), getter(prev)))}</td>`
  }
  return `
    <div class="compare-wrap">
      <table class="compare-table">
        <caption>
          Totales en dólares. Cada mes usa su propia tasa. El mes cuenta solo el monto de cada
          partida; los subgastos no se suman otra vez.
        </caption>
        <thead>
          <tr>
            <th scope="col">Concepto</th>
            ${head}
            ${deltaHead}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Ingresos</th>
            ${cells((entry) => entry.totals.incomeUsd)}
            ${delta((entry) => entry.totals.incomeUsd)}
          </tr>
          <tr>
            <th scope="row">Gastos</th>
            ${cells((entry) => entry.totals.expensesUsd)}
            ${delta((entry) => entry.totals.expensesUsd)}
          </tr>
          <tr>
            <th scope="row">Balance</th>
            ${cells((entry) => entry.totals.netUsd)}
            ${delta((entry) => entry.totals.netUsd)}
          </tr>
          <tr>
            <th scope="row">Tasa (C$ por 1 USD)</th>
            ${rateCells}
            ${showDelta ? '<td class="compare-delta"></td>' : ''}
          </tr>
        </tbody>
      </table>
    </div>
  `
}

function classificationTable(entries) {
  const cats = unionCategories(entries)
  if (!cats.length) {
    return `<div class="empty empty-block"><p>No hay categorías en los meses guardados.</p></div>`
  }
  const showDelta = comparable(entries).length >= 2
  const ok = comparable(entries)
  const prev = ok.length >= 2 ? ok[ok.length - 2] : null
  const next = ok.length >= 2 ? ok[ok.length - 1] : null
  const head = entries.map((entry) => `<th scope="col">${escapeHtml(entry.label)}</th>`).join('')
  const rows = cats
    .map((category) => {
      const cells = entries
        .map((entry) => `<td>${escapeHtml(moneyOrDash(categoryUsd(entry, category.id)))}</td>`)
        .join('')
      const delta = showDelta
        ? `<td class="compare-delta">${escapeHtml(deltaCell(categoryUsd(next, category.id), categoryUsd(prev, category.id)))}</td>`
        : ''
      return `<tr><th scope="row">${escapeHtml(category.name)}</th>${cells}${delta}</tr>`
    })
    .join('')
  return `
    <div class="compare-wrap">
      <table class="compare-table">
        <caption>
          Gastos por clasificación, en dólares, con la tasa de cada mes. Casa San Andrés, Praderas
          y las categorías que ustedes creen.
        </caption>
        <thead>
          <tr>
            <th scope="col">Clasificación</th>
            ${head}
            ${showDelta ? '<th class="compare-delta" scope="col">Cambio</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function groupedBarsHtml(entries) {
  const values = entries.flatMap((entry) =>
    entry.totals.ok ? [entry.totals.incomeUsd, entry.totals.expensesUsd] : [],
  )
  const max = Math.max(1, ...values.map((value) => Math.abs(value)))
  const desc = entries
    .map((entry) => {
      if (!entry.totals.ok) return `${entry.label}: sin tasa.`
      return `${entry.label}: ingresos ${formatMoney(entry.totals.incomeUsd, 'USD')}, gastos ${formatMoney(
        entry.totals.expensesUsd,
        'USD',
      )}.`
    })
    .join(' ')

  const clusters = entries
    .map((entry) => {
      if (!entry.totals.ok) {
        return `
          <div class="chart-cluster">
            <div class="chart-cluster-bars">
              <div class="chart-col">
                <span class="chart-bar-label">Sin tasa</span>
                <span class="chart-bar is-miss" style="height:8px"></span>
                <span class="chart-series-name">Corrige la tasa</span>
              </div>
            </div>
            <span class="chart-axis-label">${escapeHtml(entry.label)}</span>
          </div>
        `
      }
      const incomeH = Math.max(6, Math.round((Math.abs(entry.totals.incomeUsd) / max) * 160))
      const expenseH = Math.max(6, Math.round((Math.abs(entry.totals.expensesUsd) / max) * 160))
      return `
        <div class="chart-cluster">
          <div class="chart-cluster-bars">
            <div class="chart-col">
              <span class="chart-bar-label">${escapeHtml(formatMoney(entry.totals.incomeUsd, 'USD'))}</span>
              <span class="chart-bar is-income" style="height:${incomeH}px"></span>
              <span class="chart-series-name">Ingresos</span>
            </div>
            <div class="chart-col">
              <span class="chart-bar-label">${escapeHtml(formatMoney(entry.totals.expensesUsd, 'USD'))}</span>
              <span class="chart-bar is-expense-hatch" style="height:${expenseH}px"></span>
              <span class="chart-series-name">Gastos</span>
            </div>
          </div>
          <span class="chart-axis-label">${escapeHtml(entry.label)}</span>
        </div>
      `
    })
    .join('')

  return `
    <div class="chart-plot chart-plot-cluster" role="img" aria-label="${escapeHtml(desc)}">
      ${clusters}
    </div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-swatch is-income"></span> Ingresos (relleno liso)</span>
      <span class="legend-item"><span class="legend-swatch is-expense-hatch"></span> Gastos (rayas)</span>
    </div>
  `
}

function emptyCompare(entries) {
  const one = entries[0]
  if (!one) {
    return `
      <div class="empty empty-block analytics-empty" id="analytics-empty-compare">
        <p>No hay meses guardados para comparar.</p>
      </div>
    `
  }
  const nextLabel = formatCreateNextLabel(one.key)
  return `
    <div class="empty empty-block analytics-empty" id="analytics-empty-compare">
      <p>
        Hay un solo mes guardado (${escapeHtml(one.label)}). Abajo ves cómo se reparte ese mes.
        Para comparar lado a lado, pulsa «${escapeHtml(nextLabel)}».
      </p>
      <button type="button" class="btn btn-primary" data-action="create-next-month">${escapeHtml(nextLabel)}</button>
    </div>
  `
}

function hbarList(entries) {
  const cats = unionCategories(entries)
  if (!cats.length) {
    return `<div class="empty empty-block"><p>No hay categorías para graficar.</p></div>`
  }
  const allValues = cats.flatMap((category) =>
    entries.map((entry) => categoryUsd(entry, category.id)).filter((value) => value != null),
  )
  const max = Math.max(1, ...allValues.map((value) => Math.abs(value)))
  const monthLegend = entries
    .map((entry, index) => {
      const texture = index === 0 ? 'liso' : 'rayas'
      return `<span class="legend-item"><span class="legend-swatch is-m${index % 4}"></span> ${escapeHtml(
        entry.label,
      )} (${texture})</span>`
    })
    .join('')

  const rows = cats
    .map((category, catIndex) => {
      const color = categoryColor(category.id, catIndex)
      const bars = entries
        .map((entry, index) => {
          const usd = categoryUsd(entry, category.id)
          if (usd == null) {
            return `
              <div class="hbar">
                <span class="hbar-label">${escapeHtml(entry.label)}</span>
                <div class="hbar-track"><span class="hbar-fill is-miss" style="width:8px"></span></div>
                <span class="hbar-value">Sin tasa</span>
              </div>
            `
          }
          const width = Math.max(usd === 0 ? 0 : 4, Math.round((Math.abs(usd) / max) * 100))
          const expenses = entry.totals.ok ? entry.totals.expensesUsd : 0
          const pct = sharePct(usd, expenses)
          const pctLabel = pct == null ? '' : ` · ${pct}%`
          return `
            <div class="hbar">
              <span class="hbar-label">${escapeHtml(entry.label)}</span>
              <div class="hbar-track">
                <span class="hbar-fill is-m${index % 4}" style="width:${width}%;--bar:${color}"></span>
              </div>
              <span class="hbar-value">${escapeHtml(formatMoney(usd, 'USD'))}${escapeHtml(pctLabel)}</span>
            </div>
          `
        })
        .join('')
      return `
        <article class="class-row">
          <div class="class-row-head">
            <h3>${escapeHtml(category.name)}</h3>
          </div>
          ${bars}
        </article>
      `
    })
    .join('')

  return `
    <div class="chart-legend">${monthLegend}</div>
    <div class="hbar-list">${rows}</div>
  `
}

function totalsView(entries) {
  const needCompare = entries.length < 2
  const singleBreakdown =
    entries.length === 1
      ? `
        <section class="chart-card" aria-labelledby="single-class-title">
          <div class="chart-head">
            <div>
              <h2 id="single-class-title">Cómo se reparte ${escapeHtml(entries[0]?.label ?? 'el mes')}</h2>
              <p class="chart-caption">
                Gastos por casa y categoría, en dólares, con la tasa de este mes. Cada barra tiene
                nombre, monto y porcentaje.
              </p>
            </div>
          </div>
          ${hbarList(entries)}
        </section>
      `
      : ''
  return `
    ${needCompare ? emptyCompare(entries) : ''}
    <section class="chart-card" aria-labelledby="totals-title">
      <div class="chart-head">
        <div>
          <h2 id="totals-title">Ingresos y gastos lado a lado</h2>
          <p class="chart-caption">
            Totales en dólares. Cada mes convierte C$ con su propia tasa. Cada barra lleva nombre y
            monto; los gastos van rayados para no depender del color.
          </p>
        </div>
      </div>
      ${groupedBarsHtml(entries)}
      ${compareTable(entries)}
    </section>
    ${singleBreakdown}
  `
}

function classificationView(entries) {
  const note =
    entries.length < 2
      ? `<p class="chart-caption analytics-class-note">Con un solo mes ves el peso de cada casa. ${escapeHtml(
          formatCreateNextLabel(entries[0]?.key ?? '2026-10'),
        )} en Presupuesto agrega la segunda columna.</p>`
      : ''
  return `
    <section class="chart-card" aria-labelledby="class-title">
      <div class="chart-head">
        <div>
          <h2 id="class-title">Por casa</h2>
          <p class="chart-caption">
            Casa San Andrés, Casa Praderas de Sandino, Otros y las categorías que ustedes crearon.
            Montos en dólares con la tasa de cada mes; el total de la partida, no los subgastos.
          </p>
        </div>
      </div>
      ${note}
      ${hbarList(entries)}
      ${classificationTable(entries)}
    </section>
  `
}


function unionRubros(entries, currentKey) {
  const ids = new Set()
  for (const entry of entries) {
    for (const item of entry.rubros?.items ?? []) ids.add(item.id)
  }
  const current = entries.find((entry) => entry.key === currentKey) ?? entries.at(-1)
  const order = (current?.rubros?.items ?? []).map((item) => item.id)
  const rest = [...ids].filter((id) => !order.includes(id))
  return [...order, ...rest].map((id) => rubroMeta(id))
}

function amountForRubro(entry, rubroId) {
  if (!entry?.totals?.ok) return null
  return rubroUsd(entry, rubroId)
}

function rubroRankList(entries, currentKey) {
  const rubros = unionRubros(entries, currentKey)
  if (!rubros.length) {
    return `<div class="empty empty-block"><p>No hay rubros para graficar. Asigna un tipo de gasto al editar la partida.</p></div>`
  }
  const allValues = rubros.flatMap((rubro) =>
    entries.map((entry) => amountForRubro(entry, rubro.id)).filter((value) => value != null),
  )
  const max = Math.max(1, ...allValues.map((value) => Math.abs(value)))
  const monthLegend = entries
    .map((entry, index) => {
      const texture = index === 0 ? 'liso' : 'rayas'
      return `<span class="legend-item"><span class="legend-swatch is-m${index % 4}"></span> ${escapeHtml(
        entry.label,
      )} (${texture})</span>`
    })
    .join('')

  const rows = rubros
    .map((rubro, rankIndex) => {
      const color = rubro.color
      const bars = entries
        .map((entry, index) => {
          const usd = amountForRubro(entry, rubro.id)
          if (usd == null) {
            return `
              <div class="hbar">
                <span class="hbar-label">${escapeHtml(entry.label)}</span>
                <div class="hbar-track"><span class="hbar-fill is-miss" style="width:8px"></span></div>
                <span class="hbar-value">Sin tasa</span>
              </div>
            `
          }
          const width = Math.max(usd === 0 ? 0 : 4, Math.round((Math.abs(usd) / max) * 100))
          const expenses = entry.totals.ok ? entry.totals.expensesUsd : 0
          const pct = sharePct(usd, expenses)
          const pctLabel = pct == null ? '' : ` · ${pct}%`
          return `
            <div class="hbar">
              <span class="hbar-label">${escapeHtml(entry.label)}</span>
              <div class="hbar-track">
                <span class="hbar-fill is-m${index % 4}" style="width:${width}%;--bar:${color}"></span>
              </div>
              <span class="hbar-value">${escapeHtml(formatMoney(usd, 'USD'))}${escapeHtml(pctLabel)}</span>
            </div>
          `
        })
        .join('')
      return `
        <article class="class-row rank-row" data-rubro="${escapeHtml(rubro.id)}">
          <div class="class-row-head rank-head">
            <span class="rank-n" aria-hidden="true">${rankIndex + 1}</span>
            <div>
              <h3>${escapeHtml(rubro.label)}</h3>
              <p class="rank-hint">${escapeHtml(rubro.hint)}</p>
            </div>
          </div>
          ${bars}
        </article>
      `
    })
    .join('')

  return `
    <div class="chart-legend">${monthLegend}</div>
    <div class="hbar-list rank-list" id="rubro-ranking">${rows}</div>
  `
}

function rubroTable(entries, currentKey) {
  const rubros = unionRubros(entries, currentKey)
  if (!rubros.length) {
    return `<div class="empty empty-block"><p>No hay rubros en los meses guardados.</p></div>`
  }
  const showDelta = comparable(entries).length >= 2
  const ok = comparable(entries)
  const prev = ok.length >= 2 ? ok[ok.length - 2] : null
  const next = ok.length >= 2 ? ok[ok.length - 1] : null
  const head = entries.map((entry) => `<th scope="col">${escapeHtml(entry.label)}</th>`).join('')
  const rows = rubros
    .map((rubro, index) => {
      const cells = entries
        .map((entry) => `<td>${escapeHtml(moneyOrDash(amountForRubro(entry, rubro.id)))}</td>`)
        .join('')
      const delta = showDelta
        ? `<td class="compare-delta">${escapeHtml(
            deltaCell(amountForRubro(next, rubro.id), amountForRubro(prev, rubro.id)),
          )}</td>`
        : ''
      return `<tr><th scope="row">${index + 1}. ${escapeHtml(rubro.label)}</th>${cells}${delta}</tr>`
    })
    .join('')
  return `
    <div class="compare-wrap">
      <table class="compare-table" id="rubro-table">
        <caption>
          Gastos por rubro, del más fuerte al más suave, en dólares con la tasa de cada mes.
          Vivienda junta la hipoteca de San Andrés y la renta de Praderas. Solo el monto de la
          partida; los subgastos no se suman otra vez.
        </caption>
        <thead>
          <tr>
            <th scope="col">Rubro</th>
            ${head}
            ${showDelta ? '<th class="compare-delta" scope="col">Cambio</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `
}

function rubroView(entries, currentKey) {
  const note =
    entries.length < 2
      ? `<p class="chart-caption analytics-class-note">Con un solo mes ves el ranking. ${escapeHtml(
          formatCreateNextLabel(entries[0]?.key ?? '2026-10'),
        )} en Presupuesto agrega la segunda columna.</p>`
      : ''
  return `
    <section class="chart-card" aria-labelledby="rubro-title">
      <div class="chart-head">
        <div>
          <h2 id="rubro-title">Por rubro</h2>
          <p class="chart-caption">
            Tipos de gasto entre las dos casas, del más fuerte al más suave. Crédito y camionetas
            suelen ir arriba; vivienda junta hipoteca San Andrés y renta Praderas. Dólares con la
            tasa de cada mes; el total de la partida, no los subgastos.
          </p>
        </div>
      </div>
      ${note}
      ${rubroRankList(entries, currentKey)}
      ${rubroTable(entries, currentKey)}
    </section>
  `
}

export function analyticsHtml(
  state,
  { mode = MODE_TOTALS, currentKey, compareFrom, compareTo } = {},
) {
  const entries = buildMonthEntries(state)
  const insights = buildInsights(entries, currentKey)
  const current = entries.find((entry) => entry.key === currentKey) ?? entries[0]
  const view =
    mode === MODE_RUBRO
      ? rubroView(entries, currentKey)
      : mode === MODE_CLASSIFICATION
        ? classificationView(entries)
        : totalsView(entries)
  return `
    <h1 id="analytics-title" tabindex="-1">Analítica</h1>
    <p class="analytics-lede">
      Lectura de Melissa y Lenin: dos casas, dólares y córdobas. Cada mes se convierte con su
      propia tasa. Los subgastos no se cuentan otra vez. El rubro agrupa el mismo tipo de vida
      entre las dos casas.
    </p>
    ${nowStrip(current)}
    ${monthOverMonthHtml(state, { currentKey, compareFrom, compareTo, entries })}
    ${modeTabs(mode)}
    ${insightCards(insights)}
    ${view}
  `
}
