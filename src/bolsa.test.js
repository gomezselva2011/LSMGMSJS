import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bolsaChartHtml,
  bolsaCapitalChartSeries,
  budgetLineLabelForBolsa,
  listBolsaBudgetPaymentLines,
} from './bolsa.js'

describe('bolsa budget payment lines', () => {
  it('uses canonical Tiggo label even if expense was renamed Himla', () => {
    const state = {
      months: {
        '2026-10': {
          expenses: [
            {
              id: 'exp-ot-camioneta',
              name: 'Himla',
              amount: 62000,
              currency: 'NIO',
            },
          ],
        },
      },
    }
    const bolsa = { budgetExpenseId: 'exp-ot-camioneta', name: 'Chery Tiggo 4 Pro (CrediQ)' }
    const lines = listBolsaBudgetPaymentLines(state, bolsa.budgetExpenseId, {
      budgetLineLabel: budgetLineLabelForBolsa(bolsa),
    })
    assert.equal(lines.length, 1)
    assert.match(lines[0].label, /Cuota Tiggo 4 Pro \(CrediQ\)/)
    assert.doesNotMatch(lines[0].label, /Himla/)
  })
})

describe('bolsa chart helpers', () => {
  it('bolsaCapitalChartSeries sorts by sort order', () => {
    const series = bolsaCapitalChartSeries([
      { appliedDate: '2026-02-01', balanceAfterCents: 100, sortOrder: 2 },
      { appliedDate: '2026-01-01', balanceAfterCents: 200, sortOrder: 1 },
    ])
    assert.equal(series.length, 2)
    assert.equal(series[0].balanceCents, 200)
  })

  it('bolsaChartHtml renders without throw', () => {
    const html = bolsaChartHtml({
      movements: [
        { appliedDate: '2026-01-05', balanceAfterCents: 2007833, sortOrder: 0 },
        { appliedDate: '2026-11-05', balanceAfterCents: 1965000, sortOrder: 26 },
      ],
    })
    assert.match(html, /Saldo capital por movimiento/)
    assert.match(html, /chart-bar/)
  })
})
