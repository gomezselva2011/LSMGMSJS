import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  closeGastosDb,
  ensureGastosDb,
  listUsers,
  openGastosDb,
  readHouseholdState,
  writeHouseholdState,
} from './db.js'

describe('sqlite household db', () => {
  const dirs = []

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      closeGastosDb(path.join(dir, 'data', 'gastos.sqlite'))
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  async function tmpRoot() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastos-db-'))
    dirs.push(dir)
    await fs.mkdir(path.join(dir, 'data'), { recursive: true })
    return dir
  }

  it('migrates gastos.json into tables on first boot', async () => {
    const root = await tmpRoot()
    await fs.writeFile(
      path.join(root, 'data', 'gastos.json'),
      `${JSON.stringify({
        version: 1,
        currentMonth: '2026-10',
        months: {
          '2026-10': {
            exchangeRate: 36.6,
            categories: [{ id: 'cat-otros', name: 'Otros gastos', layout: 'full' }],
            expenses: [
              {
                id: 'exp-ot-tc-melissa',
                name: 'TC Melissa',
                amount: 80000,
                categoryId: 'cat-otros',
                currency: 'USD',
                isCard: true,
                charges: [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }],
                details: { accountNumber: '123', notes: 'optica' },
              },
            ],
          },
        },
      })}\n`,
    )

    const db = await ensureGastosDb({ root })
    const state = readHouseholdState(db)
    assert.equal(state.currentMonth, '2026-10')
    assert.equal(state.months['2026-10'].expenses[0].charges[0].name, 'Lentes')
    assert.equal(state.months['2026-10'].expenses[0].details.accountNumber, '123')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM months').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM charges').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM expense_details').get().n, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 1)
  })

  it('migrates users.json and maps usuario to viewer', async () => {
    const root = await tmpRoot()
    await fs.writeFile(
      path.join(root, 'data', 'users.json'),
      `${JSON.stringify({
        users: [
          {
            id: 'usr_1',
            name: 'Invitada',
            username: 'invitada',
            role: 'usuario',
            passwordHash: 'scrypt:aa:bb',
            photo: null,
          },
        ],
      })}\n`,
    )
    const db = await ensureGastosDb({ root })
    const users = listUsers(db)
    assert.equal(users.length, 1)
    assert.equal(users[0].username, 'invitada')
    assert.equal(users[0].role, 'viewer')
  })

  it('keeps expense + subgasto after closing and reopening the file', async () => {
    const root = await tmpRoot()
    const dbPath = path.join(root, 'data', 'gastos.sqlite')
    const db = openGastosDb({ dbPath })
    writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-11',
      months: {
        '2026-11': {
          expenses: [
            {
              id: 'exp-1',
              name: 'TC Melissa',
              charges: [{ id: 'chg-persist', name: 'Subgasto persistente', amount: 1500, currency: 'NIO' }],
            },
          ],
        },
      },
    })
    closeGastosDb(dbPath)
    const again = readHouseholdState(openGastosDb({ dbPath }))
    assert.equal(again.months['2026-11'].expenses[0].charges[0].name, 'Subgasto persistente')
    assert.equal(again.months['2026-11'].expenses[0].charges[0].amount, 1500)
  })

  function octoberFixture(overrides = {}) {
    return {
      exchangeRate: 36.6,
      incomes: [{ id: 'inc-1', name: 'Salario Melissa 1', amount: 258000, dueDay: 1 }],
      categories: [{ id: 'cat-otros', name: 'Otros gastos', layout: 'full' }],
      expenses: [
        {
          id: 'exp-ot-tc-melissa',
          name: 'TC Melissa',
          amount: 80000,
          categoryId: 'cat-otros',
          dueDay: 5,
          rubro: 'credito',
          paymentStatus: 'unpaid',
          charges: [{ id: 'chg-1', name: 'Lentes', amount: 20000, currency: 'USD' }],
          details: { accountNumber: '111', notes: 'octubre' },
          ...overrides,
        },
      ],
    }
  }

  it('keeps currentMonth as the written month_key and does not rewrite other months', async () => {
    const root = await tmpRoot()
    const dbPath = path.join(root, 'data', 'gastos.sqlite')
    const db = openGastosDb({ dbPath })
    writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      months: { '2026-10': octoberFixture() },
    })
    const octoberRowid = db.prepare("SELECT rowid AS n FROM months WHERE id = '2026-10'").get().n
    const octoberAmount = db.prepare(
      "SELECT amount FROM expenses WHERE month_id = '2026-10' AND id = 'exp-ot-tc-melissa'",
    ).get().amount

    const dirtyOctober = octoberFixture({ amount: 1, paymentStatus: 'paid', details: { notes: 'mutated' } })
    const november = octoberFixture({ amount: 90000, paymentStatus: 'paid', details: { accountNumber: '999', notes: 'noviembre' } })
    november.exchangeRate = 40
    november.categories[0].layout = 'half'

    writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-11',
      saveScope: 'current',
      months: {
        '2026-10': dirtyOctober,
        '2026-11': november,
      },
    })

    const again = readHouseholdState(db)
    assert.equal(again.currentMonth, '2026-11')
    assert.deepEqual(Object.keys(again.months).sort(), ['2026-10', '2026-11'])
    assert.equal(again.months['2026-10'].expenses[0].amount, 80000)
    assert.equal(again.months['2026-10'].expenses[0].paymentStatus, 'unpaid')
    assert.equal(again.months['2026-10'].expenses[0].details.notes, 'octubre')
    assert.equal(again.months['2026-11'].expenses[0].amount, 90000)
    assert.equal(again.months['2026-11'].expenses[0].paymentStatus, 'paid')
    assert.equal(again.months['2026-11'].exchangeRate, 40)
    assert.equal(again.months['2026-11'].categories[0].layout, 'half')
    assert.equal(db.prepare("SELECT rowid AS n FROM months WHERE id = '2026-10'").get().n, octoberRowid)
    assert.equal(
      db.prepare("SELECT amount FROM expenses WHERE month_id = '2026-10' AND id = 'exp-ot-tc-melissa'").get().amount,
      octoberAmount,
    )
  })

  it('copies Crear septiembre into 2026-09 only', async () => {
    const root = await tmpRoot()
    const dbPath = path.join(root, 'data', 'gastos.sqlite')
    const db = openGastosDb({ dbPath })
    writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-10',
      months: { '2026-10': octoberFixture() },
    })
    const dirtyOctober = octoberFixture({ amount: 1 })
    writeHouseholdState(db, {
      version: 1,
      currentMonth: '2026-09',
      months: {
        '2026-09': octoberFixture({ amount: 80000, paymentStatus: 'paid' }),
        '2026-10': dirtyOctober,
      },
    })
    const again = readHouseholdState(db)
    assert.equal(again.currentMonth, '2026-09')
    assert.equal(again.months['2026-09'].expenses[0].paymentStatus, 'paid')
    assert.equal(again.months['2026-10'].expenses[0].amount, 80000)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM months').get().n, 2)
  })
})
