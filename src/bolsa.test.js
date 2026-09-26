import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bolsaChartHtml, bolsaCapitalChartSeries } from './bolsa.js'

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
