import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DRIVER_SQLITE,
  applyPragmas,
  connectionKey as tursoConnectionKey,
  mutexFor,
  openSqliteFile,
  openTursoDatabase,
  shouldUseTurso,
} from './sql-conn.js'

export { DRIVER_SQLITE, shouldUseTurso }

export const SCHEMA_VERSION = 1
export const ROLE_ADMIN = 'admin'
export const ROLE_VIEWER = 'viewer'

const connections = new Map()
const opening = new Map()

export const MONTH_KEY_RE = /^\d{4}-\d{2}$/

export function isMonthKey(value) {
  return typeof value === 'string' && MONTH_KEY_RE.test(value)
}

const STATE_KEYS = new Set(['version', 'currentMonth', 'months', 'saveScope'])
const MONTH_KEYS = new Set(['exchangeRate', 'incomes', 'categories', 'expenses'])
const INCOME_KEYS = new Set(['id', 'name', 'amount', 'dueDay', 'currency'])
const CATEGORY_KEYS = new Set(['id', 'name', 'layout', 'width'])
const EXPENSE_KEYS = new Set([
  'id',
  'name',
  'amount',
  'categoryId',
  'dueDay',
  'rubro',
  'isCard',
  'charges',
  'subgastos',
  'cargos',
  'currency',
  'details',
])
const CHARGE_KEYS = new Set(['id', 'name', 'amount', 'currency', 'nombre', 'title', 'concepto', 'label', 'monto', 'cents', 'value', 'pago', 'moneda'])

function envDataDir(env = process.env) {
  const value = env?.GASTOS_DATA_DIR
  if (value == null) return null
  const text = String(value).trim()
  return text ? path.resolve(text) : null
}

/**
 * Directory for sqlite, avatars, and leftover JSON.
 * Explicit options (dataDir / dbPath / dataPath / root) win; otherwise `GASTOS_DATA_DIR`, else `<cwd>/data`.
 */
export function resolveDataDir(options = {}) {
  if (options.dataDir) return path.resolve(options.dataDir)
  if (options.dbPath) return path.dirname(path.resolve(options.dbPath))
  if (options.dataPath) return path.dirname(path.resolve(options.dataPath))
  if (options.root) return path.join(options.root, 'data')
  const fromEnv = envDataDir(options.env || process.env)
  if (fromEnv) return fromEnv
  return path.join(process.cwd(), 'data')
}

export function defaultDbPath(root) {
  return path.join(resolveDataDir(root === undefined ? {} : { root }), 'gastos.sqlite')
}

export function defaultGastosJsonPath(root) {
  return path.join(resolveDataDir(root === undefined ? {} : { root }), 'gastos.json')
}

export function defaultUsersJsonPath(root) {
  return path.join(resolveDataDir(root === undefined ? {} : { root }), 'users.json')
}

export function defaultSessionsJsonPath(root) {
  return path.join(resolveDataDir(root === undefined ? {} : { root }), 'sessions.json')
}

export function resolveDbPath(options = {}) {
  if (options.dbPath) return options.dbPath
  if (options.dataPath && String(options.dataPath).endsWith('.sqlite')) return options.dataPath
  if (options.dataPath) return path.join(path.dirname(options.dataPath), 'gastos.sqlite')
  return path.join(resolveDataDir(options), 'gastos.sqlite')
}

export function connectionKey(options = {}) {
  if (shouldUseTurso(options)) return tursoConnectionKey(options)
  return resolveDbPath(options)
}

export function normalizeRole(value) {
  if (value === ROLE_ADMIN) return ROLE_ADMIN
  if (value === ROLE_VIEWER || value === 'usuario') return ROLE_VIEWER
  return null
}

function extraJson(object, known) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const extra = {}
  for (const [key, value] of Object.entries(object)) {
    if (!known.has(key)) extra[key] = value
  }
  return Object.keys(extra).length ? JSON.stringify(extra) : null
}

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function mergeExtra(base, raw) {
  const extra = parseJson(raw, null)
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base
  return { ...extra, ...base }
}

function asInt(value, fallback = null) {
  if (value == null || value === '') return fallback
  const amount = Number(value)
  if (!Number.isFinite(amount)) return fallback
  return Math.round(amount)
}

function asText(value, fallback = null) {
  if (value == null) return fallback
  const text = String(value)
  return text.length ? text : fallback
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

function withLock(db, fn) {
  return mutexFor(db).runExclusive(fn)
}

async function withTransaction(db, fn) {
  await execSql(db, 'BEGIN IMMEDIATE')
  try {
    const result = await fn()
    await execSql(db, 'COMMIT')
    return result
  } catch (error) {
    try {
      await execSql(db, 'ROLLBACK')
    } catch {
      // Ignore rollback failures when the transaction never started.
    }
    throw error
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  display_name TEXT NOT NULL,
  avatar_path TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS months (
  id TEXT PRIMARY KEY,
  exchange_rate REAL,
  extra_json TEXT
);

CREATE TABLE IF NOT EXISTS incomes (
  month_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER,
  currency TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT,
  PRIMARY KEY (month_id, id),
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  month_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  layout TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT,
  PRIMARY KEY (month_id, id),
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  month_id TEXT NOT NULL,
  id TEXT NOT NULL,
  category_id TEXT,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER,
  rubro TEXT,
  is_card INTEGER,
  currency TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT,
  PRIMARY KEY (month_id, id),
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS charges (
  month_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT,
  PRIMARY KEY (month_id, expense_id, id),
  FOREIGN KEY (month_id, expense_id) REFERENCES expenses(month_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expense_details (
  month_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  account_number TEXT,
  monthly_usd INTEGER,
  monthly_nio INTEGER,
  expected_usd INTEGER,
  expected_nio INTEGER,
  notes TEXT,
  PRIMARY KEY (month_id, expense_id),
  FOREIGN KEY (month_id, expense_id) REFERENCES expenses(month_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_incomes_month ON incomes(month_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_month ON categories(month_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(month_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_charges_expense ON charges(month_id, expense_id, sort_order);
`

async function createSchema(db) {
  await execSql(db, SCHEMA_SQL)
  const version = await getRow(db, 'SELECT value FROM meta WHERE key = ?', 'schema_version')
  if (!version) {
    await runSql(db, 'INSERT INTO meta (key, value) VALUES (?, ?)', 'schema_version', String(SCHEMA_VERSION))
  }
}

async function openNewConnection(options = {}) {
  let db
  if (shouldUseTurso(options)) {
    db = await openTursoDatabase(options)
  } else {
    db = openSqliteFile(resolveDbPath(options))
  }
  await applyPragmas(db)
  await createSchema(db)
  return db
}

export async function openGastosDb(options = {}) {
  const key = connectionKey(options)
  const existing = connections.get(key)
  if (existing) return existing
  const inFlight = opening.get(key)
  if (inFlight) return inFlight

  const pending = openNewConnection(options)
    .then((db) => {
      connections.set(key, db)
      return db
    })
    .finally(() => {
      opening.delete(key)
    })
  opening.set(key, pending)
  return pending
}

export function closeGastosDb(dbPath) {
  const key = dbPath || resolveDbPath()
  const db = connections.get(key)
  if (!db) return
  try {
    db.close()
  } catch {
    // Already closed.
  }
  connections.delete(key)
}

export async function getMeta(db, key) {
  const row = await getRow(db, 'SELECT value FROM meta WHERE key = ?', key)
  return row ? row.value : null
}

export async function setMeta(db, key, value) {
  if (value == null) {
    await runSql(db, 'DELETE FROM meta WHERE key = ?', key)
    return
  }
  await runSql(
    db,
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value),
  )
}

function userFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.display_name,
    role: row.role,
    passwordHash: row.password_hash,
    photo: row.avatar_path || null,
  }
}

export async function listUsers(db) {
  return (await allRows(db, 'SELECT * FROM users ORDER BY rowid')).map(userFromRow)
}

export async function countUsers(db) {
  const row = await getRow(db, 'SELECT COUNT(*) AS n FROM users')
  return row.n
}

export async function replaceUsers(db, users) {
  await withLock(db, () =>
    withTransaction(db, async () => {
      const ids = new Set()
      const upsert = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, display_name, avatar_path)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      password_hash = excluded.password_hash,
      role = excluded.role,
      display_name = excluded.display_name,
      avatar_path = excluded.avatar_path
  `)
      for (const user of users) {
        const role = normalizeRole(user.role) || ROLE_VIEWER
        ids.add(user.id)
        await upsert.run(user.id, user.username, user.passwordHash, role, user.name, user.photo || null)
      }
      const existing = await allRows(db, 'SELECT id FROM users')
      const remove = db.prepare('DELETE FROM users WHERE id = ?')
      for (const row of existing) {
        if (!ids.has(row.id)) await remove.run(row.id)
      }
    }),
  )
}

export async function listSessions(db) {
  const sessions = {}
  for (const row of await allRows(db, 'SELECT token, user_id, expires_at FROM sessions')) {
    sessions[row.token] = { userId: row.user_id, expiresAt: Number(row.expires_at) }
  }
  return sessions
}

export async function replaceSessions(db, sessions) {
  await withLock(db, () =>
    withTransaction(db, async () => {
      const known = new Set((await allRows(db, 'SELECT id FROM users')).map((row) => row.id))
      const insert = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      await execSql(db, 'DELETE FROM sessions')
      for (const [token, session] of Object.entries(sessions || {})) {
        if (!session || !token || !known.has(session.userId)) continue
        await insert.run(token, session.userId, session.expiresAt)
      }
    }),
  )
}

async function insertMonthRows(db, monthId, month) {
  const data = month && typeof month === 'object' ? month : {}
  await runSql(
    db,
    'INSERT INTO months (id, exchange_rate, extra_json) VALUES (?, ?, ?)',
    monthId,
    data.exchangeRate == null || data.exchangeRate === '' ? null : Number(data.exchangeRate),
    extraJson(data, MONTH_KEYS),
  )

  const insertIncome = db.prepare(`
    INSERT INTO incomes (month_id, id, name, amount, due_day, currency, sort_order, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const [index, income] of (Array.isArray(data.incomes) ? data.incomes : []).entries()) {
    if (!income || typeof income !== 'object') continue
    const id = asText(income.id, `inc_${index}`)
    await insertIncome.run(
      monthId,
      id,
      asText(income.name, 'Ingreso'),
      asInt(income.amount, 0),
      asInt(income.dueDay, null),
      asText(income.currency, null),
      index,
      extraJson(income, INCOME_KEYS),
    )
  }

  const insertCategory = db.prepare(`
    INSERT INTO categories (month_id, id, name, layout, sort_order, extra_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const [index, category] of (Array.isArray(data.categories) ? data.categories : []).entries()) {
    if (!category || typeof category !== 'object') continue
    const id = asText(category.id, `cat_${index}`)
    await insertCategory.run(
      monthId,
      id,
      asText(category.name, 'Categoría'),
      asText(category.layout ?? category.width, null),
      index,
      extraJson(category, CATEGORY_KEYS),
    )
  }

  const insertExpense = db.prepare(`
    INSERT INTO expenses (
      month_id, id, category_id, name, amount, due_day, rubro, is_card, currency, sort_order, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCharge = db.prepare(`
    INSERT INTO charges (month_id, expense_id, id, name, amount, currency, sort_order, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertDetails = db.prepare(`
    INSERT INTO expense_details (
      month_id, expense_id, account_number, monthly_usd, monthly_nio, expected_usd, expected_nio, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const [index, expense] of (Array.isArray(data.expenses) ? data.expenses : []).entries()) {
    if (!expense || typeof expense !== 'object') continue
    const expenseId = asText(expense.id, `exp_${index}`)
    const isCard = typeof expense.isCard === 'boolean' ? (expense.isCard ? 1 : 0) : null
    await insertExpense.run(
      monthId,
      expenseId,
      asText(expense.categoryId, null),
      asText(expense.name, 'Gasto'),
      asInt(expense.amount, 0),
      asInt(expense.dueDay, null),
      asText(expense.rubro, null),
      isCard,
      asText(expense.currency, null),
      index,
      extraJson(expense, EXPENSE_KEYS),
    )

    const chargeLists = [expense.charges, expense.subgastos, expense.cargos]
    let charges = Array.isArray(expense.charges) ? expense.charges : []
    for (const list of chargeLists) {
      if (Array.isArray(list) && list.length > charges.length) charges = list
    }
    for (const [chargeIndex, charge] of charges.entries()) {
      if (!charge || typeof charge !== 'object') continue
      await insertCharge.run(
        monthId,
        expenseId,
        asText(charge.id, `chg_${chargeIndex}`),
        asText(charge.name ?? charge.nombre ?? charge.title, 'Subgasto'),
        asInt(charge.amount ?? charge.monto ?? charge.cents, 0),
        asText(charge.currency ?? charge.moneda, null),
        chargeIndex,
        extraJson(charge, CHARGE_KEYS),
      )
    }

    const details = expense.details && typeof expense.details === 'object' ? expense.details : null
    if (details) {
      await insertDetails.run(
        monthId,
        expenseId,
        asText(details.accountNumber, null),
        asInt(details.monthlyUsd, null),
        asInt(details.monthlyNio, null),
        asInt(details.expectedUsd, null),
        asInt(details.expectedNio, null),
        asText(details.notes, null),
      )
    }
  }
}

async function replaceMonthRows(db, monthId, month) {
  await runSql(db, 'DELETE FROM months WHERE id = ?', monthId)
  await insertMonthRows(db, monthId, month)
}

function monthKeysFrom(months) {
  return Object.keys(months || {}).filter(isMonthKey)
}

export async function writeHouseholdState(db, data) {
  const state = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const months =
    state.months && typeof state.months === 'object' && !Array.isArray(state.months) ? state.months : {}
  const incomingKeys = monthKeysFrom(months)
  const currentMonth = isMonthKey(state.currentMonth) ? state.currentMonth : null
  const saveScope = state.saveScope === 'all' ? 'all' : 'current'

  await withLock(db, () =>
    withTransaction(db, async () => {
      await setMeta(db, 'version', state.version == null ? null : state.version)
      await setMeta(db, 'current_month', currentMonth)
      const extra = extraJson(state, STATE_KEYS)
      await setMeta(db, 'state_extra', extra)

      const existingKeys = new Set((await allRows(db, 'SELECT id FROM months')).map((row) => row.id))
      const incoming = new Set(incomingKeys)

      if (saveScope === 'all') {
        for (const id of existingKeys) {
          if (!incoming.has(id)) {
            await runSql(db, 'DELETE FROM months WHERE id = ?', id)
          }
        }
      }

      const toWrite = new Set()
      for (const id of incoming) {
        if (!existingKeys.has(id)) toWrite.add(id)
      }
      if (saveScope === 'all' || !currentMonth || !incoming.has(currentMonth)) {
        for (const id of incoming) toWrite.add(id)
      } else {
        toWrite.add(currentMonth)
      }

      for (const monthId of toWrite) {
        await replaceMonthRows(db, monthId, months[monthId])
      }
    }),
  )
}

function detailsFromRow(row) {
  if (!row) return undefined
  const details = {
    accountNumber: row.account_number || '',
    monthlyUsd: row.monthly_usd == null ? null : Number(row.monthly_usd),
    monthlyNio: row.monthly_nio == null ? null : Number(row.monthly_nio),
    expectedUsd: row.expected_usd == null ? null : Number(row.expected_usd),
    expectedNio: row.expected_nio == null ? null : Number(row.expected_nio),
    notes: row.notes || '',
  }
  const empty =
    !details.accountNumber &&
    details.monthlyUsd == null &&
    details.monthlyNio == null &&
    details.expectedUsd == null &&
    details.expectedNio == null &&
    !details.notes
  return empty ? details : details
}

export async function readHouseholdState(db) {
  return withLock(db, async () => {
    const monthRows = await allRows(db, 'SELECT * FROM months ORDER BY id')
    const version = await getMeta(db, 'version')
    const currentMonth = await getMeta(db, 'current_month')
    const stateExtra = parseJson(await getMeta(db, 'state_extra'), null)

    if (!monthRows.length && currentMonth == null && version == null && !stateExtra) {
      return {}
    }

    const incomesByMonth = new Map()
    for (const row of await allRows(db, 'SELECT * FROM incomes ORDER BY month_id, sort_order, id')) {
      const list = incomesByMonth.get(row.month_id) || []
      list.push(row)
      incomesByMonth.set(row.month_id, list)
    }
    const categoriesByMonth = new Map()
    for (const row of await allRows(db, 'SELECT * FROM categories ORDER BY month_id, sort_order, id')) {
      const list = categoriesByMonth.get(row.month_id) || []
      list.push(row)
      categoriesByMonth.set(row.month_id, list)
    }
    const expensesByMonth = new Map()
    for (const row of await allRows(db, 'SELECT * FROM expenses ORDER BY month_id, sort_order, id')) {
      const list = expensesByMonth.get(row.month_id) || []
      list.push(row)
      expensesByMonth.set(row.month_id, list)
    }
    const chargesByExpense = new Map()
    for (const row of await allRows(db, 'SELECT * FROM charges ORDER BY month_id, expense_id, sort_order, id')) {
      const key = `${row.month_id}\0${row.expense_id}`
      const list = chargesByExpense.get(key) || []
      list.push(row)
      chargesByExpense.set(key, list)
    }
    const detailsByExpense = new Map()
    for (const row of await allRows(db, 'SELECT * FROM expense_details')) {
      detailsByExpense.set(`${row.month_id}\0${row.expense_id}`, row)
    }

    const months = {}
    for (const monthRow of monthRows) {
      const month = mergeExtra({}, monthRow.extra_json)
      if (monthRow.exchange_rate != null && Number.isFinite(Number(monthRow.exchange_rate))) {
        month.exchangeRate = Number(monthRow.exchange_rate)
      }
      month.incomes = (incomesByMonth.get(monthRow.id) || []).map((row) => {
        const income = mergeExtra(
          {
            id: row.id,
            name: row.name,
            amount: asInt(row.amount, 0),
          },
          row.extra_json,
        )
        if (row.due_day != null) income.dueDay = Number(row.due_day)
        else income.dueDay = income.dueDay ?? null
        if (row.currency) income.currency = row.currency
        return income
      })
      month.categories = (categoriesByMonth.get(monthRow.id) || []).map((row) => {
        const category = mergeExtra({ id: row.id, name: row.name }, row.extra_json)
        if (row.layout) category.layout = row.layout
        return category
      })
      month.expenses = (expensesByMonth.get(monthRow.id) || []).map((row) => {
        const expense = mergeExtra(
          {
            id: row.id,
            name: row.name,
            amount: asInt(row.amount, 0),
          },
          row.extra_json,
        )
        if (row.category_id) expense.categoryId = row.category_id
        expense.dueDay = row.due_day == null ? (expense.dueDay ?? null) : Number(row.due_day)
        if (row.rubro) expense.rubro = row.rubro
        if (row.is_card != null) expense.isCard = Number(row.is_card) === 1
        if (row.currency) expense.currency = row.currency
        const chargeRows = chargesByExpense.get(`${monthRow.id}\0${row.id}`) || []
        expense.charges = chargeRows.map((charge) => {
          const item = mergeExtra(
            {
              id: charge.id,
              name: charge.name,
              amount: asInt(charge.amount, 0),
            },
            charge.extra_json,
          )
          if (charge.currency) item.currency = charge.currency
          return item
        })
        const details = detailsFromRow(detailsByExpense.get(`${monthRow.id}\0${row.id}`))
        if (details) expense.details = details
        return expense
      })
      months[monthRow.id] = month
    }

    const out = stateExtra && typeof stateExtra === 'object' && !Array.isArray(stateExtra) ? { ...stateExtra } : {}
    if (version != null && version !== '') {
      const numeric = Number(version)
      out.version = Number.isFinite(numeric) && String(numeric) === String(version).trim() ? numeric : version
    }
    if (currentMonth) out.currentMonth = currentMonth
    out.months = months
    return out
  })
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath) return fallback
  try {
    const raw = await readFile(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function migrateLegacyJson(db, options = {}) {
  const dataDir = resolveDataDir(options)
  const usersPath = options.usersPath || path.join(dataDir, 'users.json')
  const sessionsPath = options.sessionsPath || path.join(dataDir, 'sessions.json')
  const gastosPath =
    options.gastosJsonPath ||
    (options.dataPath && String(options.dataPath).endsWith('.json') ? options.dataPath : null) ||
    path.join(dataDir, 'gastos.json')

  if ((await countUsers(db)) === 0) {
    const userFile = await readJsonIfPresent(usersPath, null)
    const users = Array.isArray(userFile?.users) ? userFile.users : []
    if (users.length) {
      await replaceUsers(
        db,
        users.map((user) => ({
          id: String(user.id),
          username: String(user.username || '').trim().toLowerCase(),
          name: String(user.name || user.username || 'Usuario'),
          role: normalizeRole(user.role) || ROLE_VIEWER,
          passwordHash: String(user.passwordHash || ''),
          photo: user.photo || user.avatar_path || null,
        })),
      )
      await setMeta(db, 'migrated_users_json', usersPath)
    }
  }

  const sessionCount = (await getRow(db, 'SELECT COUNT(*) AS n FROM sessions')).n
  if (sessionCount === 0) {
    const sessionFile = await readJsonIfPresent(sessionsPath, null)
    const sessions = sessionFile?.sessions && typeof sessionFile.sessions === 'object' ? sessionFile.sessions : null
    if (sessions && Object.keys(sessions).length) {
      await replaceSessions(db, sessions)
      await setMeta(db, 'migrated_sessions_json', sessionsPath)
    }
  }

  const monthCount = (await getRow(db, 'SELECT COUNT(*) AS n FROM months')).n
  if (monthCount === 0 && (await getMeta(db, 'current_month')) == null) {
    const household = await readJsonIfPresent(gastosPath, null)
    if (household && typeof household === 'object' && !Array.isArray(household) && Object.keys(household).length) {
      await writeHouseholdState(db, household)
      await setMeta(db, 'migrated_gastos_json', gastosPath)
    }
  }

  return db
}

export async function ensureGastosDb(options = {}) {
  const db = await openGastosDb(options)
  await migrateLegacyJson(db, options)
  return db
}
