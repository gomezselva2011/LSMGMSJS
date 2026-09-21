import './style.css'
import { createOctoberSeed, SEEDED_MONTH, cloneMonth } from './seed.js'
import {
  createInitialState,
  loadState,
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

let state = null
let persistEnabled = true
let persistWarning = ''
let formContext = null
let confirmContext = null

function currentMonth() {
  return state.months[state.currentMonth]
}

function totals(month) {
  const income = month.incomes.reduce((sum, item) => sum + item.amount, 0)
  const expenses = month.expenses.reduce((sum, item) => sum + item.amount, 0)
  return { income, expenses, net: income - expenses }
}

function persist() {
  if (!persistEnabled) {
    persistWarning = 'No se pudo guardar. Los cambios se perderán al cerrar esta pestaña.'
    renderBanner()
    return
  }
  try {
    saveState(state)
    persistWarning = ''
    renderBanner()
  } catch (error) {
    persistWarning = 'No hay espacio para guardar en este navegador. Revisa el almacenamiento local.'
    renderBanner()
    console.error(error)
  }
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
  const next = shiftMonth(state.currentMonth, 1)
  button.textContent = formatCreateNextLabel(state.currentMonth)
  button.hidden = monthExists(next)
  document.querySelector('#prev-month').disabled = !monthExists(shiftMonth(state.currentMonth, -1))
  document.querySelector('#next-month').disabled = !monthExists(next)
}

function renderBanner() {
  if (!persistWarning) {
    bannerEl.hidden = true
    bannerEl.textContent = ''
    return
  }
  bannerEl.hidden = false
  bannerEl.textContent = persistWarning
}

function renderSummary() {
  const month = currentMonth()
  const { income, expenses, net } = totals(month)
  const netCard = document.querySelector('.stat-net')
  document.querySelector('#month-title').textContent = formatMonthTitle(state.currentMonth)
  document.querySelector('#month-chip').textContent = formatMonthLabel(state.currentMonth)
  document.querySelector('#total-income').textContent = formatMoney(income)
  document.querySelector('#total-expenses').textContent = formatMoney(expenses)
  document.querySelector('#total-net').textContent = formatMoney(net)
  netCard.classList.toggle('is-negative', net < 0)
  netCard.classList.toggle('is-positive', net > 0)
  renderCreateNext()
  renderSavedMonths()
  const note = document.querySelector('#net-note')
  if (income === 0 && expenses === 0) {
    note.textContent = 'Añade ingresos y gastos para ver el balance de este mes.'
  } else if (net < 0) {
    note.textContent = 'Este mes el hogar gasta más de lo que entra.'
  } else if (net === 0) {
    note.textContent = 'Ingresos y gastos quedan a mano.'
  } else {
    note.textContent = 'Queda un margen después de los gastos del mes.'
  }
}

function rowActions(kind, id) {
  return `
    <div class="row-actions">
      <button type="button" class="btn btn-tiny" data-action="edit-${kind}" data-id="${id}">Editar</button>
      <button type="button" class="btn btn-tiny" data-action="delete-${kind}" data-id="${id}">Eliminar</button>
    </div>
  `
}

function renderIncomes() {
  const month = currentMonth()
  if (month.incomes.length === 0) {
    incomeListEl.innerHTML = `
      <p class="empty">Todavía no hay ingresos en ${formatMonthTitle(state.currentMonth)}. Añade el salario u otro ingreso para calcular el balance.</p>
    `
    return
  }

  const items = [...month.incomes].sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99) || a.name.localeCompare(b.name, 'es'))
  incomeListEl.innerHTML = `
    <ul class="ledger">
      ${items
        .map(
          (item) => `
            <li>
              <div class="name">
                ${escapeHtml(item.name)}
                <span class="meta">${escapeHtml(formatDueDay(item.dueDay, state.currentMonth))}</span>
              </div>
              <div class="amount">${formatMoney(item.amount)}</div>
              ${rowActions('income', item.id)}
            </li>
          `,
        )
        .join('')}
    </ul>
  `
}

function categoryTotal(month, categoryId) {
  return month.expenses
    .filter((item) => item.categoryId === categoryId)
    .reduce((sum, item) => sum + item.amount, 0)
}

function renderCategories() {
  const month = currentMonth()
  if (month.categories.length === 0) {
    categoryGridEl.innerHTML = `
      <div class="empty">No hay categorías. Crea una para empezar a anotar gastos.</div>
    `
    return
  }

  const cards = month.categories.map((category, index) => {
    const expenses = month.expenses
      .filter((item) => item.categoryId === category.id)
      .sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99) || a.name.localeCompare(b.name, 'es'))
    const wide = month.categories.length % 2 === 1 && index === month.categories.length - 1
    const body =
      expenses.length === 0
        ? `<p class="empty">No hay gastos en ${escapeHtml(category.name)}. Añade el primero cuando lo tengas.</p>`
        : `
          <ul class="ledger">
            ${expenses
              .map(
                (item) => `
                  <li>
                    <div class="name">
                      ${escapeHtml(item.name)}
                      <span class="meta">${escapeHtml(formatDueDay(item.dueDay, state.currentMonth))}</span>
                    </div>
                    <div class="amount">${formatMoney(item.amount)}</div>
                    ${rowActions('expense', item.id)}
                  </li>
                `,
              )
              .join('')}
          </ul>
        `

    return `
      <article class="category-card${wide ? ' wide' : ''}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(category.name)}</h3>
            <strong>${formatMoney(categoryTotal(month, category.id))}</strong>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-tiny" data-action="add-expense" data-category="${category.id}">Añadir gasto</button>
            <button type="button" class="btn btn-tiny" data-action="edit-category" data-id="${category.id}">Renombrar</button>
            <button type="button" class="btn btn-tiny" data-action="delete-category" data-id="${category.id}">Eliminar</button>
          </div>
        </div>
        ${body}
      </article>
    `
  })

  categoryGridEl.innerHTML = cards.join('')
}

function render() {
  renderBanner()
  renderSummary()
  renderIncomes()
  renderCategories()
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

function showFormError(message) {
  const errorEl = document.querySelector('#form-error')
  if (!message) {
    errorEl.hidden = true
    errorEl.textContent = ''
    return
  }
  errorEl.hidden = false
  errorEl.textContent = message
}

function openForm(context) {
  formContext = context
  const title = document.querySelector('#form-title')
  const nameInput = document.querySelector('#field-name')
  const amountInput = document.querySelector('#field-amount')
  const dueInput = document.querySelector('#field-due')
  showFormError('')

  if (context.type === 'income') {
    title.textContent = context.item ? 'Editar ingreso' : 'Añadir ingreso'
    setFieldVisibility(['amount', 'dueDay'])
    nameInput.value = context.item?.name ?? ''
    amountInput.value = context.item ? centsToInput(context.item.amount) : ''
    dueInput.value = context.item?.dueDay ?? ''
  } else if (context.type === 'expense') {
    title.textContent = context.item ? 'Editar gasto' : 'Añadir gasto'
    setFieldVisibility(['amount', 'category', 'dueDay'])
    fillCategorySelect(context.item?.categoryId ?? context.categoryId)
    nameInput.value = context.item?.name ?? ''
    amountInput.value = context.item ? centsToInput(context.item.amount) : ''
    dueInput.value = context.item?.dueDay ?? ''
  } else {
    title.textContent = context.item ? 'Renombrar categoría' : 'Nueva categoría'
    setFieldVisibility([])
    nameInput.value = context.item?.name ?? ''
  }

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
        id: formContext.item?.id ?? newId('inc'),
        name,
        amount: parseAmount(document.querySelector('#field-amount').value),
        dueDay: parseDueDay(document.querySelector('#field-due').value),
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
      const next = {
        id: formContext.item?.id ?? newId('exp'),
        name,
        amount: parseAmount(document.querySelector('#field-amount').value),
        categoryId,
        dueDay: parseDueDay(document.querySelector('#field-due').value),
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

function restoreOctober() {
  openConfirm({
    title: '¿Restaurar octubre 2026?',
    message:
      'Se volverá a cargar el presupuesto de octubre con ingreso de $4,800 y los gastos de la hoja. Los demás meses no se tocan.',
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
  const { action, id, category } = button.dataset
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
  } else if (action === 'add-category') {
    openForm({ type: 'category' })
  } else if (action === 'edit-category') {
    openForm({ type: 'category', item: month.categories.find((item) => item.id === id) })
  } else if (action === 'delete-category') {
    deleteCategory(id)
  } else if (action === 'open-month') {
    goToMonth(button.dataset.month)
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

function bindEvents() {
  document.querySelector('#prev-month').addEventListener('click', () => changeMonth(-1))
  document.querySelector('#next-month').addEventListener('click', () => changeMonth(1))
  document.querySelector('#create-next-month').addEventListener('click', createNextMonth)
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
  document.querySelector('#confirm-cancel').addEventListener('click', () => confirmDialog.close())
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
