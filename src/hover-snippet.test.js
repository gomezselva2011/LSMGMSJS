import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SNIPPET_HOVER_QUERY,
  canShowExpenseSnippet,
  expenseSnippetHtml,
  expenseSnippetRows,
  isMousePointer,
} from './hover-snippet.js'

const CASA = {
  id: 'exp-sa-casa',
  name: 'Casa',
  amount: 17200,
  currency: 'USD',
  dueDay: 15,
  paymentStatus: 'unpaid',
  details: {
    accountNumber: '001-123456-7',
    monthlyUsd: 17200,
    monthlyNio: 629520,
    expectedUsd: 17200,
    expectedNio: 630000,
    notes: 'Renta San Andrés, pago el 15.',
  },
}

describe('canShowExpenseSnippet', () => {
  it('uses hover + fine pointer + min-width 900px', () => {
    assert.match(SNIPPET_HOVER_QUERY, /hover:\s*hover/)
    assert.match(SNIPPET_HOVER_QUERY, /pointer:\s*fine/)
    assert.match(SNIPPET_HOVER_QUERY, /min-width:\s*900px/)
  })

  it('is false without matchMedia and on coarse/touch queries', () => {
    assert.equal(canShowExpenseSnippet(undefined), false)
    assert.equal(canShowExpenseSnippet(() => ({ matches: false })), false)
    assert.equal(canShowExpenseSnippet(() => ({ matches: true })), true)
  })

  it('ignores touch and pen pointers', () => {
    assert.equal(isMousePointer({ pointerType: 'mouse' }), true)
    assert.equal(isMousePointer({ pointerType: 'touch' }), false)
    assert.equal(isMousePointer({ pointerType: 'pen' }), false)
    assert.equal(isMousePointer({}), true)
  })
})

describe('expenseSnippetRows', () => {
  it('includes Spanish fields that exist and skips empty ones', () => {
    const rows = expenseSnippetRows(CASA, { monthKey: '2026-10', rate: 36.6 })
    const map = Object.fromEntries(rows.map((row) => [row.key, row]))
    assert.equal(map.nombre, undefined)
    assert.match(map.monto.value, /\$172\.00/)
    assert.match(map.monto.value, /C\$6,295\.20/)
    assert.equal(map.fecha.value, '15 de octubre')
    assert.equal(map.estado.value, 'Sin pagar')
    assert.equal(map.estado.tone, 'unpaid')
    assert.equal(map.cuenta.value, '001-123456-7')
    assert.match(map.mensualidad.value, /\$172\.00/)
    assert.match(map.mensualidad.value, /C\$6,295\.20/)
    assert.match(map.esperado.value, /C\$6,300\.00/)
    assert.equal(map.notas.value, 'Renta San Andrés, pago el 15.')
    assert.equal(map.subgastos, undefined)
  })

  it('marks pagado and compares expected vs the line amount', () => {
    const rows = expenseSnippetRows(
      {
        ...CASA,
        paymentStatus: 'paid',
        paid: true,
        details: { ...CASA.details, expectedUsd: 20000, expectedNio: null, notes: '' },
      },
      { monthKey: '2026-10', rate: 36.6 },
    )
    const map = Object.fromEntries(rows.map((row) => [row.key, row]))
    assert.equal(map.estado.value, 'Pagado')
    assert.equal(map.estado.tone, 'paid')
    assert.match(map.esperado.value, /\$200\.00/)
    assert.match(map.esperado.value, /en la línea \$172\.00/)
    assert.equal(map.notas, undefined)
  })

  it('skips cuenta, mensualidad, esperado and notas when empty', () => {
    const rows = expenseSnippetRows(
      { name: 'Luz', amount: 0, currency: 'USD', dueDay: null },
      { monthKey: '2026-10' },
    )
    const keys = rows.map((row) => row.key)
    assert.deepEqual(keys, ['monto', 'fecha', 'estado'])
    assert.equal(rows.find((row) => row.key === 'fecha').value, 'Sin fecha')
  })

  it('counts subgastos when the line has charges', () => {
    const rows = expenseSnippetRows({
      name: 'TC Melissa',
      amount: 80000,
      currency: 'USD',
      dueDay: 1,
      charges: [{ id: 'a' }, { id: 'b' }],
    })
    assert.equal(rows.find((row) => row.key === 'subgastos').value, '2 cargos')
  })
})

describe('expenseSnippetHtml', () => {
  it('escapes untrusted names and notes', () => {
    const html = expenseSnippetHtml({
      name: '<img src=x>',
      amount: 100,
      currency: 'USD',
      dueDay: 1,
      details: { notes: '<script>alert(1)</script>' },
    }, { monthKey: '2026-10' })
    assert.equal(html.includes('<img'), false)
    assert.equal(html.includes('<script>'), false)
    assert.match(html, /&lt;img src=x&gt;/)
    assert.match(html, /&lt;script&gt;/)
    assert.match(html, /Vista rápida/)
  })
})
