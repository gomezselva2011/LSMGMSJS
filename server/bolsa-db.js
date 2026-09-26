import { getMeta, setMeta } from './db.js'
import { createTiggoBolsaSeed } from './bolsa-seed.js'

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
  const { bolsa, movements } = createTiggoBolsaSeed()
  await insertBolsaWithMovements(db, bolsa, movements)
  return true
}

export async function ensureBolsaReady(db) {
  await ensureBolsaSchema(db)
  await seedBolsaIfEmpty(db)
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
