import {
  CATEGORY_OTROS,
  CATEGORY_PRADERAS,
  CATEGORY_SAN_ANDRES,
} from './seed.js'
import {
  escapeHtml,
  formatCreateNextLabel,
  formatMoney,
  formatMonthLabel,
  formatMonthTitle,
} from './format.js'
import { categoryTotalUsd, formatRate, isValidRate, monthTotals } from './money.js'

export const MODE_TOTALS = 'totals'
export const MODE_CLASSIFICATION = 'classification'

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
    return {
      key,
      label: formatMonthLabel(key),
      title: formatMonthTitle(key),
      rate: month?.exchangeRate,
      totals,
      categories,
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
      title: 'La categoría que más pesa',
      body: broken
        ? `Falta una tasa válida en ${broken.title} para convertir C$ y $ al mismo dólar.`
        : 'No hay un mes guardado para leer las categorías.',
      tone: 'warn',
    }
  }
  const expenses = current.totals.expensesUsd
  const ranked = current.categories
    .filter((category) => category.usd != null)
    .sort((a, b) => b.usd - a.usd)
  const top = ranked[0]
  if (!top || !expenses) {
    return {
      title: 'La categoría que más pesa',
      body: `${current.label} no tiene gastos anotados. Añádelos en Presupuesto; el mes cuenta solo el monto de cada partida.`,
      tone: 'empty',
    }
  }
  const pct = sharePct(top.usd, expenses)
  return {
    title: 'La categoría que más pesa',
    body: `En ${current.title}, ${top.name} se lleva ${formatMoney(top.usd, 'USD')}${
      pct == null ? '' : ` (${pct}% de los gastos)`
    }. Los subgastos no inflan este total: solo descuentan de su partida.`,
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

function modeTabs(mode) {
  const totals = mode === MODE_CLASSIFICATION ? '' : ' is-current'
  const klass = mode === MODE_CLASSIFICATION ? ' is-current' : ''
  return `
    <div class="mode-tabs" role="group" aria-label="Cómo ver la analítica">
      <button type="button" class="view-tab${totals}" data-action="analytics-mode" data-mode="${MODE_TOTALS}" aria-pressed="${
        mode !== MODE_CLASSIFICATION
      }">Totales</button>
      <button type="button" class="view-tab${klass}" data-action="analytics-mode" data-mode="${MODE_CLASSIFICATION}" aria-pressed="${
        mode === MODE_CLASSIFICATION
      }">Por clasificación</button>
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
  const deltaHead = showDelta ? '<th scope="col">Cambio</th>' : ''
  const delta = (getter) => {
    if (!showDelta) return ''
    if (!prev || !next) return '<td>—</td>'
    return `<td>${escapeHtml(deltaCell(getter(next), getter(prev)))}</td>`
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
            ${showDelta ? '<td></td>' : ''}
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
        ? `<td>${escapeHtml(deltaCell(categoryUsd(next, category.id), categoryUsd(prev, category.id)))}</td>`
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
            ${showDelta ? '<th scope="col">Cambio</th>' : ''}
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
          <h2 id="class-title">Por clasificación</h2>
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

export function analyticsHtml(state, { mode = MODE_TOTALS, currentKey } = {}) {
  const entries = buildMonthEntries(state)
  const insights = buildInsights(entries, currentKey)
  const current = entries.find((entry) => entry.key === currentKey) ?? entries[0]
  const view = mode === MODE_CLASSIFICATION ? classificationView(entries) : totalsView(entries)
  return `
    <h1 id="analytics-title" tabindex="-1">Analítica</h1>
    <p class="analytics-lede">
      Lectura de Melissa y Lenin: dos casas, dólares y córdobas. Cada mes se convierte con su
      propia tasa. Los subgastos no se cuentan otra vez.
    </p>
    ${nowStrip(current)}
    ${modeTabs(mode)}
    ${insightCards(insights)}
    ${view}
  `
}
