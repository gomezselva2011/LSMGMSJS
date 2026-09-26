import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TIGGO_BOLSA_ID,
  TIGGO_BUDGET_EXPENSE_ID,
  bolsaAllowsBudgetExpense,
} from './bolsa-budget-link.js'

describe('bolsa budget link filters', () => {
  const tiggoBolsa = { id: TIGGO_BOLSA_ID, budgetExpenseId: TIGGO_BUDGET_EXPENSE_ID }

  it('allows Tiggo-named legacy line', () => {
    assert.equal(
      bolsaAllowsBudgetExpense(tiggoBolsa, { id: 'exp-ot-camioneta', name: 'Chery Tiggo 4pro' }),
      true,
    )
  })

  it('rejects Himla on legacy id for Tiggo bolsa', () => {
    assert.equal(bolsaAllowsBudgetExpense(tiggoBolsa, { id: 'exp-ot-camioneta', name: 'Himla' }), false)
  })

  it('allows dedicated Tiggo expense id regardless of display name', () => {
    assert.equal(
      bolsaAllowsBudgetExpense(tiggoBolsa, { id: TIGGO_BUDGET_EXPENSE_ID, name: 'Cuota' }),
      true,
    )
  })
})
