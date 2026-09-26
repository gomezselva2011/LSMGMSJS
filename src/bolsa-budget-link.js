/** Presupuesto expense ids — Tiggo 4 e Himla son gastos distintos. */
export const TIGGO_BUDGET_EXPENSE_ID = 'exp-ot-tiggo-4-cuota'
export const HIMLA_BUDGET_EXPENSE_ID = 'exp-ot-himla-cuota'
export const TC_MELISSA_BUDGET_EXPENSE_ID = 'exp-ot-tc-melissa'
export const SAN_ANDRES_BUDGET_EXPENSE_ID = 'exp-sa-casa'
/** Id antiguo compartido; en bolsa Tiggo incluir todas las líneas salvo nombre Himla. */
export const LEGACY_CAMIONETA_EXPENSE_ID = 'exp-ot-camioneta'

export const TIGGO_BOLSA_ID = 'bolsa-tiggo-4-crediq'
export const HIMLA_BOLSA_ID = 'bolsa-himla-crediq'
export const TC_MELISSA_BOLSA_ID = 'bolsa-tc-melissa-ficohsa'
export const SAN_ANDRES_BOLSA_ID = 'bolsa-san-andres-banpro'

const HIMLA_NAME = /himla/i

/**
 * @param {{ expenseId: string, includeNamePattern?: RegExp, excludeNamePattern?: RegExp }[]} links
 */
function dedupeLinks(links) {
  const seen = new Set()
  const out = []
  for (const link of links) {
    const key = `${link.expenseId}|${link.excludeNamePattern || ''}|${link.includeNamePattern || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link)
  }
  return out
}

/**
 * @param {{ id?: string, budgetExpenseId?: string }} bolsa
 * @returns {{ expenseId: string, includeNamePattern?: RegExp, excludeNamePattern?: RegExp }[]}
 */
export function budgetLinksForBolsa(bolsa) {
  const bolsaId = bolsa?.id
  const primary = String(bolsa?.budgetExpenseId || '').trim()

  if (bolsaId === TIGGO_BOLSA_ID) {
    if (!primary || primary === TIGGO_BUDGET_EXPENSE_ID) {
      return dedupeLinks([
        { expenseId: TIGGO_BUDGET_EXPENSE_ID },
        { expenseId: LEGACY_CAMIONETA_EXPENSE_ID, excludeNamePattern: HIMLA_NAME },
      ])
    }
    if (primary === LEGACY_CAMIONETA_EXPENSE_ID) {
      return [{ expenseId: LEGACY_CAMIONETA_EXPENSE_ID, excludeNamePattern: HIMLA_NAME }]
    }
    return [{ expenseId: primary }]
  }

  if (bolsaId === HIMLA_BOLSA_ID) {
    return dedupeLinks([
      { expenseId: HIMLA_BUDGET_EXPENSE_ID },
      { expenseId: LEGACY_CAMIONETA_EXPENSE_ID, includeNamePattern: HIMLA_NAME },
    ])
  }

  if (primary) {
    return [{ expenseId: primary }]
  }

  return []
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
