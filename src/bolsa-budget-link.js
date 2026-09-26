/** Presupuesto expense ids — Tiggo 4 e Himla son gastos distintos. */
export const TIGGO_BUDGET_EXPENSE_ID = 'exp-ot-tiggo-4-cuota'
export const HIMLA_BUDGET_EXPENSE_ID = 'exp-ot-himla-cuota'
/** Id antiguo compartido; solo incluir si el nombre coincide con Tiggo, nunca Himla. */
export const LEGACY_CAMIONETA_EXPENSE_ID = 'exp-ot-camioneta'

export const TIGGO_BOLSA_ID = 'bolsa-tiggo-4-crediq'

/**
 * @param {{ id?: string, budgetExpenseId?: string }} bolsa
 * @returns {{ expenseId: string, includeNamePattern?: RegExp, excludeNamePattern?: RegExp }[]}
 */
export function budgetLinksForBolsa(bolsa) {
  const primary = bolsa?.budgetExpenseId || TIGGO_BUDGET_EXPENSE_ID
  if (bolsa?.id === TIGGO_BOLSA_ID || primary === TIGGO_BUDGET_EXPENSE_ID) {
    return [
      { expenseId: TIGGO_BUDGET_EXPENSE_ID },
      {
        expenseId: LEGACY_CAMIONETA_EXPENSE_ID,
        excludeNamePattern: /^himla$/i,
        includeNamePattern: /tiggo|4\s*pro|chery|cuota tiggo/i,
      },
    ]
  }
  if (primary === HIMLA_BUDGET_EXPENSE_ID) {
    return [
      { expenseId: HIMLA_BUDGET_EXPENSE_ID },
      { expenseId: LEGACY_CAMIONETA_EXPENSE_ID, includeNamePattern: /^himla$/i },
    ]
  }
  return [{ expenseId: primary }]
}

export function expenseMatchesBudgetLink(expense, link) {
  if (!expense || expense.id !== link.expenseId) return false
  const name = String(expense.name || '').trim()
  if (link.excludeNamePattern && link.excludeNamePattern.test(name)) return false
  if (link.includeNamePattern && !link.includeNamePattern.test(name)) return false
  return true
}

export function isExpenseIdAllowedForBolsa(bolsa, expenseId) {
  return budgetLinksForBolsa(bolsa).some((link) => link.expenseId === expenseId)
}

/** @param {{ id?: string, budgetExpenseId?: string }} bolsa */
export function bolsaAllowsBudgetExpense(bolsa, expense) {
  return budgetLinksForBolsa(bolsa).some((link) => expenseMatchesBudgetLink(expense, link))
}
