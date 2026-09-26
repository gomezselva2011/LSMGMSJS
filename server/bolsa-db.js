import { randomBytes } from 'node:crypto'
import { getMeta, isMonthKey, readHouseholdState, setMeta, writeHouseholdState } from './db.js'
import { allStandardBolsaSeeds } from './bolsa-seed.js'
import {
  TIGGO_BOLSA_ID,
  TIGGO_BUDGET_EXPENSE_ID,
  bolsaAllowsBudgetExpense,
} from '../src/bolsa-budget-link.js'

export const BOLSA_SCHEMA_VERSION = 2

const BOLSA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bolsas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creditor TEXT,
  product TEXT,
  vehicle TEXT,
  plate TEXT,
  account_number TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  opening_amount_cents INTEGER NOT NULL DEFAULT 0,
  capital_balance_cents INTEGER NOT NULL DEFAULT 0,
  total_current_cents INTEGER,
  accrued_insurance_cents INTEGER,
  interest_rate REAL,
  mora_rate REAL,
  payment_day INTEGER,
  installment_cents INTEGER,
  total_installments INTEGER,
  paid_installments INTEGER,
  pending_installments INTEGER,
  budget_expense_id TEXT,
  cut_date TEXT,
  extra_json TEXT
);

CREATE TABLE IF NOT EXISTS bolsa_movements (
  id TEXT PRIMARY KEY,
  bolsa_id TEXT NOT NULL REFERENCES bolsas(id) ON DELETE CASCADE,
  applied_date TEXT NOT NULL,
  receipt TEXT,
  payment_cents INTEGER NOT NULL DEFAULT 0,
  capital_cents INTEGER NOT NULL DEFAULT 0,
  balance_after_cents INTEGER,
  movement_type TEXT NOT NULL DEFAULT 'cuota',
  sort_order INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_bolsa_movements_bolsa ON bolsa_movements(bolsa_id, sort_order, applied_date);
`

function bolsaFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    creditor: row.creditor || null,
    product: row.product || null,
    vehicle: row.vehicle || null,
    plate: row.plate || null,
    accountNumber: row.account_number || null,
    currency: row.currency || 'USD',
    openingAmountCents: Number(row.opening_amount_cents) || 0,
    capitalBalanceCents: Number(row.capital_balance_cents) || 0,
    totalCurrentCents: row.total_current_cents == null ? null : Number(row.total_current_cents),
    accruedInsuranceCents: row.accrued_insurance_cents == null ? null : Number(row.accrued_insurance_cents),
    interestRate: row.interest_rate == null ? null : Number(row.interest_rate),
    moraRate: row.mora_rate == null ? null : Number(row.mora_rate),
    paymentDay: row.payment_day == null ? null : Number(row.payment_day),
    installmentCents: row.installment_cents == null ? null : Number(row.installment_cents),
    totalInstallments: row.total_installments == null ? null : Number(row.total_installments),
    paidInstallments: row.paid_installments == null ? null : Number(row.paid_installments),
    pendingInstallments: row.pending_installments == null ? null : Number(row.pending_installments),
    budgetExpenseId: row.budget_expense_id || null,
    cutDate: row.cut_date || null,
  }
}

function movementFromRow(row) {
  const extra = parseExtraJson(row.extra_json)
  const budgetLink = movementLinkFromExtra(extra)
  return {
    id: row.id,
    bolsaId: row.bolsa_id,
    appliedDate: row.applied_date,
    receipt: row.receipt || null,
    paymentCents: Number(row.payment_cents) || 0,
    capitalCents: Number(row.capital_cents) || 0,
    balanceAfterCents: row.balance_after_cents == null ? null : Number(row.balance_after_cents),
    movementType: row.movement_type || 'cuota',
    sortOrder: Number(row.sort_order) || 0,
    budgetLink,
    deletable: Boolean(budgetLink),
  }
}

async function execSql(db, sql) {
  return await db.exec(sql)
}

async function getRow(db, sql, ...args) {
  return await db.prepare(sql).get(...args)
}

async function allRows(db, sql, ...args) {
  const rows = await db.prepare(sql).all(...args)
  return rows || []
}

async function runSql(db, sql, ...args) {
  return await db.prepare(sql).run(...args)
}

export async function ensureBolsaSchema(db) {
  await execSql(db, BOLSA_SCHEMA_SQL)
  const current = Number(await getMeta(db, 'schema_version')) || 1
  if (current < BOLSA_SCHEMA_VERSION) {
    await setMeta(db, 'schema_version', String(BOLSA_SCHEMA_VERSION))
  }
}

async function insertBolsaWithMovements(db, bolsa, movements) {
  await runSql(
    db,
    `INSERT INTO bolsas (
      id, name, creditor, product, vehicle, plate, account_number, currency,
      opening_amount_cents, capital_balance_cents, total_current_cents, accrued_insurance_cents,
      interest_rate, mora_rate, payment_day, installment_cents,
      total_installments, paid_installments, pending_installments,
      budget_expense_id, cut_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bolsa.id,
    bolsa.name,
    bolsa.creditor,
    bolsa.product,
    bolsa.vehicle,
    bolsa.plate,
    bolsa.accountNumber,
    bolsa.currency,
    bolsa.openingAmountCents,
    bolsa.capitalBalanceCents,
    bolsa.totalCurrentCents,
    bolsa.accruedInsuranceCents,
    bolsa.interestRate,
    bolsa.moraRate,
    bolsa.paymentDay,
    bolsa.installmentCents,
    bolsa.totalInstallments,
    bolsa.paidInstallments,
    bolsa.pendingInstallments,
    bolsa.budgetExpenseId,
    bolsa.cutDate,
  )

  const insertMovement = db.prepare(`
    INSERT INTO bolsa_movements (
      id, bolsa_id, applied_date, receipt, payment_cents, capital_cents,
      balance_after_cents, movement_type, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const [index, movement] of movements.entries()) {
    await insertMovement.run(
      movement.id,
      bolsa.id,
      movement.appliedDate,
      movement.receipt,
      movement.paymentCents,
      movement.capitalCents,
      movement.balanceAfterCents,
      movement.movementType || 'cuota',
      index,
    )
  }
}

export async function seedBolsaIfEmpty(db) {
  const row = await getRow(db, 'SELECT COUNT(*) AS n FROM bolsas')
  if (row && row.n > 0) return false
  await ensureMissingStandardBolsas(db)
  return true
}

async function ensureMissingStandardBolsas(db) {
  let inserted = 0
  for (const { bolsa, movements } of allStandardBolsaSeeds()) {
    const existing = await getRow(db, 'SELECT id FROM bolsas WHERE id = ?', bolsa.id)
    if (existing) continue
    await insertBolsaWithMovements(db, bolsa, movements)
    inserted += 1
  }
  return inserted
}

async function migrateBolsaBudgetLinks(db) {
  await runSql(
    db,
    `UPDATE bolsas SET budget_expense_id = ? WHERE id = ? AND (budget_expense_id IS NULL OR budget_expense_id = 'exp-ot-camioneta')`,
    TIGGO_BUDGET_EXPENSE_ID,
    TIGGO_BOLSA_ID,
  )
}

export async function ensureBolsaReady(db) {
  await ensureBolsaSchema(db)
  await seedBolsaIfEmpty(db)
  await ensureMissingStandardBolsas(db)
  await migrateBolsaBudgetLinks(db)
}

export async function updateBolsaBudgetLink(db, bolsaId, budgetExpenseId) {
  const id = String(bolsaId || '').trim()
  const expenseId = String(budgetExpenseId || '').trim()
  if (!id) throw applicationError('Falta la bolsa.', 'INVALID')
  if (!expenseId) throw applicationError('Elige una línea del presupuesto.', 'INVALID')

  const row = await getRow(db, 'SELECT id FROM bolsas WHERE id = ?', id)
  if (!row) throw applicationError('Bolsa no encontrada.', 'NOT_FOUND', 404)

  await runSql(db, 'UPDATE bolsas SET budget_expense_id = ? WHERE id = ?', expenseId, id)
  return readBolsa(db, id)
}

export async function listBolsas(db) {
  const rows = await allRows(db, 'SELECT * FROM bolsas ORDER BY name, id')
  return rows.map(bolsaFromRow)
}

export async function readBolsa(db, bolsaId) {
  const row = await getRow(db, 'SELECT * FROM bolsas WHERE id = ?', bolsaId)
  if (!row) return null
  const bolsa = bolsaFromRow(row)
  const movementRows = await allRows(
    db,
    'SELECT * FROM bolsa_movements WHERE bolsa_id = ? ORDER BY sort_order, applied_date, id',
    bolsaId,
  )
  bolsa.movements = movementRows.map(movementFromRow)
  return bolsa
}

function parseExtraJson(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function movementLinkFromExtra(extra) {
  if (!extra) return null
  const budgetMonthKey = extra.budgetMonthKey
  const expenseId = extra.expenseId
  if (!budgetMonthKey || !expenseId) return null
  return {
    budgetMonthKey: String(budgetMonthKey),
    expenseId: String(expenseId),
    chargeId: extra.chargeId == null || extra.chargeId === '' ? null : String(extra.chargeId),
  }
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

function markLinePaid(item) {
  if (!item || typeof item !== 'object') return false
  item.paymentStatus = 'paid'
  item.paid = true
  if (typeof item.pagado === 'boolean') item.pagado = true
  return true
}

function markLineUnpaid(item) {
  if (!item || typeof item !== 'object') return false
  item.paymentStatus = 'unpaid'
  item.paid = false
  if (typeof item.pagado === 'boolean') item.pagado = false
  return true
}

function computeCapitalCentsForPayment(bolsa, paymentCents, currentCapitalCents) {
  const cap = Math.max(0, Number(currentCapitalCents) || 0)
  const payment = Math.max(0, Number(paymentCents) || 0)
  if (!payment) return 0
  const rate = Number(bolsa?.interestRate)
  if (Number.isFinite(rate) && rate > 0 && cap > 0) {
    const interestCents = Math.min(payment, Math.round(cap * (rate / 100 / 12)))
    const capitalFromPayment = Math.max(0, payment - interestCents)
    return Math.min(cap, capitalFromPayment)
  }
  return Math.min(payment, cap)
}

const SEED_PAID_BY_BOLSA_ID = new Map(
  allStandardBolsaSeeds().map(({ bolsa }) => [bolsa.id, Number(bolsa.paidInstallments) || 0]),
)

function seedPaidInstallmentsBaseline(bolsaId, bolsaRow) {
  if (SEED_PAID_BY_BOLSA_ID.has(bolsaId)) {
    return SEED_PAID_BY_BOLSA_ID.get(bolsaId)
  }
  const paid = Number(bolsaRow?.paid_installments) || 0
  const pending = Number(bolsaRow?.pending_installments) || 0
  const total = Number(bolsaRow?.total_installments) || paid + pending
  return Math.max(0, Math.min(paid, total))
}

function countManualApplicationRows(movementRows) {
  let count = 0
  for (const row of movementRows) {
    if (movementLinkFromExtra(parseExtraJson(row.extra_json))) count += 1
  }
  return count
}

/**
 * Sync paid/pending and manual movement balance_after chain; seeded PDF rows are left unchanged.
 * @param {import('./sql-conn.js').GastosDb} db
 * @param {string} bolsaId
 * @param {{ capitalBalanceCents?: number }} [options]
 */
export async function recomputeBolsaSnapshot(db, bolsaId, options = {}) {
  const bolsaRow = await getRow(db, 'SELECT * FROM bolsas WHERE id = ?', bolsaId)
  if (!bolsaRow) return null

  const movementRows = await allRows(
    db,
    'SELECT * FROM bolsa_movements WHERE bolsa_id = ? ORDER BY sort_order, applied_date, id',
    bolsaId,
  )

  const manualRows = movementRows.filter((row) => movementRowIsDeletable(row))
  const manualCount = manualRows.length
  const seedPaid = seedPaidInstallmentsBaseline(bolsaId, bolsaRow)
  const totalInstallments =
    Number(bolsaRow.total_installments) || seedPaid + (Number(bolsaRow.pending_installments) || 0)
  const paidInstallments = Math.min(totalInstallments, seedPaid + manualCount)
  const pendingInstallments = Math.max(0, totalInstallments - paidInstallments)

  let capitalBalanceCents = options.capitalBalanceCents
  if (capitalBalanceCents == null) capitalBalanceCents = Number(bolsaRow.capital_balance_cents) || 0

  if (manualRows.length) {
    let balanceBefore = capitalBalanceCents
    for (const row of manualRows) {
      balanceBefore += Number(row.capital_cents) || 0
    }
    for (const row of manualRows) {
      const capitalPart = Number(row.capital_cents) || 0
      balanceBefore = Math.max(0, balanceBefore - capitalPart)
      await runSql(db, 'UPDATE bolsa_movements SET balance_after_cents = ? WHERE id = ?', balanceBefore, row.id)
    }
  }

  const accrued = bolsaRow.accrued_insurance_cents == null ? null : Number(bolsaRow.accrued_insurance_cents)
  const totalCurrentCents = accrued == null ? bolsaRow.total_current_cents : capitalBalanceCents + accrued

  await runSql(
    db,
    `UPDATE bolsas SET
      capital_balance_cents = ?,
      paid_installments = ?,
      pending_installments = ?,
      total_current_cents = ?
    WHERE id = ?`,
    capitalBalanceCents,
    paidInstallments,
    pendingInstallments,
    totalCurrentCents,
    bolsaId,
  )

  return readBolsa(db, bolsaId)
}

function movementRowIsDeletable(row) {
  return Boolean(movementLinkFromExtra(parseExtraJson(row.extra_json)))
}

function findBudgetLine(month, expenseId, chargeId) {
  if (!month || !Array.isArray(month.expenses)) return { expense: null, line: null, kind: null }
  const expense = month.expenses.find((entry) => entry?.id === expenseId)
  if (!expense) return { expense: null, line: null, kind: null }
  if (chargeId) {
    const charge = chargesForExpense(expense).find((entry) => entry?.id === chargeId)
    return charge ? { expense, line: charge, kind: 'charge' } : { expense, line: null, kind: null }
  }
  return { expense, line: expense, kind: 'expense' }
}

function lineAmountCents(line, expense, bolsa) {
  const amount = Number(line?.amount)
  if (Number.isFinite(amount) && amount > 0) return Math.round(amount)
  const fallback = Number(bolsa?.installmentCents)
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback)
  return 0
}

function todayIsoDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function newMovementId() {
  return `mov_${randomBytes(12).toString('hex')}`
}

function applicationError(message, code, status = 400) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

async function findDuplicateApplication(db, bolsaId, { receipt, appliedDate, paymentCents, link }) {
  const rows = await allRows(db, 'SELECT receipt, applied_date, payment_cents, extra_json FROM bolsa_movements WHERE bolsa_id = ?', bolsaId)
  for (const row of rows) {
    if (receipt && row.receipt && row.receipt === receipt) return true
    const extra = movementLinkFromExtra(parseExtraJson(row.extra_json))
    if (
      extra &&
      link &&
      extra.budgetMonthKey === link.budgetMonthKey &&
      extra.expenseId === link.expenseId &&
      (extra.chargeId || null) === (link.chargeId || null) &&
      row.applied_date === appliedDate &&
      Number(row.payment_cents) === paymentCents
    ) {
      return true
    }
  }
  return false
}

/**
 * @param {import('./sql-conn.js').GastosDb} db
 * @param {string} bolsaId
 * @param {{ sourceMonthKey?: string, expenseId?: string, chargeId?: string|null, applyToMonthKey?: string, appliedDate?: string, receipt?: string|null }} body
 */
export async function applyBolsaPayment(db, bolsaId, body = {}) {
  const sourceMonthKey = String(body.sourceMonthKey || '').trim()
  const applyToMonthKey = String(body.applyToMonthKey || '').trim()
  const expenseId = String(body.expenseId || '').trim()
  const chargeId = body.chargeId == null || body.chargeId === '' ? null : String(body.chargeId).trim()
  const appliedDate = String(body.appliedDate || todayIsoDate()).trim()
  const receipt = body.receipt == null || body.receipt === '' ? null : String(body.receipt).trim()

  if (!isMonthKey(sourceMonthKey) || !isMonthKey(applyToMonthKey)) {
    throw applicationError('Elige mes de origen y mes donde marcar pagado.', 'INVALID_MONTH')
  }
  if (!expenseId) throw applicationError('Falta la línea de pago del presupuesto.', 'INVALID')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appliedDate)) {
    throw applicationError('La fecha aplicada no es válida.', 'INVALID_DATE')
  }

  const bolsaRow = await getRow(db, 'SELECT * FROM bolsas WHERE id = ?', bolsaId)
  if (!bolsaRow) throw applicationError('Bolsa no encontrada.', 'NOT_FOUND', 404)
  const bolsa = bolsaFromRow(bolsaRow)
  if (!bolsa.budgetExpenseId) {
    throw applicationError('Esta bolsa no está enlazada al presupuesto.', 'NO_BUDGET_LINK')
  }
  const state = await readHouseholdState(db)
  const months = state.months && typeof state.months === 'object' ? state.months : {}
  const sourceMonth = months[sourceMonthKey]
  const applyMonth = months[applyToMonthKey]
  if (!sourceMonth) throw applicationError('No existe el mes de origen en el presupuesto.', 'SOURCE_MONTH')
  if (!applyMonth) throw applicationError('No existe el mes destino en el presupuesto.', 'APPLY_MONTH')

  const source = findBudgetLine(sourceMonth, expenseId, chargeId)
  if (!source.line) throw applicationError('No se encontró la línea de pago en el mes de origen.', 'SOURCE_LINE')
  if (!bolsaAllowsBudgetExpense(bolsa, source.expense)) {
    throw applicationError('La línea elegida no corresponde a esta bolsa (ej. Himla ≠ Tiggo 4).', 'EXPENSE_MISMATCH')
  }

  const target = findBudgetLine(applyMonth, expenseId, chargeId)
  if (!target.line) {
    throw applicationError('No hay una línea equivalente en el mes destino para marcar pagada.', 'TARGET_LINE')
  }

  const paymentCents = lineAmountCents(source.line, source.expense, bolsa)
  if (!paymentCents) throw applicationError('No se pudo determinar el monto del pago.', 'AMOUNT')

  const link = {
    budgetMonthKey: applyToMonthKey,
    expenseId,
    chargeId,
    sourceMonthKey,
  }

  if (await findDuplicateApplication(db, bolsaId, { receipt, appliedDate, paymentCents, link })) {
    throw applicationError('Este pago ya fue aplicado a la bolsa.', 'DUPLICATE', 409)
  }

  markLinePaid(target.line)

  await writeHouseholdState(db, {
    ...state,
    saveScope: 'all',
    months,
  })

  const sortRow = await getRow(
    db,
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM bolsa_movements WHERE bolsa_id = ?',
    bolsaId,
  )
  const sortOrder = Number(sortRow?.max_order ?? -1) + 1
  const movementId = newMovementId()
  const currentCapital = Number(bolsaRow.capital_balance_cents) || 0
  const capitalCents = computeCapitalCentsForPayment(bolsa, paymentCents, currentCapital)
  const balanceAfterCents = Math.max(0, currentCapital - capitalCents)
  const extraJson = JSON.stringify({
    budgetMonthKey: applyToMonthKey,
    expenseId,
    ...(chargeId ? { chargeId } : {}),
    sourceMonthKey,
    source: 'manual',
  })

  await runSql(
    db,
    `INSERT INTO bolsa_movements (
      id, bolsa_id, applied_date, receipt, payment_cents, capital_cents,
      balance_after_cents, movement_type, sort_order, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    movementId,
    bolsaId,
    appliedDate,
    receipt,
    paymentCents,
    capitalCents,
    balanceAfterCents,
    'cuota',
    sortOrder,
    extraJson,
  )

  await recomputeBolsaSnapshot(db, bolsaId, { capitalBalanceCents: balanceAfterCents })
  return readBolsa(db, bolsaId)
}

/**
 * @param {import('./sql-conn.js').GastosDb} db
 * @param {string} bolsaId
 * @param {string} movementId
 */
export async function deleteBolsaMovement(db, bolsaId, movementId) {
  const movRow = await getRow(
    db,
    'SELECT * FROM bolsa_movements WHERE id = ? AND bolsa_id = ?',
    movementId,
    bolsaId,
  )
  if (!movRow) throw applicationError('Movimiento no encontrado.', 'NOT_FOUND', 404)
  if (!movementRowIsDeletable(movRow)) {
    throw applicationError('Solo se pueden quitar pagos aplicados manualmente desde el presupuesto.', 'NOT_DELETABLE', 403)
  }

  const bolsaRow = await getRow(db, 'SELECT * FROM bolsas WHERE id = ?', bolsaId)
  if (!bolsaRow) throw applicationError('Bolsa no encontrada.', 'NOT_FOUND', 404)

  const extra = parseExtraJson(movRow.extra_json)
  const link = movementLinkFromExtra(extra)

  if (link) {
    const state = await readHouseholdState(db)
    const months = state.months && typeof state.months === 'object' ? state.months : {}
    const month = months[link.budgetMonthKey]
    if (month) {
      const target = findBudgetLine(month, link.expenseId, link.chargeId)
      if (target.line) markLineUnpaid(target.line)
      await writeHouseholdState(db, { ...state, saveScope: 'all', months })
    }
  }

  const restoredCapital =
    (Number(bolsaRow.capital_balance_cents) || 0) + (Number(movRow.capital_cents) || 0)

  await runSql(db, 'DELETE FROM bolsa_movements WHERE id = ? AND bolsa_id = ?', movementId, bolsaId)
  await recomputeBolsaSnapshot(db, bolsaId, { capitalBalanceCents: restoredCapital })
  return readBolsa(db, bolsaId)
}
