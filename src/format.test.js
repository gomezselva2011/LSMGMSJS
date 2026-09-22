import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeHtml,
  formatCreateMonthLabel,
  formatCreateNextLabel,
  formatCreatePrevLabel,
  formatDueDay,
  isMonthKey,
  shiftMonth,
} from './format.js'

describe('create-month labels', () => {
  it('names the previous and next months from October', () => {
    assert.equal(formatCreatePrevLabel('2026-10'), 'Crear septiembre')
    assert.equal(formatCreateNextLabel('2026-10'), 'Crear noviembre')
    assert.equal(formatCreateMonthLabel('2026-10', -1), 'Crear septiembre')
    assert.equal(formatCreateMonthLabel('2026-10', 1), 'Crear noviembre')
  })

  it('names August from September', () => {
    assert.equal(formatCreatePrevLabel('2026-09'), 'Crear agosto')
    assert.equal(formatCreateNextLabel('2026-09'), 'Crear octubre')
  })

  it('includes the year when the adjacent month crosses it', () => {
    assert.equal(formatCreatePrevLabel('2026-01'), 'Crear diciembre 2025')
    assert.equal(formatCreateNextLabel('2026-12'), 'Crear enero 2027')
  })

  it('shifts due-day labels with the new month key', () => {
    assert.equal(formatDueDay(1, '2026-10'), '1 de octubre')
    assert.equal(formatDueDay(1, '2026-09'), '1 de septiembre')
    assert.equal(shiftMonth('2026-10', -1), '2026-09')
    assert.equal(shiftMonth('2026-09', -1), '2026-08')
    assert.equal(isMonthKey('2026-09'), true)
    assert.equal(isMonthKey('2026-10'), true)
    assert.equal(isMonthKey('octubre'), false)
  })
})

describe('escapeHtml', () => {
  it('escapes markup in names and notes', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
    assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;')
  })
})
