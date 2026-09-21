import './style.css'
import { createOctoberSeed, SEEDED_MONTH, cloneMonth } from './seed.js'
import {
  cardSummary,
  createInitialState,
  detailsAreEmpty,
  emptyDetails,
  loadState,
  looksLikeCardName,
  normalizeDetails,
  saveState,
  storageAvailable,
} from './storage.js'
import {
  centsToInput,
  dollarsToCents,
  escapeHtml,
  formatCreateNextLabel,
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
import { analyticsHtml, MODE_CLASSIFICATION, MODE_TOTALS } from './analytics.js'

const bootEl = document.querySelector('#boot')
const fatalEl = document.querySelector('#fatal')
const fatalMessage = document.querySelector('#fatal-message')
const appEl = document.querySelector('#app')
const bannerEl = document.querySelector('#banner')
const incomeListEl = document.querySelector('#income-list')
const categoryGridEl = document.querySelector('#category-grid')
const formDialog = document.querySelector('#form-dialog')
const confirmDialog = document.querySelector('#confirm-dialog')
const itemForm = document.querySelector('#item-form')
const chargeForm = document.querySelector('#charge-form')
const detailsDialog = document.querySelector('#details-dialog')
const detailsForm = document.querySelector('#details-form')

const toastEl = document.querySelector('#toast')

let state = null
let persistEnabled = true
let persistWarning = ''
let formContext = null
let confirmContext = null
let toastTimer = 0
let currentView = 'budget'
let analyticsMode = MODE_TOTALS
let chargeEditId = null
let detailsExpenseId = null
const expandedSubgastoIds = new Set()

function currentMonth() {
  return state.months[state.currentMonth]
}

function persist() {
  if (!persistEnabled) {
    persistWarning = 'No se pudo guardar. Los cambios se perderán al cerrar esta pestaña.'
    renderBanner()
    return false
  }
  try {
    saveState(state)
    persistWarning = ''
    renderBanner()
    return true
  } catch (error) {
    persistWarning = 'No hay espacio para guardar en este navegador. Revisa el almacenamiento local.'
    renderBanner()
    console.error(error)
    return false
  }
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

function saveNow() {
  if (!persistEnabled) persistEnabled = storageAvailable()
  const ok = persist()
  if (ok) showToast('Guardado')
}

function monthAfterDelete(deletedKey) {
  const remaining = savedMonthKeys().filter((key) => key !== deletedKey)
  if (remaining.length === 0) return SEEDED_MONTH
  const previous = remaining.filter((key) => key < deletedKey).at(-1)
  const next = remaining.find((key) => key > deletedKey)
  return previous ?? next ?? SEEDED_MONTH
}

function deleteCurrentMonth() {
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

function renderCreateNext() {
  const button = document.querySelector('#create-next-month')
  const wrap = document.querySelector('#create-next-wrap')
  const tools = document.querySelector('#month-tools')
  const next = shiftMonth(state.currentMonth, 1)
  const exists = monthExists(next)
  button.textContent = formatCreateNextLabel(state.currentMonth)
  button.hidden = exists
  if (wrap) wrap.hidden = exists
  tools?.classList.toggle('has-cta', !exists)
  document.querySelector('#prev-month').disabled = !monthExists(shiftMonth(state.currentMonth, -1))
  document.querySelector('#next-month').disabled = !monthExists(next)
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
    renderCreateNext()
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
  renderCreateNext()
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
  return `
    <div class="row-actions">
      ${extra}
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
    <li class="ledger-sub-row">
      <span class="ledger-sub-name">${escapeHtml(charge.name)}</span>
      <span class="ledger-sub-amount">${formatMoney(charge.amount, charge.currency)}</span>
    </li>
  `
}

function ledgerRow(item, kind) {
  const badge = item.isCard ? '<span class="badge">Tarjeta</span>' : ''
  const detailsMark =
    kind === 'expense' && !detailsAreEmpty(item.details)
      ? '<span class="details-mark">Con detalles</span>'
      : ''
  const remaining = kind === 'expense' ? remainingMarkup(item) : ''
  const nameInner = `${escapeHtml(item.name)}${badge}${detailsMark}`
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
  const rowInner = `
      ${name}
      <span class="ledger-date">${escapeHtml(formatDueDay(item.dueDay, state.currentMonth))}</span>
      <span class="ledger-amount">${formatMoney(item.amount, item.currency)}${remaining}</span>
      ${toggleBtn}
      ${rowActions(kind, item.id, detailsBtn)}
  `

  if (kind !== 'expense' || !hasSubs) {
    return `<li class="ledger-row">${rowInner}</li>`
  }

  const nested = expanded
    ? `<ul class="ledger-sub" aria-label="Subgastos de ${escapeHtml(item.name)}">${charges
        .map((charge) => nestedChargeRow(charge))
        .join('')}</ul>`
    : ''

  return `
    <li class="ledger-group has-subs${expanded ? ' is-expanded' : ''}">
      <div class="ledger-row ledger-row-main">
        ${rowInner}
      </div>
      ${nested}
    </li>
  `
}

function renderIncomes() {
  const month = currentMonth()
  if (month.incomes.length === 0) {
    incomeListEl.innerHTML = `
      <div class="empty empty-block">
        <p>Todavía no hay ingresos en ${formatMonthTitle(state.currentMonth)}. Añade el salario u otro ingreso para calcular el balance.</p>
        <button type="button" class="btn btn-secondary" data-action="add-income">Añadir ingreso</button>
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
    categoryGridEl.innerHTML = `
      <div class="empty empty-block">
        <p>No hay categorías. Crea una para empezar a anotar gastos.</p>
        <button type="button" class="btn btn-secondary" data-action="add-category">Nueva categoría</button>
      </div>
    `
    return
  }

  const cards = month.categories.map((category, index) => {
    const expenses = month.expenses
      .filter((item) => item.categoryId === category.id)
      .sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99) || a.name.localeCompare(b.name, 'es'))
    const wide = month.categories.length % 2 === 1 && index === month.categories.length - 1
    const totalUsd = categoryTotalUsd(month, category.id)
    const totalLabel = totalUsd == null ? '—' : formatMoney(totalUsd, 'USD')
    const body =
      expenses.length === 0
        ? `<div class="empty empty-block">
            <p>No hay gastos en ${escapeHtml(category.name)}.</p>
            <button type="button" class="btn btn-ghost" data-action="add-expense" data-category="${category.id}">Añadir gasto</button>
          </div>`
        : `
          <ul class="ledger">
            ${expenses.map((item) => ledgerRow(item, 'expense')).join('')}
          </ul>
        `

    return `
      <article class="category-card${wide ? ' wide' : ''}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(category.name)}</h3>
            <strong class="category-total">${totalLabel}</strong>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-row" data-action="add-expense" data-category="${category.id}">Añadir gasto</button>
            <button type="button" class="btn btn-row" data-action="edit-category" data-id="${category.id}">Renombrar</button>
            <button type="button" class="btn btn-row" data-action="delete-category" data-id="${category.id}">Eliminar</button>
          </div>
        </div>
        ${body}
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
  el.innerHTML = analyticsHtml(state, { mode: analyticsMode, currentKey: state.currentMonth })
}

function render() {
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

function setFieldVisibility(names) {
  document.querySelectorAll('[data-field]').forEach((el) => {
    el.classList.toggle('hidden', !names.includes(el.dataset.field))
  })
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
    setFieldVisibility(['amount', 'category', 'dueDay', 'isCard'])
    fillCategorySelect(context.item?.categoryId ?? context.categoryId)
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
        month.categories.push({ id: newId('cat'), name })
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
            <div class="row-actions">
              <button type="button" class="btn btn-row" data-action="edit-charge" data-id="${charge.id}">Editar</button>
              <button type="button" class="btn btn-row" data-action="delete-charge" data-id="${charge.id}">Eliminar</button>
            </div>
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
  openConfirm({
    title: '¿Restaurar octubre 2026?',
    message:
      'Se volverá a cargar el presupuesto de octubre con ingreso de $4,800 y los gastos de la hoja. La tasa vuelve a 36.6 C$ por 1 USD, editable. Los demás meses no se tocan.',
    confirmLabel: 'Restaurar',
    onConfirm: () => {
      state.months[SEEDED_MONTH] = createOctoberSeed()
      state.currentMonth = SEEDED_MONTH
      persist()
      render()
    },
  })
}

function createNextMonth() {
  const fromKey = state.currentMonth
  const next = shiftMonth(fromKey, 1)
  const copy = () => {
    state.months[next] = cloneMonth(currentMonth())
    state.currentMonth = next
    persist()
    render()
  }

  if (monthExists(next)) {
    openConfirm({
      title: `¿Reemplazar ${formatMonthTitle(next)}?`,
      message: `Ya hay un presupuesto para ${formatMonthTitle(next)}. Se reemplazará con una copia exacta de ${formatMonthTitle(fromKey)}.`,
      confirmLabel: 'Reemplazar',
      onConfirm: copy,
    })
    return
  }

  copy()
}

function changeMonth(delta) {
  const next = shiftMonth(state.currentMonth, delta)
  if (!monthExists(next)) {
    if (delta > 0) {
      persistWarning = `Todavía no hay ${formatMonthTitle(next)}. Pulsa «${formatCreateNextLabel(state.currentMonth)}» para copiar este mes y personalizarlo.`
    } else {
      persistWarning = `No hay un presupuesto guardado para ${formatMonthTitle(next)}.`
    }
    renderBanner()
    return
  }
  goToMonth(next)
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
  } else if (action === 'add-category') {
    openForm({ type: 'category' })
  } else if (action === 'edit-category') {
    openForm({ type: 'category', item: month.categories.find((item) => item.id === id) })
  } else if (action === 'delete-category') {
    deleteCategory(id)
  } else if (action === 'open-month') {
    goToMonth(button.dataset.month)
  } else if (action === 'show-view') {
    setView(view)
  } else if (action === 'analytics-mode') {
    analyticsMode = button.dataset.mode === MODE_CLASSIFICATION ? MODE_CLASSIFICATION : MODE_TOTALS
    renderAnalytics()
  } else if (action === 'create-next-month') {
    createNextMonth()
  }
}

function showFatal(message) {
  bootEl.hidden = true
  appEl.hidden = true
  fatalEl.hidden = false
  fatalMessage.textContent = message
}

function showApp() {
  bootEl.hidden = true
  fatalEl.hidden = true
  appEl.hidden = false
  render()
}

function closeOnBackdrop(dialog) {
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })
}

function bindEvents() {
  document.querySelector('#prev-month').addEventListener('click', () => changeMonth(-1))
  document.querySelector('#next-month').addEventListener('click', () => changeMonth(1))
  document.querySelector('#create-next-month').addEventListener('click', createNextMonth)
  document.querySelector('#save-budget')?.addEventListener('click', saveNow)
  document.querySelector('#delete-month')?.addEventListener('click', deleteCurrentMonth)
  document.querySelector('#restore-october').addEventListener('click', restoreOctober)
  document.querySelector('#fatal-restore').addEventListener('click', () => {
    state = createInitialState()
    persistEnabled = storageAvailable()
    persist()
    showApp()
  })
  appEl.addEventListener('click', onAppClick)
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
  closeOnBackdrop(formDialog)
  closeOnBackdrop(confirmDialog)
  closeOnBackdrop(detailsDialog)
  document.querySelector('#confirm-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const action = confirmContext
    confirmDialog.close()
    if (action) action()
  })
}

function start() {
  bindEvents()
  persistEnabled = storageAvailable()
  if (!persistEnabled) {
    persistWarning = 'Este navegador no permite guardar datos locales. Puedes usar la app, pero se perderá al salir.'
    state = createInitialState()
    showApp()
    return
  }

  try {
    const loaded = loadState()
    state = loaded.state
    showApp()
  } catch (error) {
    showFatal(
      error instanceof Error
        ? error.message
        : 'No se pudieron leer los datos guardados en este navegador.',
    )
  }
}

start()
