import './style.css'
import { bindPasswordToggles } from './password-toggle.js'
import { createOctoberSeed, SEEDED_MONTH } from './seed.js'
import {
  applyCategoryLayout,
  cardSummary,
  cloneMonth,
  detailsAreEmpty,
  emptyDetails,
  LAYOUT_FULL,
  LAYOUT_HALF,
  looksLikeCardName,
  normalizeDetails,
  queueServerSave,
  reorderCategories,
  restoreOctoberMonth,
  restoreOctoberPreservingOthers,
  saveState,
  setHouseholdWritesEnabled,
  storageAvailable,
  flushServerSave,
  importStateFromText,
  loadHousehold,
} from './storage.js'
import {
  centsToInput,
  dollarsToCents,
  escapeHtml,
  formatCreateNextLabel,
  formatCreatePrevLabel,
  formatDueDay,
  formatMoney,
  formatMonthLabel,
  formatMonthTitle,
  newId,
  shiftMonth,
} from './format.js'
import {
  categoryTotalUsd,
  convertCents,
  formatRate,
  isValidRate,
  monthTotals,
  normalizeCurrency,
  parseRate,
} from './money.js'
import { analyticsHtml, MODE_CLASSIFICATION, MODE_RUBRO, MODE_TOTALS, parseAnalyticsMode } from './analytics.js'
import {
  inferRubro,
  isKnownRubro,
  RUBRO_NONE,
  RUBROS,
  resolveRubro,
  rubroMeta,
} from './rubros.js'
import {
  listOverduePayments,
  paymentStatusLabel,
} from './payment-status.js'

const bootEl = document.querySelector('#boot')
const fatalEl = document.querySelector('#fatal')
const fatalMessage = document.querySelector('#fatal-message')
const appEl = document.querySelector('#app')
const bannerEl = document.querySelector('#banner')
const incomeListEl = document.querySelector('#income-list')
const categoryGridEl = document.querySelector('#category-grid')
const formDialog = document.querySelector('#form-dialog')
const confirmDialog = document.querySelector('#confirm-dialog')
const overdueDialog = document.querySelector('#overdue-dialog')
const itemForm = document.querySelector('#item-form')
const chargeForm = document.querySelector('#charge-form')
const detailsDialog = document.querySelector('#details-dialog')
const detailsForm = document.querySelector('#details-form')
const moveDialog = document.querySelector('#move-dialog')

const toastEl = document.querySelector('#toast')
const dndLiveEl = document.querySelector('#dnd-live')

let state = null
let persistEnabled = true
let persistWarning = ''
let formContext = null
let confirmContext = null
let toastTimer = 0
let currentView = 'budget'
let analyticsMode = MODE_TOTALS
let compareFrom = null
let compareTo = null
let selectedRubroId = null
let chargeEditId = null
let detailsExpenseId = null
let moveExpenseId = null
let dragExpenseId = null
let dragCategoryId = null
let categoryDropPlace = null
let longPressTimer = 0
let longPressStart = null
let currentUser = null
let authRequired = false
let overdueAlertShown = false
const expandedSubgastoIds = new Set()
const DRAG_MIME = 'application/x-gastos-expense'
const CATEGORY_MIME = 'application/x-gastos-category'

function currentMonth() {
  return state.months[state.currentMonth]
}

function canEdit() {
  if (currentUser) return currentUser.role === 'admin'
  return !authRequired
}

async function readSession() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 404) {
      authRequired = false
      currentUser = null
      return
    }
    authRequired = true
    if (!res.ok) {
      currentUser = null
      return
    }
    const body = await res.json()
    currentUser = body.user || null
  } catch {
    authRequired = false
    currentUser = null
  }
}

function roleLabel(role) {
  return role === 'admin' ? 'Admin' : 'Solo lectura'
}

function photoSrc(user, bust = false) {
  const url = user?.photoUrl || '/lm-mark.jpg'
  return bust ? `${url}?t=${Date.now()}` : url
}

function applySessionChrome() {
  document.body.classList.toggle('is-readonly', !canEdit())
  document.body.classList.toggle('is-admin', canEdit())
  const name = currentUser?.name || ''
  const role = roleLabel(currentUser?.role)
  const src = photoSrc(currentUser)
  document.querySelectorAll('#account-photo, #account-dialog-photo').forEach((img) => {
    if (img) img.src = src
  })
  const chipName = document.querySelector('#account-name')
  const chipRole = document.querySelector('#account-role')
  if (chipName) chipName.textContent = name
  if (chipRole) chipRole.textContent = role
  const dialogName = document.querySelector('#account-dialog-name')
  const dialogMeta = document.querySelector('#account-dialog-meta')
  if (dialogName) dialogName.textContent = name
  if (dialogMeta) dialogMeta.textContent = `@${currentUser?.username || ''} · ${role}`
  const rate = document.querySelector('#field-rate')
  if (rate) {
    rate.readOnly = !canEdit()
    rate.disabled = !canEdit()
  }
  detailsForm?.querySelectorAll('input, textarea, select').forEach((el) => {
    if (el.type === 'checkbox' || el.tagName === 'SELECT') el.disabled = !canEdit()
    else el.readOnly = !canEdit()
  })
  document.querySelector('#charge-form')?.toggleAttribute('hidden', !canEdit())
  document.querySelector('#details-save')?.classList.toggle('hidden', !canEdit())
  document.querySelector('#profiles-panel')?.toggleAttribute('hidden', !canEdit())
  const saveNote = document.querySelector('#save-note')
  if (saveNote) {
    saveNote.textContent = canEdit()
      ? 'Los cambios se guardan en el servidor de esta app y también en este navegador. Una ventana nueva en la misma dirección verá lo último que guardaste.'
      : 'Estás viendo el presupuesto. Un perfil de solo lectura no puede añadir, editar, arrastrar ni guardar.'
  }
}

function persist(options) {
  let localOk = false
  try {
    saveState(state)
    localOk = true
    persistEnabled = true
  } catch (error) {
    persistEnabled = false
    console.error(error)
  }
  if (canEdit()) queueServerSave(state, options)
  persistWarning = localOk
    ? ''
    : canEdit()
      ? 'No se pudo guardar en este navegador. Se está escribiendo en el servidor de la app.'
      : 'Estás viendo el presupuesto. Los cambios no se guardan con un perfil de solo lectura.'
  renderBanner()
  return canEdit() && localOk
}

function showToast(message) {
  if (!toastEl) return
  toastEl.textContent = message
  toastEl.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true
    toastEl.textContent = ''
  }, 2200)
}

async function saveNow() {
  if (!canEdit()) return
  persist()
  try {
    await flushServerSave()
    showToast('Guardado')
  } catch (error) {
    console.error(error)
    persistWarning =
      'Guardado en este navegador, pero el servidor no respondió. Abre la misma dirección para no perder los cambios.'
    renderBanner()
    showToast('Guardado en este navegador')
  }
}

function monthAfterDelete(deletedKey) {
  const remaining = savedMonthKeys().filter((key) => key !== deletedKey)
  if (remaining.length === 0) return SEEDED_MONTH
  const previous = remaining.filter((key) => key < deletedKey).at(-1)
  const next = remaining.find((key) => key > deletedKey)
  return previous ?? next ?? SEEDED_MONTH
}

function deleteCurrentMonth() {
  if (!canEdit()) return
  const deleting = state.currentMonth
  const keys = savedMonthKeys()
  if (keys.length <= 1) {
    persistWarning =
      'No se puede eliminar el único mes. Debe quedar al menos un presupuesto en el hogar.'
    renderBanner()
    return
  }

  openConfirm({
    title: `¿Eliminar ${formatMonthTitle(deleting)}?`,
    message: `Se quitará el presupuesto de ${formatMonthTitle(deleting)}. Los demás meses se quedan.`,
    confirmLabel: 'Eliminar mes',
    onConfirm: () => {
      const target = monthAfterDelete(deleting)
      delete state.months[deleting]
      if (!state.months[target]) {
        state.months[SEEDED_MONTH] = createOctoberSeed()
        state.currentMonth = SEEDED_MONTH
      } else {
        state.currentMonth = target
      }
      persist()
      render()
    },
  })
}

function savedMonthKeys() {
  return Object.keys(state.months).sort()
}

function monthExists(monthKey) {
  return Boolean(state.months[monthKey])
}

function goToMonth(monthKey) {
  if (!monthExists(monthKey)) return
  persistWarning = persistEnabled ? '' : persistWarning
  expandedSubgastoIds.clear()
  state.currentMonth = monthKey
  persist()
  render()
}

function renderSavedMonths() {
  const nav = document.querySelector('#saved-months')
  nav.innerHTML = savedMonthKeys()
    .map((key) => {
      const current = key === state.currentMonth
      return `<button type="button" class="month-chip-btn${current ? ' is-current' : ''}" data-action="open-month" data-month="${key}" ${current ? 'aria-current="page"' : ''}>${escapeHtml(formatMonthLabel(key))}</button>`
    })
    .join('')
}

function renderCreateAdjacent() {
  const tools = document.querySelector('#month-tools')
  const next = shiftMonth(state.currentMonth, 1)
  const prev = shiftMonth(state.currentMonth, -1)
  const nextExists = monthExists(next)
  const prevExists = monthExists(prev)

  const nextButton = document.querySelector('#create-next-month')
  const nextWrap = document.querySelector('#create-next-wrap')
  if (nextButton) {
    nextButton.textContent = formatCreateNextLabel(state.currentMonth)
    nextButton.hidden = nextExists
  }
  if (nextWrap) nextWrap.hidden = nextExists

  const prevButton = document.querySelector('#create-prev-month')
  const prevWrap = document.querySelector('#create-prev-wrap')
  if (prevButton) {
    prevButton.textContent = formatCreatePrevLabel(state.currentMonth)
    prevButton.hidden = prevExists
  }
  if (prevWrap) prevWrap.hidden = prevExists

  const anyCta = !nextExists || !prevExists
  const row = document.querySelector('#create-adjacent-wrap')
  if (row) row.hidden = !anyCta
  tools?.classList.toggle('has-cta', anyCta)
  document.querySelector('#prev-month').disabled = !prevExists
  document.querySelector('#next-month').disabled = !nextExists
}

function renderBanner() {
  if (!persistWarning) {
    bannerEl.hidden = true
    bannerEl.textContent = ''
    bannerEl.removeAttribute('role')
    return
  }
  bannerEl.hidden = false
  bannerEl.textContent = persistWarning
  bannerEl.setAttribute('role', 'alert')
}

function rateErrorMessage(raw) {
  const text = String(raw ?? '').trim()
  if (!text) {
    return 'Indica la tasa de este mes (córdobas por 1 dólar). Sin una tasa mayor que 0 no se pueden sumar los totales.'
  }
  return 'La tasa tiene que ser un número mayor que 0. Por ejemplo 36.6. No puede ser 0.'
}

function renderFxField() {
  const input = document.querySelector('#field-rate')
  const errorEl = document.querySelector('#fx-error')
  if (!input) return
  const rate = currentMonth().exchangeRate
  const valid = isValidRate(rate)
  if (document.activeElement !== input) {
    input.value = valid ? formatRate(rate) : rate == null || rate === '' ? '' : String(rate)
  }
  input.setAttribute('aria-invalid', valid ? 'false' : 'true')
  if (errorEl) {
    errorEl.hidden = valid
    errorEl.textContent = valid ? '' : rateErrorMessage(input.value)
  }
}

function renderSummary() {
  const month = currentMonth()
  const totals = monthTotals(month)
  const netCard = document.querySelector('.stat-net')
  const statement = document.querySelector('.statement')
  const incomeEl = document.querySelector('#total-income')
  const expensesEl = document.querySelector('#total-expenses')
  const netEl = document.querySelector('#total-net')
  const incomeAlt = document.querySelector('#total-income-alt')
  const expensesAlt = document.querySelector('#total-expenses-alt')
  const netAlt = document.querySelector('#total-net-alt')
  const fxNote = document.querySelector('#fx-note')
  const note = document.querySelector('#net-note')

  document.querySelector('#month-title').textContent = formatMonthTitle(state.currentMonth)
  document.querySelector('#month-chip').textContent = formatMonthLabel(state.currentMonth)
  renderFxField()

  statement?.classList.toggle('is-fx-error', !totals.ok)

  if (!totals.ok) {
    incomeEl.textContent = '—'
    expensesEl.textContent = '—'
    netEl.textContent = '—'
    if (incomeAlt) incomeAlt.textContent = ''
    if (expensesAlt) expensesAlt.textContent = ''
    if (netAlt) netAlt.textContent = ''
    netCard.classList.remove('is-negative', 'is-positive')
    if (fxNote) {
      fxNote.textContent = rateErrorMessage(month.exchangeRate)
    }
    if (note) note.textContent = 'Corrige la tasa para ver el balance de este mes.'
    renderCreateAdjacent()
    renderSavedMonths()
    return
  }

  incomeEl.textContent = formatMoney(totals.incomeUsd, 'USD')
  expensesEl.textContent = formatMoney(totals.expensesUsd, 'USD')
  netEl.textContent = formatMoney(totals.netUsd, 'USD')
  if (incomeAlt) {
    incomeAlt.textContent = totals.incomeNio == null ? '' : formatMoney(totals.incomeNio, 'NIO')
  }
  if (expensesAlt) {
    expensesAlt.textContent = totals.expensesNio == null ? '' : formatMoney(totals.expensesNio, 'NIO')
  }
  if (netAlt) {
    netAlt.textContent = totals.netNio == null ? '' : formatMoney(totals.netNio, 'NIO')
  }
  netCard.classList.toggle('is-negative', totals.netUsd < 0)
  netCard.classList.toggle('is-positive', totals.netUsd > 0)
  if (fxNote) {
    fxNote.textContent = 'Totales en dólares, usando la tasa de este mes.'
  }
  renderCreateAdjacent()
  renderSavedMonths()
  if (totals.incomeUsd === 0 && totals.expensesUsd === 0) {
    note.textContent = 'Añade ingresos y gastos para ver el balance de este mes.'
  } else if (totals.netUsd < 0) {
    note.textContent = 'Este mes el hogar gasta más de lo que entra.'
  } else if (totals.netUsd === 0) {
    note.textContent = 'Ingresos y gastos quedan a mano.'
  } else {
    note.textContent = 'Queda un margen después de los gastos del mes.'
  }
}

function rowActions(kind, id, extra = '') {
  if (!canEdit()) {
    return extra ? `<div class="row-actions">${extra}</div>` : ''
  }
  const moveBtn =
    kind === 'expense'
      ? `<button type="button" class="btn btn-row btn-move" data-action="move-expense" data-id="${id}">Mover a…</button>`
      : ''
  return `
    <div class="row-actions">
      ${extra}
      ${moveBtn}
      <button type="button" class="btn btn-row" data-action="edit-${kind}" data-id="${id}">Editar</button>
      <button type="button" class="btn btn-row" data-action="delete-${kind}" data-id="${id}">Eliminar</button>
    </div>
  `
}

function remainingMarkup(item) {
  if (!item.charges?.length) return ''
  const summary = cardSummary(item, currentMonth().exchangeRate)
  if (!summary.ok) {
    return `<small class="ledger-remain is-over">Falta la tasa</small>`
  }
  if (summary.disponible < 0) {
    return `<small class="ledger-remain is-over">Se pasa ${formatMoney(Math.abs(summary.disponible), summary.currency)}</small>`
  }
  return `<small class="ledger-remain">Quedan ${formatMoney(summary.disponible, summary.currency)}</small>`
}

function nestedChargeRow(charge) {
  return `
    <li class="ledger-sub-row" draggable="false">
      <span class="ledger-sub-name">${escapeHtml(charge.name)}</span>
      <span class="ledger-sub-amount">${formatMoney(charge.amount, charge.currency)}</span>
    </li>
  `
}

function ledgerRow(item, kind) {
  const badge = item.isCard ? '<span class="badge">Tarjeta</span>' : ''
  const rubroId = kind === 'expense' ? resolveRubro(item) : ''
  const rubroMark =
    kind === 'expense' && rubroId && rubroId !== RUBRO_NONE
      ? `<span class="rubro-mark">${escapeHtml(rubroMeta(rubroId).name)}</span>`
      : ''
  const detailsMark =
    kind === 'expense' && !detailsAreEmpty(item.details)
      ? '<span class="details-mark">Con detalles</span>'
      : ''
  const remaining = kind === 'expense' ? remainingMarkup(item) : ''
  const nameInner = `${escapeHtml(item.name)}${badge}${rubroMark}${detailsMark}`
  const name =
    kind === 'expense'
      ? `<button type="button" class="ledger-name" data-action="open-details" data-id="${item.id}">${nameInner}</button>`
      : `<span class="ledger-name">${nameInner}</span>`
  const detailsBtn =
    kind === 'expense'
      ? `<button type="button" class="btn btn-row" data-action="open-details" data-id="${item.id}">Ver detalles</button>`
      : ''
  const charges = kind === 'expense' && Array.isArray(item.charges) ? item.charges : []
  const hasSubs = charges.length > 0
  if (!hasSubs) expandedSubgastoIds.delete(item.id)
  const expanded = hasSubs && expandedSubgastoIds.has(item.id)
  const toggleLabel = expanded ? 'Ocultar subgastos' : 'Mostrar subgastos'
  const toggleBtn = hasSubs
    ? `<button type="button" class="btn-add-sub" data-action="toggle-subgastos" data-id="${item.id}" aria-label="${toggleLabel} de ${escapeHtml(item.name)}" title="${toggleLabel}" aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? '−' : '+'}</button>`
    : ''
  const grip =
    kind === 'expense' && canEdit()
      ? `<span class="drag-grip" aria-hidden="true" title="Arrastra a otra categoría"></span>`
      : ''
  const rowInner = `
      ${grip}
      ${name}
      <span class="ledger-date">${escapeHtml(formatDueDay(item.dueDay, state.currentMonth))}</span>
      <span class="ledger-amount">${formatMoney(item.amount, item.currency)}${remaining}</span>
      ${toggleBtn}
      ${rowActions(kind, item.id, detailsBtn)}
  `
  const dragAttrs =
    kind === 'expense' && canEdit()
      ? ` draggable="true" data-expense-id="${item.id}" data-from-category="${item.categoryId}"`
      : ''

  if (kind !== 'expense' || !hasSubs) {
    return `<li class="ledger-row${kind === 'expense' ? ' ledger-drag has-grip' : ''}"${dragAttrs}>${rowInner}</li>`
  }

  const nested = expanded
    ? `<ul class="ledger-sub" aria-label="Subgastos de ${escapeHtml(item.name)}">${charges
        .map((charge) => nestedChargeRow(charge))
        .join('')}</ul>`
    : ''

  return `
    <li class="ledger-group has-subs${expanded ? ' is-expanded' : ''}">
      <div class="ledger-row ledger-row-main ledger-drag has-grip"${dragAttrs}>
        ${rowInner}
      </div>
      ${nested}
    </li>
  `
}

function renderIncomes() {
  const month = currentMonth()
  if (month.incomes.length === 0) {
    const addBtn = canEdit()
      ? `<button type="button" class="btn btn-secondary" data-action="add-income">Añadir ingreso</button>`
      : ''
    incomeListEl.innerHTML = `
      <div class="empty empty-block">
        <p>Todavía no hay ingresos en ${formatMonthTitle(state.currentMonth)}.${canEdit() ? ' Añade el salario u otro ingreso para calcular el balance.' : ''}</p>
        ${addBtn}
      </div>
    `
    return
  }

  const items = [...month.incomes].sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99) || a.name.localeCompare(b.name, 'es'))
  incomeListEl.innerHTML = `
    <ul class="ledger">
      ${items.map((item) => ledgerRow(item, 'income')).join('')}
    </ul>
  `
}

function renderCategories() {
  const month = currentMonth()
  if (month.categories.length === 0) {
    const addBtn = canEdit()
      ? `<button type="button" class="btn btn-secondary" data-action="add-category">Nueva categoría</button>`
      : ''
    categoryGridEl.innerHTML = `
      <div class="empty empty-block">
        <p>No hay categorías.${canEdit() ? ' Crea una para empezar a anotar gastos.' : ''}</p>
        ${addBtn}
      </div>
    `
    return
  }

  const cards = month.categories.map((category) => {
    const expenses = month.expenses
      .filter((item) => item.categoryId === category.id)
      .sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99) || a.name.localeCompare(b.name, 'es'))
    const layout = category.layout === LAYOUT_HALF ? LAYOUT_HALF : LAYOUT_FULL
    const isFull = layout === LAYOUT_FULL
    const totalUsd = categoryTotalUsd(month, category.id)
    const totalLabel = totalUsd == null ? '—' : formatMoney(totalUsd, 'USD')
    const body =
      expenses.length === 0
        ? `<div class="empty empty-block">
            <p>No hay gastos en ${escapeHtml(category.name)}.</p>
            ${
              canEdit()
                ? `<button type="button" class="btn btn-ghost" data-action="add-expense" data-category="${category.id}">Añadir gasto</button>`
                : ''
            }
          </div>`
        : `
          <ul class="ledger">
            ${expenses.map((item) => ledgerRow(item, 'expense')).join('')}
          </ul>
        `

    const tools = canEdit()
      ? `
          <div class="card-head-tools">
            <div class="layout-toggle" role="group" aria-label="Ancho de ${escapeHtml(category.name)}">
              <button
                type="button"
                class="btn btn-layout"
                data-action="set-layout"
                data-id="${category.id}"
                data-layout="${LAYOUT_HALF}"
                aria-pressed="${isFull ? 'false' : 'true'}"
              >Media fila</button>
              <button
                type="button"
                class="btn btn-layout"
                data-action="set-layout"
                data-id="${category.id}"
                data-layout="${LAYOUT_FULL}"
                aria-pressed="${isFull ? 'true' : 'false'}"
              >Fila completa</button>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-row" data-action="add-expense" data-category="${category.id}">Añadir gasto</button>
              <button type="button" class="btn btn-row" data-action="edit-category" data-id="${category.id}">Renombrar</button>
              <button type="button" class="btn btn-row" data-action="delete-category" data-id="${category.id}">Eliminar</button>
            </div>
          </div>`
      : ''

    return `
      <article class="category-card ${isFull ? 'wide is-full' : 'is-half'}" data-category-id="${category.id}" data-layout="${layout}">
        <div class="card-head">
          <div
            class="category-drag"
            ${canEdit() ? 'draggable="true"' : ''}
            data-category-id="${category.id}"
            ${canEdit() ? `title="Arrastra para reordenar" aria-label="Arrastrar ${escapeHtml(category.name)} para reordenar"` : ''}
          >
            ${canEdit() ? '<span class="category-handle" aria-hidden="true"></span>' : ''}
            <div>
              <h3>${escapeHtml(category.name)}</h3>
              <strong class="category-total">${totalLabel}</strong>
            </div>
          </div>
          ${tools}
        </div>
        ${body}
        <p class="drop-hint" hidden>Soltar aquí</p>
      </article>
    `
  })

  categoryGridEl.innerHTML = cards.join('')
}

function setView(view) {
  currentView = view === 'analytics' ? 'analytics' : 'budget'
  const budget = document.querySelector('.view-budget')
  const analytics = document.querySelector('#analytics')
  if (budget) budget.hidden = currentView !== 'budget'
  if (analytics) analytics.hidden = currentView !== 'analytics'
  renderViewTabs()
  if (currentView === 'analytics') renderAnalytics()
}

function renderViewTabs() {
  const tabs = document.querySelector('#view-tabs')
  if (!tabs) return
  tabs.hidden = false
  tabs.innerHTML = `
    <button type="button" class="view-tab${currentView === 'budget' ? ' is-current' : ''}" data-action="show-view" data-view="budget" ${currentView === 'budget' ? 'aria-current="page"' : ''}>Presupuesto</button>
    <button type="button" class="view-tab${currentView === 'analytics' ? ' is-current' : ''}" data-action="show-view" data-view="analytics" ${currentView === 'analytics' ? 'aria-current="page"' : ''}>Analítica</button>
  `
}

function renderAnalytics() {
  const el = document.querySelector('#analytics')
  if (!el) return
  const active = document.activeElement
  const restoreRubro =
    el.contains(active) && active?.dataset?.action === 'select-rubro' ? active.dataset.rubro : null
  const restoreKind = restoreRubro ? active.dataset.kind : null
  el.innerHTML = analyticsHtml(state, {
    mode: analyticsMode,
    currentKey: state.currentMonth,
    selectedRubroId,
    compareFrom,
    compareTo,
  })
  if (restoreRubro) {
    const next = el.querySelector(
      `[data-action="select-rubro"][data-rubro="${restoreRubro}"][data-kind="${restoreKind ?? 'legend'}"]`,
    )
    next?.focus()
  }
}

function selectRubro(rubroId) {
  selectedRubroId = rubroId || null
  renderAnalytics()
}

function render() {
  applySessionChrome()
  renderBanner()
  renderSummary()
  renderIncomes()
  renderCategories()
  renderViewTabs()
  const budget = document.querySelector('.view-budget')
  const analytics = document.querySelector('#analytics')
  if (budget) budget.hidden = currentView !== 'budget'
  if (analytics) analytics.hidden = currentView !== 'analytics'
  if (currentView === 'analytics') renderAnalytics()
  if (detailsDialog?.open && detailsExpenseId) renderCardDialog()
}

function overdueLineHtml(line) {
  const status = paymentStatusLabel(line.paymentStatus)
  const parent =
    line.kind === 'charge' && line.parentName
      ? `<span class="overdue-parent">en ${escapeHtml(line.parentName)}</span>`
      : ''
  const openBtn = canEdit()
    ? `<button type="button" class="btn btn-row" data-action="open-overdue" data-id="${escapeHtml(line.expenseId)}">Ver gasto</button>`
    : ''
  return `
    <li class="overdue-item">
      <div class="overdue-copy">
        <strong>${escapeHtml(line.name)}</strong>
        ${parent}
        <span class="overdue-meta">${escapeHtml(line.categoryName)} · ${escapeHtml(line.dueLabel)} · ${escapeHtml(status)}</span>
      </div>
      <div class="overdue-side">
        <span class="overdue-amount">${formatMoney(line.amount, line.currency)}</span>
        ${openBtn}
      </div>
    </li>
  `
}

function fillOverdueDialog(lines) {
  const monthTitle = formatMonthTitle(state.currentMonth)
  const lede = document.querySelector('#overdue-lede')
  if (lede) {
    const count = lines.length
    const verb =
      count === 1
        ? 'ya pasó su fecha y sigue sin pagar o solo se pagó en parte'
        : 'ya pasaron su fecha y siguen sin pagar o solo se pagaron en parte'
    lede.textContent = `${count} ${noun} de ${monthTitle} ${verb}.`
  }
  const list = document.querySelector('#overdue-list')
  if (list) list.innerHTML = lines.map(overdueLineHtml).join('')
}

function maybeShowOverdueAlert() {
  if (overdueAlertShown || !overdueDialog || !state) return
  const lines = listOverduePayments(currentMonth(), state.currentMonth)
  if (!lines.length) return
  overdueAlertShown = true
  fillOverdueDialog(lines)
  if (!overdueDialog.open) overdueDialog.showModal()
  document.querySelector('#overdue-ok')?.focus()
}

function openOverdueLine(expenseId) {
  overdueDialog?.close()
  if (!expenseId) return
  setView('budget')
  openDetails(expenseId)
}

function setFieldVisibility(names) {
  document.querySelectorAll('[data-field]').forEach((el) => {
    el.classList.toggle('hidden', !names.includes(el.dataset.field))
  })
}

function fillRubroSelect(selectedId) {
  const select = document.querySelector('#field-rubro')
  if (!select) return
  const current = selectedId === RUBRO_NONE || isKnownRubro(selectedId) ? selectedId : ''
  select.innerHTML = [
    '<option value="">Según el nombre</option>',
    ...RUBROS.map(
      (rubro) =>
        `<option value="${escapeHtml(rubro.id)}" ${rubro.id === current ? 'selected' : ''}>${escapeHtml(
          rubro.name,
        )}</option>`,
    ),
    `<option value="${RUBRO_NONE}" ${current === RUBRO_NONE ? 'selected' : ''}>Sin rubro</option>`,
  ].join('')
}

function readRubro(name) {
  const selected = document.querySelector('#field-rubro')?.value ?? ''
  if (selected === RUBRO_NONE) return RUBRO_NONE
  if (isKnownRubro(selected)) return selected
  return inferRubro({ name }) || ''
}

function syncRubroHint() {
  const hint = document.querySelector('#rubro-hint')
  if (!hint) return
  const selected = document.querySelector('#field-rubro')?.value ?? ''
  const name = document.querySelector('#field-name')?.value ?? ''
  if (selected === RUBRO_NONE) {
    hint.textContent = 'Esta partida no entra en el ranking de rubros hasta que le asignes un tipo.'
    return
  }
  if (isKnownRubro(selected)) {
    hint.textContent = rubroMeta(selected).hint
    return
  }
  const inferred = inferRubro({ name })
  if (inferred) {
    const meta = rubroMeta(inferred)
    hint.textContent = `Según el nombre: ${meta.name}. ${meta.hint}`
    return
  }
  hint.textContent = 'Tipo de gasto entre las dos casas: vivienda, camionetas, comida, crédito…'
}

function fillCategorySelect(selectedId) {
  const select = document.querySelector('#field-category')
  const month = currentMonth()
  select.innerHTML = month.categories
    .map(
      (category) =>
        `<option value="${escapeHtml(category.id)}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`,
    )
    .join('')
}

function syncAmountLabel() {
  const currency = document.querySelector('#field-currency')?.value
  const label = document.querySelector('#amount-label')
  if (!label) return
  label.textContent = currency === 'NIO' ? 'Monto en córdobas' : 'Monto en dólares'
}

function syncChargeAmountLabel() {
  const currency = document.querySelector('#charge-currency')?.value
  const label = document.querySelector('#charge-amount-label')
  if (!label) return
  label.textContent = currency === 'NIO' ? 'Monto en córdobas' : 'Monto en dólares'
}

function showFormError(message) {
  const errorEl = document.querySelector('#form-error')
  const nameInput = document.querySelector('#field-name')
  const amountInput = document.querySelector('#field-amount')
  if (!message) {
    errorEl.hidden = true
    errorEl.textContent = ''
    nameInput?.removeAttribute('aria-invalid')
    amountInput?.removeAttribute('aria-invalid')
    return
  }
  errorEl.hidden = false
  errorEl.textContent = message
  const invalidAmount = /monto/i.test(message)
  nameInput?.setAttribute('aria-invalid', invalidAmount ? 'false' : 'true')
  amountInput?.setAttribute('aria-invalid', invalidAmount ? 'true' : 'false')
  ;(invalidAmount ? amountInput : nameInput)?.focus()
}

function openForm(context) {
  if (!canEdit()) return
  formContext = context
  const title = document.querySelector('#form-title')
  const nameInput = document.querySelector('#field-name')
  const amountInput = document.querySelector('#field-amount')
  const dueInput = document.querySelector('#field-due')
  const currencySelect = document.querySelector('#field-currency')
  const cardCheck = document.querySelector('#field-is-card')
  const openDetailsBtn = document.querySelector('#form-open-details')
  showFormError('')
  openDetailsBtn?.classList.toggle('hidden', !(context.type === 'expense' && context.item))

  if (context.type === 'income') {
    title.textContent = context.item ? 'Editar ingreso' : 'Añadir ingreso'
    setFieldVisibility(['amount', 'dueDay'])
    nameInput.value = context.item?.name ?? ''
    amountInput.value = context.item ? centsToInput(context.item.amount) : ''
    dueInput.value = context.item?.dueDay ?? ''
    if (currencySelect) currencySelect.value = normalizeCurrency(context.item?.currency)
  } else if (context.type === 'expense') {
    title.textContent = context.item ? 'Editar gasto' : 'Añadir gasto'
    setFieldVisibility(['amount', 'category', 'rubro', 'dueDay', 'isCard'])
    fillCategorySelect(context.item?.categoryId ?? context.categoryId)
    fillRubroSelect(context.item?.rubro)
    nameInput.value = context.item?.name ?? ''
    amountInput.value = context.item ? centsToInput(context.item.amount) : ''
    dueInput.value = context.item?.dueDay ?? ''
    if (currencySelect) currencySelect.value = normalizeCurrency(context.item?.currency)
    if (cardCheck) {
      cardCheck.checked = context.item
        ? Boolean(context.item.isCard)
        : looksLikeCardName(context.item?.name)
    }
  } else {
    title.textContent = context.item ? 'Renombrar categoría' : 'Nueva categoría'
    setFieldVisibility([])
    nameInput.value = context.item?.name ?? ''
  }

  syncAmountLabel()
  syncRubroHint()
  if (!formDialog.open) formDialog.showModal()
  nameInput.focus()
}

function parseDueDay(value) {
  const trimmed = String(value).trim()
  if (!trimmed) return null
  const day = Number(trimmed)
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('El día debe ser un número entre 1 y 31.')
  }
  return day
}

function parseAmount(value) {
  const cents = dollarsToCents(value)
  if (cents === null) {
    throw new Error('Escribe un monto válido, por ejemplo 172 o 70.84.')
  }
  if (cents < 0) {
    throw new Error('El monto no puede ser negativo.')
  }
  return cents
}

function parseOptionalAmount(value) {
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return parseAmount(trimmed)
}

function detailsFields() {
  return {
    account: document.querySelector('#detail-account'),
    monthlyUsd: document.querySelector('#detail-monthly-usd'),
    monthlyNio: document.querySelector('#detail-monthly-nio'),
    expectedUsd: document.querySelector('#detail-expected-usd'),
    expectedNio: document.querySelector('#detail-expected-nio'),
    notes: document.querySelector('#detail-notes'),
    empty: document.querySelector('#details-empty'),
    error: document.querySelector('#details-error'),
    success: document.querySelector('#details-success'),
    suggestMonthly: document.querySelector('#suggest-monthly'),
    suggestExpected: document.querySelector('#suggest-expected'),
  }
}

function formHasDetailInput(fields) {
  return Boolean(
    fields.account?.value.trim() ||
      fields.monthlyUsd?.value.trim() ||
      fields.monthlyNio?.value.trim() ||
      fields.expectedUsd?.value.trim() ||
      fields.expectedNio?.value.trim() ||
      fields.notes?.value.trim(),
  )
}

function showDetailsError(message) {
  const { error, success } = detailsFields()
  if (!error) return
  error.hidden = !message
  error.textContent = message || ''
  if (message && success) success.hidden = true
}

function showDetailsSuccess(visible) {
  const { success } = detailsFields()
  if (!success) return
  success.hidden = !visible
}

function pairSuggestion(usdInput, nioInput) {
  const rate = currentMonth()?.exchangeRate
  if (!isValidRate(rate) || !usdInput || !nioInput) return null
  const usdText = usdInput.value.trim()
  const nioText = nioInput.value.trim()
  if (usdText && !nioText) {
    const usd = dollarsToCents(usdText)
    if (usd == null || usd < 0) return null
    const cents = convertCents(usd, 'USD', 'NIO', rate)
    if (cents == null) return null
    return { target: nioInput, cents, label: `Sugerir ${formatMoney(cents, 'NIO')}` }
  }
  if (nioText && !usdText) {
    const nio = dollarsToCents(nioText)
    if (nio == null || nio < 0) return null
    const cents = convertCents(nio, 'NIO', 'USD', rate)
    if (cents == null) return null
    return { target: usdInput, cents, label: `Sugerir ${formatMoney(cents, 'USD')}` }
  }
  return null
}

function updateSuggestButton(button, suggestion) {
  if (!button) return
  button.hidden = !suggestion
  button.textContent = suggestion?.label ?? ''
}

function updateSuggestButtons() {
  const fields = detailsFields()
  updateSuggestButton(fields.suggestMonthly, pairSuggestion(fields.monthlyUsd, fields.monthlyNio))
  updateSuggestButton(fields.suggestExpected, pairSuggestion(fields.expectedUsd, fields.expectedNio))
  if (fields.empty) fields.empty.hidden = formHasDetailInput(fields)
}

function applySuggestion(pair) {
  const fields = detailsFields()
  const suggestion =
    pair === 'monthly'
      ? pairSuggestion(fields.monthlyUsd, fields.monthlyNio)
      : pairSuggestion(fields.expectedUsd, fields.expectedNio)
  if (!suggestion || suggestion.target.value.trim()) return
  suggestion.target.value = centsToInput(suggestion.cents)
  showDetailsSuccess(false)
  updateSuggestButtons()
}

function fillDetailsForm(item) {
  const fields = detailsFields()
  const details = normalizeDetails(item.details)
  if (fields.account) fields.account.value = details.accountNumber
  if (fields.monthlyUsd) fields.monthlyUsd.value = centsToInput(details.monthlyUsd)
  if (fields.monthlyNio) fields.monthlyNio.value = centsToInput(details.monthlyNio)
  if (fields.expectedUsd) fields.expectedUsd.value = centsToInput(details.expectedUsd)
  if (fields.expectedNio) fields.expectedNio.value = centsToInput(details.expectedNio)
  if (fields.notes) fields.notes.value = details.notes
  const title = document.querySelector('#details-title')
  const mainAmount = document.querySelector('#details-main-amount')
  if (title) title.textContent = item.name
  if (mainAmount) mainAmount.textContent = formatMoney(item.amount, item.currency)
  showDetailsError('')
  showDetailsSuccess(false)
  updateSuggestButtons()
}

function openDetails(id) {
  const item = currentMonth().expenses.find((entry) => entry.id === id)
  if (!item || !detailsDialog) return
  detailsExpenseId = id
  fillDetailsForm(item)
  resetChargeForm(item)
  renderCardDialog()
  if (!detailsDialog.open) detailsDialog.showModal()
  detailsFields().account?.focus()
}

function onDetailsInput() {
  showDetailsSuccess(false)
  showDetailsError('')
  updateSuggestButtons()
}

function onSubmitDetails(event) {
  event.preventDefault()
  if (!canEdit()) return
  const month = currentMonth()
  const item = month.expenses.find((entry) => entry.id === detailsExpenseId)
  if (!item) return
  const fields = detailsFields()
  let details
  try {
    details = normalizeDetails({
      accountNumber: fields.account?.value ?? '',
      monthlyUsd: parseOptionalAmount(fields.monthlyUsd?.value ?? ''),
      monthlyNio: parseOptionalAmount(fields.monthlyNio?.value ?? ''),
      expectedUsd: parseOptionalAmount(fields.expectedUsd?.value ?? ''),
      expectedNio: parseOptionalAmount(fields.expectedNio?.value ?? ''),
      notes: fields.notes?.value ?? '',
    })
  } catch (error) {
    showDetailsError(error.message)
    return
  }
  item.details = details
  if (!persist()) {
    showDetailsError('No se pudieron guardar los detalles en este navegador.')
    return
  }
  showDetailsError('')
  showDetailsSuccess(true)
  showToast('Detalles guardados')
  updateSuggestButtons()
  render()
}

function readCurrency(selectId) {
  return normalizeCurrency(document.querySelector(selectId)?.value)
}

function onSubmitForm(event) {
  event.preventDefault()
  if (!canEdit()) return
  const month = currentMonth()
  const name = document.querySelector('#field-name').value.trim()
  if (!name) {
    showFormError('Escribe un nombre.')
    return
  }

  try {
    if (formContext.type === 'income') {
      const next = {
        ...(formContext.item ?? {}),
        id: formContext.item?.id ?? newId('inc'),
        name,
        amount: parseAmount(document.querySelector('#field-amount').value),
        dueDay: parseDueDay(document.querySelector('#field-due').value),
        currency: readCurrency('#field-currency'),
      }
      if (formContext.item) {
        month.incomes = month.incomes.map((item) => (item.id === next.id ? next : item))
      } else {
        month.incomes.push(next)
      }
    } else if (formContext.type === 'expense') {
      if (month.categories.length === 0) {
        showFormError('Crea una categoría antes de añadir un gasto.')
        return
      }
      const categoryId = document.querySelector('#field-category').value
      if (!month.categories.some((category) => category.id === categoryId)) {
        showFormError('Elige una categoría.')
        return
      }
      const isCard = Boolean(document.querySelector('#field-is-card')?.checked)
      const next = {
        ...(formContext.item ?? {}),
        id: formContext.item?.id ?? newId('exp'),
        name,
        amount: parseAmount(document.querySelector('#field-amount').value),
        categoryId,
        dueDay: parseDueDay(document.querySelector('#field-due').value),
        currency: readCurrency('#field-currency'),
        isCard,
        rubro: readRubro(name),
        charges: formContext.item?.charges ?? [],
        details: formContext.item?.details ?? emptyDetails(),
      }
      if (formContext.item) {
        month.expenses = month.expenses.map((item) => (item.id === next.id ? next : item))
      } else {
        month.expenses.push(next)
      }
    } else {
      if (formContext.item) {
        month.categories = month.categories.map((item) =>
          item.id === formContext.item.id ? { ...item, name } : item,
        )
      } else {
        month.categories.push({ id: newId('cat'), name, layout: LAYOUT_FULL })
      }
    }
  } catch (error) {
    showFormError(error.message)
    return
  }

  persist()
  formDialog.close()
  render()
}

function openConfirm({ title, message, confirmLabel = 'Eliminar', onConfirm }) {
  confirmContext = onConfirm
  document.querySelector('#confirm-title').textContent = title
  document.querySelector('#confirm-message').textContent = message
  document.querySelector('#confirm-ok').textContent = confirmLabel
  if (!confirmDialog.open) confirmDialog.showModal()
  document.querySelector('#confirm-cancel')?.focus()
}

function deleteIncome(id) {
  const item = currentMonth().incomes.find((entry) => entry.id === id)
  if (!item) return
  openConfirm({
    title: '¿Eliminar este ingreso?',
    message: `Se quitará «${item.name}» de ${formatMonthTitle(state.currentMonth)}.`,
    onConfirm: () => {
      currentMonth().incomes = currentMonth().incomes.filter((entry) => entry.id !== id)
      persist()
      render()
    },
  })
}

function deleteExpense(id) {
  const item = currentMonth().expenses.find((entry) => entry.id === id)
  if (!item) return
  openConfirm({
    title: '¿Eliminar este gasto?',
    message: `Se quitará «${item.name}» y el total del mes se recalculará.`,
    onConfirm: () => {
      currentMonth().expenses = currentMonth().expenses.filter((entry) => entry.id !== id)
      if (detailsExpenseId === id) detailsDialog?.close()
      expandedSubgastoIds.delete(id)
      persist()
      render()
    },
  })
}

function deleteCategory(id) {
  const month = currentMonth()
  const category = month.categories.find((entry) => entry.id === id)
  if (!category) return
  const count = month.expenses.filter((item) => item.categoryId === id).length
  const extra =
    count === 0
      ? 'No tiene gastos.'
      : count === 1
        ? 'También se eliminará 1 gasto de esta categoría.'
        : `También se eliminarán ${count} gastos de esta categoría.`
  openConfirm({
    title: '¿Eliminar esta categoría?',
    message: `Se quitará «${category.name}». ${extra}`,
    onConfirm: () => {
      month.categories = month.categories.filter((entry) => entry.id !== id)
      month.expenses = month.expenses.filter((item) => item.categoryId !== id)
      persist()
      render()
    },
  })
}

function currentCardExpense() {
  return currentMonth().expenses.find((item) => item.id === detailsExpenseId)
}

function resetChargeForm(expense) {
  chargeEditId = null
  const title = document.querySelector('#charge-form-title')
  const save = document.querySelector('#charge-save')
  if (title) title.textContent = 'Añadir subgasto'
  if (save) save.textContent = 'Añadir subgasto'
  document.querySelector('#charge-cancel-edit')?.classList.add('hidden')
  const nameInput = document.querySelector('#charge-name')
  const amountInput = document.querySelector('#charge-amount')
  if (nameInput) nameInput.value = ''
  if (amountInput) amountInput.value = ''
  const currencySelect = document.querySelector('#charge-currency')
  if (currencySelect) currencySelect.value = normalizeCurrency(expense?.currency)
  const errorEl = document.querySelector('#charge-error')
  if (errorEl) {
    errorEl.hidden = true
    errorEl.textContent = ''
  }
  syncChargeAmountLabel()
}

function renderCardDialog() {
  const expense = currentCardExpense()
  const pagoEl = document.querySelector('#card-pago')
  if (!expense || !pagoEl) return
  const summary = cardSummary(expense, currentMonth().exchangeRate)
  const title = document.querySelector('#card-title')
  if (title) title.textContent = expense.name
  pagoEl.textContent = formatMoney(summary.pago, summary.currency)
  document.querySelector('#card-cargado').textContent = summary.ok
    ? formatMoney(summary.cargado, summary.currency)
    : '—'
  const restLabel = document.querySelector('#card-rest-label')
  const restEl = document.querySelector('#card-rest')
  const restNote = document.querySelector('#card-rest-note')
  const restStat = document.querySelector('#card-rest-stat')
  restStat?.classList.toggle('is-negative', Boolean(summary.ok && summary.disponible < 0))
  if (!summary.ok) {
    if (restLabel) restLabel.textContent = 'Quedan'
    if (restEl) restEl.textContent = '—'
    if (restNote) {
      restNote.textContent =
        'Falta una tasa válida para pasar subgastos de otra moneda al monto de esta partida.'
    }
  } else if (summary.disponible < 0) {
    if (restLabel) restLabel.textContent = 'Se pasa'
    if (restEl) restEl.textContent = formatMoney(Math.abs(summary.disponible), summary.currency)
    if (restNote) restNote.textContent = 'Los subgastos superan el monto de esta partida. El total del mes no cambia.'
  } else {
    if (restLabel) restLabel.textContent = 'Quedan'
    if (restEl) restEl.textContent = formatMoney(summary.disponible, summary.currency)
    if (restNote) {
      restNote.textContent = 'Queda saldo en la moneda de esta partida, usando la tasa del mes si hace falta.'
    }
  }

  const list = document.querySelector('#charge-list')
  if (!list) return
  if (!expense.charges.length) {
    list.innerHTML = `<div class="empty">Todavía no hay subgastos en esta partida. No se suman otra vez al mes; solo descuentan de esta línea.</div>`
  } else {
    list.innerHTML = `
      <ul class="ledger">
        ${expense.charges
          .map(
            (charge) => `
          <li class="ledger-row">
            <span class="ledger-name">${escapeHtml(charge.name)}</span>
            <span class="ledger-date">${escapeHtml(
              normalizeCurrency(charge.currency) === normalizeCurrency(expense.currency)
                ? charge.currency === 'NIO'
                  ? 'Córdobas'
                  : 'Dólares'
                : (() => {
                    const converted = convertCents(
                      charge.amount,
                      charge.currency,
                      expense.currency,
                      currentMonth().exchangeRate,
                    )
                    return converted == null ? 'Sin tasa' : `≈ ${formatMoney(converted, expense.currency)}`
                  })(),
            )}</span>
            <span class="ledger-amount">${formatMoney(charge.amount, charge.currency)}</span>
            ${
              canEdit()
                ? `<div class="row-actions">
              <button type="button" class="btn btn-row" data-action="edit-charge" data-id="${charge.id}">Editar</button>
              <button type="button" class="btn btn-row" data-action="delete-charge" data-id="${charge.id}">Eliminar</button>
            </div>`
                : ''
            }
          </li>
        `,
          )
          .join('')}
      </ul>
    `
  }
}

function renderSubgastos() {
  renderCardDialog()
}

function openCard(id) {
  openDetails(id)
}

function showChargeError(message) {
  const errorEl = document.querySelector('#charge-error')
  if (!errorEl) return
  errorEl.hidden = !message
  errorEl.textContent = message || ''
}

function toggleSubgastos(id) {
  const item = currentMonth().expenses.find((entry) => entry.id === id)
  if (!item?.charges?.length) return
  if (expandedSubgastoIds.has(id)) expandedSubgastoIds.delete(id)
  else expandedSubgastoIds.add(id)
  render()
}

function onSubmitCharge(event) {
  event.preventDefault()
  if (!canEdit()) return
  const expense = currentCardExpense()
  if (!expense) return
  if (!Array.isArray(expense.charges)) expense.charges = []
  const name = document.querySelector('#charge-name').value.trim()
  if (!name) {
    showChargeError('Escribe un nombre.')
    return
  }
  let amount
  try {
    amount = parseAmount(document.querySelector('#charge-amount').value)
  } catch (error) {
    showChargeError(error.message)
    return
  }
  const charge = {
    ...(chargeEditId ? expense.charges.find((item) => item.id === chargeEditId) || {} : {}),
    id: chargeEditId ?? newId('chg'),
    name,
    amount,
    currency: readCurrency('#charge-currency'),
  }
  if (chargeEditId) {
    expense.charges = expense.charges.map((item) => (item.id === charge.id ? charge : item))
  } else {
    expense.charges.push(charge)
  }
  persist()
  resetChargeForm(expense)
  renderCardDialog()
  render()
}

function startChargeEdit(id) {
  const expense = currentCardExpense()
  const charge = expense?.charges.find((item) => item.id === id)
  if (!charge) return
  chargeEditId = id
  document.querySelector('#charge-form-title').textContent = 'Editar subgasto'
  document.querySelector('#charge-save').textContent = 'Guardar subgasto'
  document.querySelector('#charge-cancel-edit')?.classList.remove('hidden')
  document.querySelector('#charge-name').value = charge.name
  document.querySelector('#charge-amount').value = centsToInput(charge.amount)
  const currencySelect = document.querySelector('#charge-currency')
  if (currencySelect) currencySelect.value = normalizeCurrency(charge.currency)
  showChargeError('')
  syncChargeAmountLabel()
  document.querySelector('#charge-name').focus()
}

function deleteCharge(id) {
  const expense = currentCardExpense()
  if (!expense) return
  expense.charges = expense.charges.filter((item) => item.id !== id)
  if (chargeEditId === id) resetChargeForm(expense)
  persist()
  renderCardDialog()
  render()
}

function onCardClick(event) {
  const button = event.target.closest('[data-action]')
  if (!button) return
  const { action, id } = button.dataset
  if (action === 'edit-charge') startChargeEdit(id)
  if (action === 'delete-charge') deleteCharge(id)
}

function applyExchangeRate(raw) {
  if (!canEdit()) return
  const month = currentMonth()
  const parsed = parseRate(raw)
  month.exchangeRate = parsed ?? (String(raw).trim() === '' ? null : raw)
  persist()
  renderSummary()
  renderCategories()
  if (currentView === 'analytics') renderAnalytics()
  if (detailsDialog?.open) {
    updateSuggestButtons()
    renderCardDialog()
  }
}

function restoreOctober() {
  if (!canEdit()) return
  openConfirm({
    title: '¿Restaurar octubre 2026?',
    message:
      'Se volverá a cargar el presupuesto de octubre con ingreso de $4,800 y los gastos de la hoja. La tasa vuelve a 36.6 C$ por 1 USD, editable. Los demás meses no se tocan.',
    confirmLabel: 'Restaurar',
    onConfirm: () => {
      restoreOctoberMonth(state)
      persist()
      render()
    },
  })
}

function downloadBackup() {
  if (!state) return
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `gastos-hogar-${state.currentMonth}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  showToast('Copia descargada')
}

function restoreFromFile() {
  if (!canEdit()) return
  document.querySelector('#restore-file-input')?.click()
}

async function onRestoreFileChange(event) {
  if (!canEdit()) return
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  let next
  try {
    next = importStateFromText(await file.text())
  } catch (error) {
    persistWarning = error instanceof Error ? error.message : 'No se pudo leer el archivo.'
    renderBanner()
    return
  }
  openConfirm({
    title: '¿Restaurar desde archivo?',
    message: `Se reemplazará el presupuesto actual por «${file.name}». Los meses, gastos y subgastos del archivo pasan al servidor. Restaurar octubre no se ejecuta solo.`,
    confirmLabel: 'Restaurar',
    onConfirm: () => {
      state = next
      persist({ allMonths: true })
      flushServerSave().catch((error) => console.error(error))
      render()
      showToast('Presupuesto restaurado')
    },
  })
}

function createAdjacentMonth(delta) {
  if (!canEdit()) return
  const fromKey = state.currentMonth
  const source = state.months[fromKey]
  const target = shiftMonth(fromKey, delta)
  const copy = () => {
    const origin = state.months[fromKey] || source
    if (!origin) return
    state.months[target] = cloneMonth(origin)
    state.currentMonth = target
    persist()
    render()
  }

  if (monthExists(target)) {
    openConfirm({
      title: `¿Reemplazar ${formatMonthTitle(target)}?`,
      message: `Ya hay un presupuesto para ${formatMonthTitle(target)}. Se reemplazará con una copia exacta de ${formatMonthTitle(fromKey)}.`,
      confirmLabel: 'Reemplazar',
      onConfirm: copy,
    })
    return
  }

  copy()
}

function createNextMonth() {
  createAdjacentMonth(1)
}

function createPrevMonth() {
  createAdjacentMonth(-1)
}

function changeMonth(delta) {
  const next = shiftMonth(state.currentMonth, delta)
  if (!monthExists(next)) {
    const label =
      delta > 0
        ? formatCreateNextLabel(state.currentMonth)
        : formatCreatePrevLabel(state.currentMonth)
    persistWarning = `Todavía no hay ${formatMonthTitle(next)}. Pulsa «${label}» para copiar este mes y personalizarlo.`
    renderBanner()
    return
  }
  goToMonth(next)
}

function announceDnd(message) {
  if (!dndLiveEl) return
  dndLiveEl.textContent = message
}

function draggedExpense() {
  if (!dragExpenseId) return null
  return currentMonth().expenses.find((entry) => entry.id === dragExpenseId) ?? null
}

function draggedCategory() {
  if (!dragCategoryId) return null
  return currentMonth().categories.find((entry) => entry.id === dragCategoryId) ?? null
}

function isCategoryDrag(event) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return Boolean(dragCategoryId) || types.includes(CATEGORY_MIME)
}

function isExpenseDrag(event) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return Boolean(dragExpenseId) || types.includes(DRAG_MIME)
}

function gridColumnCount() {
  const value = getComputedStyle(categoryGridEl).gridTemplateColumns
  return value.split(/\s+/).filter(Boolean).length
}

function dropPlacement(card, clientX, clientY) {
  const rect = card.getBoundingClientRect()
  if (gridColumnCount() < 2) {
    return clientY > rect.top + rect.height / 2 ? 'after' : 'before'
  }
  return clientX > rect.left + rect.width / 2 ? 'after' : 'before'
}

function placementHint(place, source, target) {
  if (
    source?.layout === LAYOUT_HALF &&
    target?.layout === LAYOUT_HALF &&
    source.id !== target.id
  ) {
    return place === 'after' ? 'Juntar a la derecha' : 'Juntar a la izquierda'
  }
  return place === 'after' ? 'Soltar después' : 'Soltar antes'
}

function clearDropTargets() {
  categoryGridEl?.querySelectorAll('.category-card').forEach((card) => {
    card.classList.remove(
      'is-drop-target',
      'is-drop-invalid',
      'is-drop-before',
      'is-drop-after',
    )
    const hint = card.querySelector('.drop-hint')
    if (hint) {
      hint.hidden = true
      hint.textContent = 'Soltar aquí'
    }
  })
  categoryDropPlace = null
}

function restoreRowDraggable() {
  categoryGridEl?.querySelectorAll('.ledger-drag').forEach((row) => {
    row.setAttribute('draggable', 'true')
  })
}

function restoreCategoryDraggable() {
  categoryGridEl?.querySelectorAll('.category-drag').forEach((handle) => {
    handle.setAttribute('draggable', 'true')
  })
}

function endExpenseDrag() {
  dragExpenseId = null
  categoryGridEl?.classList.remove('is-reclassifying')
  categoryGridEl?.querySelectorAll('.ledger-drag.is-dragging').forEach((row) => {
    row.classList.remove('is-dragging')
  })
}

function endCategoryDrag() {
  dragCategoryId = null
  categoryDropPlace = null
  categoryGridEl?.classList.remove('is-reordering')
  categoryGridEl?.querySelectorAll('.category-card.is-dragging, .category-drag.is-dragging').forEach((el) => {
    el.classList.remove('is-dragging')
  })
}

function endDrag() {
  endExpenseDrag()
  endCategoryDrag()
  clearDropTargets()
  restoreRowDraggable()
  restoreCategoryDraggable()
}

function setDropTarget(card, valid) {
  if (!card) {
    clearDropTargets()
    return
  }
  categoryGridEl.querySelectorAll('.category-card').forEach((other) => {
    if (other === card) return
    other.classList.remove('is-drop-target', 'is-drop-invalid', 'is-drop-before', 'is-drop-after')
    const otherHint = other.querySelector('.drop-hint')
    if (otherHint) otherHint.hidden = true
  })
  card.classList.add('is-drop-target')
  card.classList.toggle('is-drop-invalid', !valid)
  card.classList.remove('is-drop-before', 'is-drop-after')
  const hint = card.querySelector('.drop-hint')
  if (hint) {
    hint.textContent = valid ? 'Soltar aquí' : 'Ya está en esta categoría'
    hint.hidden = false
  }
}

function setReorderTarget(card, place, source, target) {
  if (!card) {
    clearDropTargets()
    return
  }
  categoryGridEl.querySelectorAll('.category-card').forEach((other) => {
    if (other === card) return
    other.classList.remove('is-drop-target', 'is-drop-invalid', 'is-drop-before', 'is-drop-after')
    const otherHint = other.querySelector('.drop-hint')
    if (otherHint) otherHint.hidden = true
  })
  categoryDropPlace = place
  card.classList.add('is-drop-target')
  card.classList.toggle('is-drop-before', place === 'before')
  card.classList.toggle('is-drop-after', place === 'after')
  card.classList.remove('is-drop-invalid')
  const hint = card.querySelector('.drop-hint')
  if (hint) {
    hint.textContent = placementHint(place, source, target)
    hint.hidden = false
  }
}

function setCategoryLayout(id, layout) {
  const month = currentMonth()
  const category = applyCategoryLayout(month, id, layout)
  if (!category) return
  persist()
  render()
  showToast(category.layout === LAYOUT_HALF ? `${category.name}: media fila` : `${category.name}: fila completa`)
}

function reorderCategory(sourceId, targetId, place) {
  const month = currentMonth()
  if (!reorderCategories(month, sourceId, targetId, place)) return false
  persist()
  render()
  showToast('Orden de categorías actualizado')
  announceDnd(`Categorías: ${month.categories.map((entry) => entry.name).join(', ')}.`)
  return true
}

function moveExpenseToCategory(expenseId, categoryId) {
  const month = currentMonth()
  const item = month.expenses.find((entry) => entry.id === expenseId)
  const category = month.categories.find((entry) => entry.id === categoryId)
  if (!item || !category) return false
  if (item.categoryId === categoryId) return false
  item.categoryId = categoryId
  persist()
  render()
  showToast(`«${item.name}» se movió a ${category.name}.`)
  announceDnd(`«${item.name}» ahora está en ${category.name}. El total del mes no cambia.`)
  return true
}

function openMovePicker(id) {
  const month = currentMonth()
  const item = month.expenses.find((entry) => entry.id === id)
  if (!item || !moveDialog) return
  moveExpenseId = id
  const message = document.querySelector('#move-message')
  if (message) {
    message.textContent = `¿A qué categoría mueves «${item.name}»? El total del mes no cambia; los subgastos viajan con la partida.`
  }
  const targets = document.querySelector('#move-targets')
  const others = month.categories.filter((category) => category.id !== item.categoryId)
  if (targets) {
    if (others.length === 0) {
      targets.innerHTML = `<div class="empty">No hay otra categoría a la que mover este gasto.</div>`
    } else {
      targets.innerHTML = others
        .map(
          (category) =>
            `<button type="button" class="btn btn-secondary move-target" data-action="confirm-move" data-category="${category.id}">${escapeHtml(category.name)}</button>`,
        )
        .join('')
    }
  }
  if (!moveDialog.open) moveDialog.showModal()
}

function cancelLongPress() {
  window.clearTimeout(longPressTimer)
  longPressTimer = 0
  longPressStart = null
}

function onExpensePointerDown(event) {
  const row = event.target.closest('.ledger-drag')
  if (!row || !categoryGridEl.contains(row)) return
  if (event.target.closest('.row-actions, .btn-add-sub, .btn-move, a, input, select, textarea')) {
    row.setAttribute('draggable', 'false')
    cancelLongPress()
    return
  }
  row.setAttribute('draggable', 'true')
  const pointerType = event.pointerType || (event.touches ? 'touch' : 'mouse')
  if (pointerType === 'touch' || pointerType === 'pen') {
    const point = event.touches?.[0] ?? event
    longPressStart = { id: row.dataset.expenseId, x: point.clientX, y: point.clientY }
    longPressTimer = window.setTimeout(() => {
      const expenseId = longPressStart?.id
      cancelLongPress()
      if (expenseId) openMovePicker(expenseId)
    }, 520)
  }
}

function onExpensePointerMove(event) {
  if (!longPressStart) return
  const point = event.touches?.[0] ?? event
  const dx = point.clientX - longPressStart.x
  const dy = point.clientY - longPressStart.y
  if (dx * dx + dy * dy > 100) cancelLongPress()
}

function onGridPointerDown(event) {
  const card = event.target.closest('.category-card')
  const handle = card?.querySelector('.category-drag')
  if (handle) {
    const onControls = Boolean(
      event.target.closest('.row-actions, .layout-toggle, .btn, .ledger-drag, .ledger, a, input, select, textarea'),
    )
    handle.setAttribute('draggable', onControls ? 'false' : 'true')
  }
  onExpensePointerDown(event)
}

function onExpenseDragStart(event) {
  const row = event.target.closest('.ledger-drag')
  if (
    !row ||
    row.getAttribute('draggable') === 'false' ||
    event.target.closest('.row-actions, .btn-add-sub, .btn-move')
  ) {
    event.preventDefault()
    return
  }
  const id = row.dataset.expenseId
  const item = currentMonth().expenses.find((entry) => entry.id === id)
  if (!item) {
    event.preventDefault()
    return
  }
  cancelLongPress()
  dragExpenseId = id
  try {
    event.dataTransfer.setData(DRAG_MIME, id)
    event.dataTransfer.setData('text/plain', id)
  } catch {
    // Some browsers only allow text/plain.
  }
  event.dataTransfer.effectAllowed = 'move'
  row.classList.add('is-dragging')
  categoryGridEl.classList.add('is-reclassifying')
  announceDnd(`Arrastrando «${item.name}». Suelta en otra categoría para reclasificarla.`)
}

function onCategoryReorderStart(event) {
  const handle = event.target.closest('.category-drag')
  if (!handle || handle.getAttribute('draggable') === 'false') {
    event.preventDefault()
    return
  }
  const id = handle.dataset.categoryId
  const category = currentMonth().categories.find((entry) => entry.id === id)
  if (!category) {
    event.preventDefault()
    return
  }
  cancelLongPress()
  dragCategoryId = id
  try {
    event.dataTransfer.setData(CATEGORY_MIME, id)
    event.dataTransfer.setData('text/plain', id)
  } catch {
    // Some browsers only allow text/plain.
  }
  event.dataTransfer.effectAllowed = 'move'
  handle.classList.add('is-dragging')
  handle.closest('.category-card')?.classList.add('is-dragging')
  categoryGridEl.classList.add('is-reordering')
  const card = handle.closest('.category-card')
  if (card && event.dataTransfer.setDragImage) {
    try {
      event.dataTransfer.setDragImage(card, 28, 28)
    } catch {
      // Keep the default drag image.
    }
  }
  announceDnd(`Arrastrando «${category.name}». Suelta junto a otra categoría para reordenar.`)
}

function onGridDragStart(event) {
  if (!canEdit()) {
    event.preventDefault()
    return
  }
  if (event.target.closest('.category-drag') && !event.target.closest('.ledger-drag')) {
    onCategoryReorderStart(event)
    return
  }
  onExpenseDragStart(event)
}

function onGridDragEnd() {
  endDrag()
}

function onCategoryReorderOver(event) {
  const card = event.target.closest?.('.category-card')
  if (!card || !categoryGridEl.contains(card)) {
    clearDropTargets()
    return
  }
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const source = draggedCategory()
  const target = currentMonth().categories.find((entry) => entry.id === card.dataset.categoryId)
  const place = dropPlacement(card, event.clientX, event.clientY)
  setReorderTarget(card, place, source, target)
}

function onCategoryDragOver(event) {
  const types = Array.from(event.dataTransfer?.types ?? [])
  const draggingExpense = Boolean(dragExpenseId) || types.includes(DRAG_MIME)
  if (!draggingExpense) return
  const card = event.target.closest?.('.category-card')
  if (!card || !categoryGridEl.contains(card)) {
    clearDropTargets()
    return
  }
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const item = draggedExpense()
  const valid = Boolean(item && item.categoryId !== card.dataset.categoryId)
  setDropTarget(card, valid)
}

function onGridDragOver(event) {
  if (dragExpenseId || (isExpenseDrag(event) && !dragCategoryId)) {
    onCategoryDragOver(event)
    return
  }
  if (dragCategoryId || isCategoryDrag(event)) {
    onCategoryReorderOver(event)
  }
}

function onCategoryReorderDrop(event) {
  const card = event.target.closest?.('.category-card')
  if (!card || !categoryGridEl.contains(card)) return
  event.preventDefault()
  const sourceId =
    dragCategoryId ||
    event.dataTransfer?.getData(CATEGORY_MIME) ||
    event.dataTransfer?.getData('text/plain')
  const targetId = card.dataset.categoryId
  const place = categoryDropPlace || dropPlacement(card, event.clientX, event.clientY)
  endDrag()
  if (!sourceId || !targetId) return
  reorderCategory(sourceId, targetId, place)
}

function onCategoryDrop(event) {
  const card = event.target.closest?.('.category-card')
  if (!card || !categoryGridEl.contains(card)) return
  event.preventDefault()
  const expenseId =
    dragExpenseId ||
    event.dataTransfer?.getData(DRAG_MIME) ||
    event.dataTransfer?.getData('text/plain')
  const categoryId = card.dataset.categoryId
  endDrag()
  if (!expenseId || !categoryId) return
  moveExpenseToCategory(expenseId, categoryId)
}

function onGridDrop(event) {
  if (dragCategoryId && !dragExpenseId) {
    onCategoryReorderDrop(event)
    return
  }
  if (dragExpenseId) {
    onCategoryDrop(event)
    return
  }
  const types = Array.from(event.dataTransfer?.types ?? [])
  if (types.includes(CATEGORY_MIME)) {
    onCategoryReorderDrop(event)
    return
  }
  onCategoryDrop(event)
}

function onMoveDialogClick(event) {
  const button = event.target.closest('[data-action]')
  if (!button) return
  if (button.dataset.action === 'confirm-move') {
    const expenseId = moveExpenseId
    const categoryId = button.dataset.category
    moveDialog.close()
    moveExpenseId = null
    if (expenseId && categoryId) moveExpenseToCategory(expenseId, categoryId)
  }
}

function onAppClick(event) {
  const button = event.target.closest('[data-action]')
  if (!button) return
  const { action, id, category, view } = button.dataset
  const month = currentMonth()

  if (action === 'add-income') {
    openForm({ type: 'income' })
  } else if (action === 'edit-income') {
    openForm({ type: 'income', item: month.incomes.find((item) => item.id === id) })
  } else if (action === 'delete-income') {
    deleteIncome(id)
  } else if (action === 'add-expense') {
    if (month.categories.length === 0) {
      persistWarning = 'Crea una categoría antes de añadir un gasto.'
      renderBanner()
      return
    }
    persistWarning = persistEnabled ? '' : persistWarning
    renderBanner()
    openForm({ type: 'expense', categoryId: category })
  } else if (action === 'edit-expense') {
    openForm({ type: 'expense', item: month.expenses.find((item) => item.id === id) })
  } else if (action === 'delete-expense') {
    deleteExpense(id)
  } else if (action === 'open-card' || action === 'open-details' || action === 'details-expense') {
    openDetails(id)
  } else if (action === 'toggle-subgastos') {
    toggleSubgastos(id)
  } else if (action === 'move-expense') {
    openMovePicker(id)
  } else if (action === 'add-category') {
    openForm({ type: 'category' })
  } else if (action === 'edit-category') {
    openForm({ type: 'category', item: month.categories.find((item) => item.id === id) })
  } else if (action === 'delete-category') {
    deleteCategory(id)
  } else if (action === 'set-layout') {
    setCategoryLayout(id, button.dataset.layout)
  } else if (action === 'open-month') {
    goToMonth(button.dataset.month)
  } else if (action === 'show-view') {
    setView(view)
  } else if (action === 'analytics-mode') {
    analyticsMode = parseAnalyticsMode(button.dataset.mode)
    renderAnalytics()
  } else if (action === 'select-rubro') {
    selectRubro(button.dataset.rubro)
  } else if (action === 'create-next-month') {
    createNextMonth()
  } else if (action === 'create-prev-month') {
    createPrevMonth()
  } else if (action === 'open-overdue') {
    openOverdueLine(id)
  }
}

function showFatal(message) {
  if (bootEl) bootEl.hidden = true
  if (appEl) appEl.hidden = true
  if (fatalEl) fatalEl.hidden = false
  if (fatalMessage) fatalMessage.textContent = message
}

const BOOT_HOLD_MS = 5000

function revealApp() {
  bootEl.hidden = true
  fatalEl.hidden = true
  appEl.hidden = false
  render()
  maybeShowOverdueAlert()
}

function showApp() {
  try {
    if (bootEl && !bootEl.hidden) {
      window.setTimeout(() => {
        try {
          revealApp()
        } catch (error) {
          console.error(error)
          showFatal(
            error instanceof Error
              ? error.message
              : 'No se pudo mostrar el presupuesto en este navegador.',
          )
        }
      }, BOOT_HOLD_MS)
      return
    }
    revealApp()
  } catch (error) {
    console.error(error)
    showFatal(
      error instanceof Error
        ? error.message
        : 'No se pudo mostrar el presupuesto en este navegador.',
    )
  }
}

function closeOnBackdrop(dialog) {
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
}

async function fetchMe() {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error('No se pudo comprobar la sesión.')
  const body = await res.json()
  return body.user || null
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // Still send Melissa back to login.
  }
  window.location.replace('/login')
}

async function refreshProfiles() {
  const list = document.querySelector('#profiles-list')
  if (!list || !canEdit()) return
  const res = await fetch('/api/users', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) return
  const body = await res.json()
  const users = body.users || []
  list.innerHTML = users
    .map(
      (user) => `
      <article class="profile-row">
        <img src="${escapeHtml(user.photoUrl)}" alt="" width="40" height="40" />
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <small>@${escapeHtml(user.username)} · ${escapeHtml(roleLabel(user.role))}</small>
        </div>
      </article>
    `,
    )
    .join('')
  const form = document.querySelector('#create-profile-form')
  if (form) form.hidden = users.length >= (body.max || 3)
  const cap = document.querySelector('#profiles-cap')
  if (cap) cap.textContent = `${users.length} de ${body.max || 3} perfiles`
}

async function openAccountDialog() {
  applySessionChrome()
  await refreshProfiles()
  document.querySelector('#account-dialog')?.showModal()
}

async function onCreateProfile(event) {
  event.preventDefault()
  if (!canEdit()) return
  const form = event.currentTarget
  const errorEl = document.querySelector('#profile-error')
  const data = new FormData(form)
  if (errorEl) {
    errorEl.hidden = true
    errorEl.textContent = ''
  }
  const res = await fetch('/api/users', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.get('name'),
      username: data.get('username'),
      password: data.get('password'),
      role: data.get('role'),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (errorEl) {
      errorEl.hidden = false
      errorEl.textContent = body.error || 'No se pudo crear el perfil.'
    }
    return
  }
  form.reset()
  showToast('Perfil creado')
  await refreshProfiles()
}

async function onChangePhoto(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const res = await fetch('/api/me/photo', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    showToast(body.error || 'No se pudo cambiar la foto')
    return
  }
  currentUser = body.user
  applySessionChrome()
  document.querySelectorAll('#account-photo, #account-dialog-photo').forEach((img) => {
    if (img) img.src = photoSrc(currentUser, true)
  })
  showToast('Foto actualizada')
}

function bindEvents() {
  bindPasswordToggles()
  document.querySelector('#prev-month').addEventListener('click', () => changeMonth(-1))
  document.querySelector('#next-month').addEventListener('click', () => changeMonth(1))
  document.querySelector('#create-next-month').addEventListener('click', createNextMonth)
  document.querySelector('#create-prev-month')?.addEventListener('click', createPrevMonth)
  document.querySelector('#save-budget')?.addEventListener('click', saveNow)
  document.querySelector('#delete-month')?.addEventListener('click', deleteCurrentMonth)
  document.querySelector('#restore-october').addEventListener('click', restoreOctober)
  document.querySelector('#download-backup')?.addEventListener('click', downloadBackup)
  document.querySelector('#restore-file')?.addEventListener('click', restoreFromFile)
  document.querySelector('#restore-file-input')?.addEventListener('change', onRestoreFileChange)
  document.querySelector('#account-open')?.addEventListener('click', () => {
    openAccountDialog().catch((error) => console.error(error))
  })
  document.querySelector('#account-close')?.addEventListener('click', () => {
    document.querySelector('#account-dialog')?.close()
  })
  document.querySelectorAll('#logout-btn, #header-logout').forEach((btn) => {
    btn.addEventListener('click', () => {
      logout().catch((error) => console.error(error))
    })
  })
  document.querySelector('#create-profile-form')?.addEventListener('submit', (event) => {
    onCreateProfile(event).catch((error) => console.error(error))
  })
  document.querySelector('#account-photo-input')?.addEventListener('change', (event) => {
    onChangePhoto(event).catch((error) => console.error(error))
  })
  document.querySelector('#fatal-restore').addEventListener('click', () => {
    if (!canEdit()) return
    state = restoreOctoberPreservingOthers()
    persistEnabled = storageAvailable()
    persist()
    showApp()
  })
  appEl.addEventListener('click', onAppClick)
  appEl.addEventListener('change', (event) => {
    const select = event.target.closest?.('select[data-action]')
    if (!select) return
    if (select.dataset.action === 'compare-from') {
      compareFrom = select.value
      renderAnalytics()
    } else if (select.dataset.action === 'compare-to') {
      compareTo = select.value
      renderAnalytics()
    }
  })
  appEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target.closest('[data-action="select-rubro"]')
    if (!target || target.tagName === 'BUTTON') return
    event.preventDefault()
    selectRubro(target.dataset.rubro)
  })
  categoryGridEl.addEventListener('dragstart', onGridDragStart)
  categoryGridEl.addEventListener('dragend', onGridDragEnd)
  categoryGridEl.addEventListener('dragover', onGridDragOver)
  categoryGridEl.addEventListener('dragleave', (event) => {
    if (!categoryGridEl.contains(event.relatedTarget)) clearDropTargets()
  })
  categoryGridEl.addEventListener('drop', onGridDrop)
  categoryGridEl.addEventListener('pointerdown', onGridPointerDown)
  categoryGridEl.addEventListener('pointermove', onExpensePointerMove)
  categoryGridEl.addEventListener('pointerup', () => {
    cancelLongPress()
    restoreRowDraggable()
    restoreCategoryDraggable()
  })
  categoryGridEl.addEventListener('pointercancel', () => {
    cancelLongPress()
    restoreRowDraggable()
    restoreCategoryDraggable()
  })
  itemForm.addEventListener('submit', onSubmitForm)
  document.querySelector('#form-cancel').addEventListener('click', () => formDialog.close())
  document.querySelector('#form-close')?.addEventListener('click', () => formDialog.close())
  document.querySelector('#confirm-cancel').addEventListener('click', () => confirmDialog.close())
  document.querySelector('#confirm-close')?.addEventListener('click', () => confirmDialog.close())
  detailsDialog?.addEventListener('click', onCardClick)
  chargeForm?.addEventListener('submit', onSubmitCharge)
  document.querySelector('#charge-cancel-edit')?.addEventListener('click', () => {
    resetChargeForm(currentCardExpense())
  })
  document.querySelector('#field-currency')?.addEventListener('change', syncAmountLabel)
  document.querySelector('#field-rubro')?.addEventListener('change', syncRubroHint)
  document.querySelector('#field-name')?.addEventListener('input', () => {
    if (formContext?.type === 'expense') syncRubroHint()
  })
  document.querySelector('#charge-currency')?.addEventListener('change', syncChargeAmountLabel)
  const rateInput = document.querySelector('#field-rate')
  rateInput?.addEventListener('input', (event) => applyExchangeRate(event.target.value))
  rateInput?.addEventListener('change', (event) => applyExchangeRate(event.target.value))
  rateInput?.addEventListener('blur', (event) => applyExchangeRate(event.target.value))
  document.querySelector('#form-open-details')?.addEventListener('click', () => {
    const id = formContext?.type === 'expense' ? formContext.item?.id : null
    if (!id) return
    formDialog.close()
    openDetails(id)
  })
  detailsForm?.addEventListener('submit', onSubmitDetails)
  detailsForm?.addEventListener('input', onDetailsInput)
  document.querySelector('#details-cancel')?.addEventListener('click', () => detailsDialog?.close())
  document.querySelector('#details-close')?.addEventListener('click', () => detailsDialog?.close())
  document.querySelector('#suggest-monthly')?.addEventListener('click', () => applySuggestion('monthly'))
  document.querySelector('#suggest-expected')?.addEventListener('click', () => applySuggestion('expected'))
  moveDialog?.addEventListener('click', onMoveDialogClick)
  document.querySelector('#move-cancel')?.addEventListener('click', () => moveDialog?.close())
  document.querySelector('#move-close')?.addEventListener('click', () => moveDialog?.close())
  overdueDialog?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="open-overdue"]')
    if (!button) return
    event.preventDefault()
    openOverdueLine(button.dataset.id)
  })
  document.querySelector('#overdue-form')?.addEventListener('submit', () => {
    overdueDialog?.close()
  })
  closeOnBackdrop(formDialog)
  closeOnBackdrop(confirmDialog)
  closeOnBackdrop(detailsDialog)
  closeOnBackdrop(moveDialog)
  closeOnBackdrop(document.querySelector('#account-dialog'))
  document.querySelector('#confirm-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const action = confirmContext
    confirmDialog.close()
    if (action) action()
  })
}

async function start() {
  try {
    bindEvents()
    persistEnabled = storageAvailable()
    await readSession()
    if (authRequired && !currentUser) {
      window.location.replace('/login')
      return
    }
    setHouseholdWritesEnabled(canEdit())
    applySessionChrome()
    const loaded = await loadHousehold()
    state = loaded.state
    if (!persistEnabled) {
      persistWarning = loaded.fromServer
        ? 'Este navegador no guarda una copia local. Los cambios se escriben en el servidor de la app.'
        : 'Este navegador no permite guardar datos locales. Se intentará usar el servidor de la app.'
    } else if (authRequired && !canEdit()) {
      persistWarning = 'Estás viendo el presupuesto. Los cambios no se guardan con un perfil de solo lectura.'
    }
    showApp()
  } catch (error) {
    console.error(error)
    showFatal(
      error instanceof Error
        ? error.message
        : 'No se pudieron leer los datos guardados.',
    )
  }
}

start()
