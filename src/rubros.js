/** Spending families (rubros) across both houses. Amounts stay on the parent line. */

import { toUsdCents, isValidRate, formatRate } from './money.js'

export const RUBRO_VIVIENDA = 'vivienda'
export const RUBRO_CAMIONETAS = 'camionetas'
export const RUBRO_CREDITO = 'credito'
export const RUBRO_COMIDA = 'comida'
export const RUBRO_ESCUELAS = 'escuelas'
export const RUBRO_IGLESIA = 'iglesia'
export const RUBRO_FAMILIA = 'familia'
export const RUBRO_SERVICIOS = 'servicios'
export const RUBRO_NONE = 'none'

export const RUBROS = [
  {
    id: RUBRO_VIVIENDA,
    name: 'Vivienda',
    label: 'Vivienda: hipoteca San Andrés + renta Praderas',
    color: 'var(--terracotta)',
    hint: 'Casa de San Andrés (hipoteca) y Casa de Praderas (renta).',
  },
  {
    id: RUBRO_CAMIONETAS,
    name: 'Camionetas',
    label: 'Camionetas',
    color: '#3d5a80',
    hint: 'Mensualidad, camioneta y gasolina.',
  },
  {
    id: RUBRO_CREDITO,
    name: 'Crédito',
    label: 'Crédito',
    color: '#8a5a2b',
    hint: 'Las tarjetas de Melissa y Lenin.',
  },
  {
    id: RUBRO_COMIDA,
    name: 'Comida',
    label: 'Comida',
    color: 'var(--pine)',
    hint: 'Comida del hogar, no las tarjetas.',
  },
  {
    id: RUBRO_ESCUELAS,
    name: 'Escuelas',
    label: 'Escuelas',
    color: '#5b3d8f',
    hint: 'Matrículas, colegiaturas y recorrido.',
  },
  {
    id: RUBRO_IGLESIA,
    name: 'Iglesia',
    label: 'Iglesia',
    color: '#5c5346',
    hint: 'Diezmo y ofrenda.',
  },
  {
    id: RUBRO_FAMILIA,
    name: 'Familia',
    label: 'Familia',
    color: '#7a2d13',
    hint: 'Apoyo a la familia, como Madre y Doña Pina.',
  },
  {
    id: RUBRO_SERVICIOS,
    name: 'Servicios',
    label: 'Servicios',
    color: '#2a6b63',
    hint: 'Luz, agua, internet y seguridad de las dos casas.',
  },
]

const NONE_META = {
  id: RUBRO_NONE,
  name: 'Sin rubro',
  label: 'Sin rubro',
  color: '#8a8174',
  hint: 'Esta partida no entra en el ranking de rubros hasta que le asignes un tipo.',
}

const RUBRO_BY_ID = new Map(RUBROS.map((rubro) => [rubro.id, rubro]))
RUBRO_BY_ID.set(RUBRO_NONE, NONE_META)

const SEED_RUBRO_BY_EXPENSE = {
  'exp-sa-casa': RUBRO_VIVIENDA,
  'exp-pr-casa': RUBRO_VIVIENDA,
  'exp-ot-camioneta': RUBRO_CAMIONETAS,
  'exp-pr-camioneta': RUBRO_CAMIONETAS,
  'exp-pr-gasolina': RUBRO_CAMIONETAS,
  'exp-ot-tc-lenin': RUBRO_CREDITO,
  'exp-ot-tc-melissa': RUBRO_CREDITO,
  'exp-pr-comida': RUBRO_COMIDA,
  'exp-ot-mat-mateo': RUBRO_ESCUELAS,
  'exp-ot-mat-marcela': RUBRO_ESCUELAS,
  'exp-pr-esc-mateo': RUBRO_ESCUELAS,
  'exp-pr-esc-marcela': RUBRO_ESCUELAS,
  'exp-pr-recorrido': RUBRO_ESCUELAS,
  'exp-ot-iglesia': RUBRO_IGLESIA,
  'exp-pr-dona-pina': RUBRO_FAMILIA,
  'exp-pr-madre': RUBRO_FAMILIA,
  'exp-sa-luz': RUBRO_SERVICIOS,
  'exp-sa-agua': RUBRO_SERVICIOS,
  'exp-sa-internet': RUBRO_SERVICIOS,
  'exp-sa-seguridad': RUBRO_SERVICIOS,
  'exp-pr-agua': RUBRO_SERVICIOS,
  'exp-pr-luz': RUBRO_SERVICIOS,
  'exp-pr-internet': RUBRO_SERVICIOS,
  'exp-pr-seguridad': RUBRO_SERVICIOS,
  'exp-ot-internet-lenin': RUBRO_SERVICIOS,
}

function foldName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function isKnownRubro(id) {
  return Boolean(id) && id !== RUBRO_NONE && RUBRO_BY_ID.has(id)
}

export function rubroMeta(id) {
  const meta = RUBRO_BY_ID.get(id) ?? NONE_META
  return { ...meta, label: meta.label ?? meta.name }
}

function inferRubroFromName(name) {
  const text = foldName(name)
  if (!text) return ''
  if (/\b(tc|tarjeta)\b/.test(text) || /\bcredito\b/.test(text)) return RUBRO_CREDITO
  if (/\b(camioneta|gasolina|gas)\b/.test(text) || text.includes('mensualidad camioneta')) {
    return RUBRO_CAMIONETAS
  }
  if (/\b(hipoteca|renta|alquiler)\b/.test(text) || text === 'casa' || /\bcasa\b/.test(text)) {
    return RUBRO_VIVIENDA
  }
  if (/\b(escuela|matricula|colegio|recorrido|colegiatura)\b/.test(text)) return RUBRO_ESCUELAS
  if (/\b(iglesia|diezmo|ofrenda)\b/.test(text)) return RUBRO_IGLESIA
  if (/\b(comida|super|supermercado|mercado|alimentos)\b/.test(text)) return RUBRO_COMIDA
  if (/\b(luz|agua|internet|wifi|seguridad|cable)\b/.test(text)) return RUBRO_SERVICIOS
  if (/\b(madre|padre|papa|mama|dona|familia|abuela|abuelo)\b/.test(text)) return RUBRO_FAMILIA
  return ''
}

export function inferRubro(expense) {
  const fromName = inferRubroFromName(expense?.name)
  if (fromName) return fromName
  const bySeed = SEED_RUBRO_BY_EXPENSE[expense?.id]
  return bySeed || ''
}

export function resolveRubro(expense) {
  const explicit = String(expense?.rubro ?? expense?.rubroId ?? '').trim()
  if (explicit === RUBRO_NONE) return RUBRO_NONE
  if (isKnownRubro(explicit)) return explicit
  return inferRubro(expense) || RUBRO_NONE
}

export function normalizeRubro(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const value = String(raw.rubro ?? raw.rubroId ?? '').trim()
  if (value === RUBRO_NONE) {
    raw.rubro = RUBRO_NONE
    return raw
  }
  if (isKnownRubro(value)) {
    raw.rubro = value
    if ('rubroId' in raw) delete raw.rubroId
    return raw
  }
  raw.rubro = inferRubro(raw) || ''
  if ('rubroId' in raw) delete raw.rubroId
  return raw
}

export function formatSharePct(part, whole) {
  if (!whole) return null
  const pct = (Math.abs(part) / Math.abs(whole)) * 100
  const rounded = Math.round(pct * 10) / 10
  return rounded
}

export function formatShareLabel(part, whole) {
  const pct = formatSharePct(part, whole)
  if (pct == null) return '—'
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`
}

function categoryName(month, categoryId) {
  const row = (month?.categories ?? []).find((category) => category.id === categoryId)
  return row?.name || categoryId || 'Sin categoría'
}

export function buildRubroBreakdown(month) {
  const rate = month?.exchangeRate
  const rateOk = isValidRate(rate)
  const catalog = [...RUBROS, NONE_META]
  const buckets = new Map()
  for (const rubro of catalog) {
    buckets.set(rubro.id, {
      id: rubro.id,
      name: rubro.name,
      color: rubro.color,
      usd: rateOk ? 0 : null,
      lines: [],
    })
  }

  for (const expense of month?.expenses ?? []) {
    const rubroId = resolveRubro(expense)
    const bucket = buckets.get(rubroId) ?? buckets.get(RUBRO_NONE)
    const usd = rateOk ? toUsdCents(expense.amount, expense.currency, rate) : null
    bucket.lines.push({
      id: expense.id,
      name: expense.name,
      categoryId: expense.categoryId,
      categoryName: categoryName(month, expense.categoryId),
      dueDay: expense.dueDay ?? null,
      amount: expense.amount,
      currency: expense.currency,
      usd,
    })
    if (rateOk && usd != null) bucket.usd += usd
  }

  const groups = [...buckets.values()]
    .filter((group) => group.lines.length > 0)
    .map((group) => {
      group.lines.sort((a, b) => {
        const ua = a.usd ?? -1
        const ub = b.usd ?? -1
        if (ub !== ua) return ub - ua
        return String(a.name).localeCompare(String(b.name), 'es')
      })
      return group
    })

  groups.sort((a, b) => {
    if (a.id === RUBRO_NONE) return 1
    if (b.id === RUBRO_NONE) return -1
    const ua = a.usd ?? -1
    const ub = b.usd ?? -1
    if (ub !== ua) return ub - ua
    return a.name.localeCompare(b.name, 'es')
  })

  const totalUsd = rateOk ? groups.reduce((sum, group) => sum + (group.usd ?? 0), 0) : null
  for (const group of groups) {
    group.pct = rateOk ? formatSharePct(group.usd ?? 0, totalUsd) : null
    group.pctLabel = rateOk ? formatShareLabel(group.usd ?? 0, totalUsd) : '—'
  }

  return {
    rateOk,
    rate,
    rateLabel: rateOk ? formatRate(rate) : '',
    totalUsd,
    groups,
    slices: rateOk ? groups.filter((group) => (group.usd ?? 0) > 0) : [],
  }
}

export function summarizeRubros(month) {
  const breakdown = buildRubroBreakdown(month)
  const items = breakdown.groups
    .filter((group) => group.id !== RUBRO_NONE)
    .map((group, index) => {
      const meta = rubroMeta(group.id)
      return {
        id: group.id,
        name: meta.name,
        label: meta.label,
        hint: meta.hint,
        color: meta.color,
        usd: group.usd ?? 0,
        pct: group.pct == null ? null : Math.round(group.pct),
        rank: index + 1,
        count: group.lines.length,
      }
    })
  return { items, totalUsd: breakdown.totalUsd, expensesUsd: breakdown.totalUsd, rateOk: breakdown.rateOk, ok: breakdown.rateOk }
}

export function rubroUsd(entry, rubroId) {
  if (!entry?.totals?.ok) return null
  const row = entry.rubros?.items?.find((item) => item.id === rubroId)
  return row ? (row.usd ?? 0) : 0
}
