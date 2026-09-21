import { escapeHtml, formatCreateNextLabel, formatMoney, formatMonthLabel } from './format.js'
import { isValidRate, toUsdCents } from './money.js'

function monthKeys(state) {
  return Object.keys(state?.months ?? {}).sort()
}

export function normalizeExpenseName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
}

function categoryName(month, categoryId) {
  return month?.categories?.find((category) => category.id === categoryId)?.name ?? ''
}

export function parentExpenseLines(month) {
  const rate = month?.exchangeRate
  return (month?.expenses ?? []).map((item) => {
    const usd = toUsdCents(item.amount, item.currency, rate)
    return {
      id: item.id,
      name: item.name,
      key: normalizeExpenseName(item.name),
      categoryId: item.categoryId,
      categoryName: categoryName(month, item.categoryId),
      amount: Math.round(Number(item.amount) || 0),
      currency: item.currency,
      usd,
    }
  })
}

function takeMatch(unused, predicate) {
  const index = unused.findIndex(predicate)
  if (index === -1) return null
  return unused.splice(index, 1)[0]
}

export function matchExpenseLines(prevLines, nextLines) {
  const unused = [...prevLines]
  const assigned = new Map()

  for (const next of nextLines) {
    if (!next.key) continue
    const prev = takeMatch(unused, (line) => line.key === next.key && line.id && line.id === next.id)
    if (prev) assigned.set(next, prev)
  }
  for (const next of nextLines) {
    if (assigned.has(next) || !next.key) continue
    const prev = takeMatch(
      unused,
      (line) => line.key === next.key && line.categoryId && line.categoryId === next.categoryId,
    )
    if (prev) assigned.set(next, prev)
  }
  for (const next of nextLines) {
    if (assigned.has(next) || !next.key) continue
    const prev = takeMatch(unused, (line) => line.key === next.key)
    if (prev) assigned.set(next, prev)
  }

  const risen = []
  const fallen = []
  const unchanged = []
  const added = []
  const skipped = []

  for (const next of nextLines) {
    const prev = assigned.get(next)
    if (!prev) {
      if (next.usd == null) skipped.push({ line: next, reason: 'rate' })
      else added.push(next)
      continue
    }
    if (prev.usd == null || next.usd == null) {
      skipped.push({ prev, next, reason: 'rate' })
      continue
    }
    const delta = next.usd - prev.usd
    const row = { prev, next, delta }
    if (delta > 0) risen.push(row)
    else if (delta < 0) fallen.push(row)
    else unchanged.push(row)
  }

  const removed = unused.filter((line) => {
    if (line.usd == null) {
      skipped.push({ line, reason: 'rate' })
      return false
    }
    return true
  })

  const byAbsDelta = (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.next.name.localeCompare(b.next.name, 'es')
  risen.sort(byAbsDelta)
  fallen.sort(byAbsDelta)
  added.sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name, 'es'))
  removed.sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name, 'es'))

  return { risen, fallen, added, removed, unchanged, skipped }
}

export function defaultComparePair(keys, currentKey, from, to) {
  const list = Array.isArray(keys) ? keys.filter(Boolean) : []
  if (from && to && from !== to && list.includes(from) && list.includes(to)) {
    return { from, to }
  }
  if (currentKey && list.includes(currentKey)) {
    const index = list.indexOf(currentKey)
    if (index > 0) return { from: list[index - 1], to: currentKey }
    if (index >= 0 && index < list.length - 1) return { from: currentKey, to: list[index + 1] }
  }
  if (list.length >= 2) return { from: list[list.length - 2], to: list[list.length - 1] }
  return { from: list[0] ?? null, to: list[0] ?? null }
}

export function compareSavedMonths(state, fromKey, toKey) {
  const prev = state?.months?.[fromKey]
  const next = state?.months?.[toKey]
  if (!prev || !next) {
    return { ok: false, reason: 'missing', fromKey, toKey }
  }
  const prevLines = parentExpenseLines(prev)
  const nextLines = parentExpenseLines(next)
  const diff = matchExpenseLines(prevLines, nextLines)
  const prevRateOk = isValidRate(prev.exchangeRate)
  const nextRateOk = isValidRate(next.exchangeRate)
  const prevHasNio = (prev.expenses ?? []).some((item) => item.currency === 'NIO')
  const nextHasNio = (next.expenses ?? []).some((item) => item.currency === 'NIO')
  return {
    ok: true,
    fromKey,
    toKey,
    prevRateOk,
    nextRateOk,
    rateWarn: (prevHasNio && !prevRateOk) || (nextHasNio && !nextRateOk),
    ...diff,
  }
}

function moneyOrDash(cents) {
  return cents == null ? '—' : formatMoney(cents, 'USD')
}

function signedDelta(cents) {
  if (cents == null) return '—'
  if (cents === 0) return 'Sin cambio'
  if (cents > 0) return `+${formatMoney(cents, 'USD')}`
  return formatMoney(cents, 'USD')
}

function monthOptions(keys, selected) {
  return keys
    .map(
      (key) =>
        `<option value="${escapeHtml(key)}" ${key === selected ? 'selected' : ''}>${escapeHtml(
          formatMonthLabel(key),
        )}</option>`,
    )
    .join('')
}

function lineMeta(line) {
  if (!line?.categoryName) return ''
  return `<p class="mom-cat">${escapeHtml(line.categoryName)}</p>`
}

function changeCard({ name, categoryHtml, prevUsd, nextUsd, delta, kind }) {
  return `
    <li class="mom-item" data-mom-kind="${escapeHtml(kind)}" data-mom-name="${escapeHtml(name)}">
      <p class="mom-name">${escapeHtml(name)}</p>
      ${categoryHtml}
      <p class="mom-amounts">
        <span>${escapeHtml(moneyOrDash(prevUsd))}</span>
        <span aria-hidden="true">→</span>
        <span>${escapeHtml(moneyOrDash(nextUsd))}</span>
      </p>
      <p class="mom-delta">${escapeHtml(signedDelta(delta))}</p>
    </li>
  `
}

function column(title, kind, items, empty) {
  const list = items.length
    ? `<ul class="mom-list">${items.join('')}</ul>`
    : `<p class="mom-empty-col">${escapeHtml(empty)}</p>`
  return `
    <article class="mom-col is-${escapeHtml(kind)}" aria-labelledby="mom-${escapeHtml(kind)}-title">
      <h3 id="mom-${escapeHtml(kind)}-title">${escapeHtml(title)}</h3>
      <p class="mom-count">${items.length}</p>
      ${list}
    </article>
  `
}

function emptyMonthHtml(entries) {
  const one = entries[0]
  if (!one) {
    return `
      <div class="empty empty-block analytics-empty" id="mom-empty">
        <p>No hay meses guardados para comparar partidas.</p>
      </div>
    `
  }
  const nextLabel = formatCreateNextLabel(one.key)
  return `
    <div class="empty empty-block analytics-empty" id="mom-empty">
      <p>
        Solo está guardado ${escapeHtml(one.title)}. Pulsa «${escapeHtml(
          nextLabel,
        )}» para copiarlo y ver qué gastos subieron, bajaron, son nuevos o ya no están.
      </p>
      <button type="button" class="btn btn-primary" data-action="create-next-month">${escapeHtml(nextLabel)}</button>
    </div>
  `
}

export function monthOverMonthHtml(state, { currentKey, compareFrom, compareTo, entries } = {}) {
  const keys = monthKeys(state)
  const monthEntries = entries ?? keys.map((key) => ({ key, title: formatMonthLabel(key) }))

  if (keys.length < 2) {
    return `
      <section class="mom-section chart-card" aria-labelledby="mom-title">
        <div class="chart-head">
          <div>
            <h2 id="mom-title">Mes a mes</h2>
            <p class="chart-caption">
              Qué partidas subieron, bajaron, aparecieron o se quitaron. Se emparejan por nombre
              (sin importar mayúsculas o acentos), no solo por el id que deja Crear mes. Cada mes
              convierte C$ con su tasa; los subgastos no inflan el monto de la partida.
            </p>
          </div>
        </div>
        ${emptyMonthHtml(monthEntries)}
      </section>
    `
  }

  const pair = defaultComparePair(keys, currentKey, compareFrom, compareTo)
  const diff = compareSavedMonths(state, pair.from, pair.to)
  const fromLabel = formatMonthLabel(pair.from)
  const toLabel = formatMonthLabel(pair.to)

  if (pair.from === pair.to) {
    return `
      <section class="mom-section chart-card" aria-labelledby="mom-title">
        <div class="chart-head">
          <div>
            <h2 id="mom-title">Mes a mes</h2>
            <p class="chart-caption">Elige dos meses distintos para comparar las partidas.</p>
          </div>
        </div>
        <div class="mom-pick">
          <label class="field">
            <span>De</span>
            <select data-action="compare-from" aria-label="Mes de partida">${monthOptions(keys, pair.from)}</select>
          </label>
          <label class="field">
            <span>a</span>
            <select data-action="compare-to" aria-label="Mes a comparar">${monthOptions(keys, pair.to)}</select>
          </label>
        </div>
      </section>
    `
  }

  const risen = diff.risen.map((row) =>
    changeCard({
      name: row.next.name,
      categoryHtml: lineMeta(row.next),
      prevUsd: row.prev.usd,
      nextUsd: row.next.usd,
      delta: row.delta,
      kind: 'up',
    }),
  )
  const fallen = diff.fallen.map((row) =>
    changeCard({
      name: row.next.name,
      categoryHtml: lineMeta(row.next),
      prevUsd: row.prev.usd,
      nextUsd: row.next.usd,
      delta: row.delta,
      kind: 'down',
    }),
  )
  const added = diff.added.map((line) =>
    changeCard({
      name: line.name,
      categoryHtml: lineMeta(line),
      prevUsd: null,
      nextUsd: line.usd,
      delta: line.usd,
      kind: 'new',
    }),
  )
  const removed = diff.removed.map((line) =>
    changeCard({
      name: line.name,
      categoryHtml: lineMeta(line),
      prevUsd: line.usd,
      nextUsd: null,
      delta: -line.usd,
      kind: 'gone',
    }),
  )

  const rateNote = diff.rateWarn
    ? `<p class="mom-warn">Falta una tasa válida en ${
        !diff.prevRateOk ? fromLabel : ''
      }${!diff.prevRateOk && !diff.nextRateOk ? ' y ' : ''}${
        !diff.nextRateOk ? toLabel : ''
      }. Las partidas en córdobas de ese mes no se pueden pasar a dólares.</p>`
    : ''

  return `
    <section class="mom-section chart-card" id="mom-section" aria-labelledby="mom-title">
      <div class="chart-head">
        <div>
          <h2 id="mom-title">Mes a mes</h2>
          <p class="chart-caption">
            De ${escapeHtml(fromLabel)} a ${escapeHtml(toLabel)}. Partidas emparejadas por nombre
            normalizado en el hogar. Cada mes convierte C$ con su propia tasa. Solo cuenta el monto
            de la partida; los subgastos no se suman otra vez.
          </p>
        </div>
      </div>
      <div class="mom-pick">
        <label class="field">
          <span>De</span>
          <select data-action="compare-from" aria-label="Mes de partida">${monthOptions(keys, pair.from)}</select>
        </label>
        <label class="field">
          <span>a</span>
          <select data-action="compare-to" aria-label="Mes a comparar">${monthOptions(keys, pair.to)}</select>
        </label>
      </div>
      ${rateNote}
      <div class="mom-board">
        ${column('Subieron', 'up', risen, 'Ningún gasto subió.')}
        ${column('Bajaron', 'down', fallen, 'Ningún gasto bajó.')}
        ${column('Nuevos', 'new', added, 'No hay gastos nuevos.')}
        ${column('Ya no están', 'gone', removed, 'Ningún gasto se quitó.')}
      </div>
    </section>
  `
}
