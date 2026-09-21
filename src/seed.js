/** October 2026 household budget. Amounts are integer cents. */

import { DEFAULT_EXCHANGE_RATE } from './money.js'

export const HOUSEHOLD = 'Melissa y Lenin'
export const SEEDED_MONTH = '2026-10'
export const STORAGE_KEY = 'gastos-hogar-v1'

export const CATEGORY_SAN_ANDRES = 'cat-san-andres'
export const CATEGORY_PRADERAS = 'cat-praderas'
export const CATEGORY_OTROS = 'cat-otros'

export function createOctoberSeed() {
  return {
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    incomes: [
      {
        id: 'inc-melissa-1',
        name: 'Salario Melissa 1',
        amount: 258000,
        dueDay: 1,
      },
      {
        id: 'inc-melissa-2',
        name: 'Salario Melissa 2',
        amount: 222000,
        dueDay: 1,
      },
    ],
    categories: [
      { id: CATEGORY_SAN_ANDRES, name: 'Casa San Andrés', layout: 'half' },
      { id: CATEGORY_PRADERAS, name: 'Casa Praderas de Sandino', layout: 'half' },
      { id: CATEGORY_OTROS, name: 'Otros gastos', layout: 'full' },
    ],
    expenses: [
      { id: 'exp-sa-luz', name: 'Luz', amount: 0, categoryId: CATEGORY_SAN_ANDRES, dueDay: 15, rubro: 'servicios' },
      { id: 'exp-sa-agua', name: 'Agua RSA', amount: 0, categoryId: CATEGORY_SAN_ANDRES, dueDay: 15, rubro: 'servicios' },
      {
        id: 'exp-sa-internet',
        name: 'Internet RSA',
        amount: 0,
        categoryId: CATEGORY_SAN_ANDRES,
        dueDay: 10,
        rubro: 'servicios',
      },
      { id: 'exp-sa-casa', name: 'Casa', amount: 17200, categoryId: CATEGORY_SAN_ANDRES, dueDay: 15, rubro: 'vivienda' },
      {
        id: 'exp-sa-seguridad',
        name: 'Seguridad RSA',
        amount: 2000,
        categoryId: CATEGORY_SAN_ANDRES,
        dueDay: 15,
        rubro: 'servicios',
      },

      {
        id: 'exp-ot-camioneta',
        name: 'Mensualidad camioneta',
        amount: 62000,
        categoryId: CATEGORY_OTROS,
        dueDay: 1,
        rubro: 'camionetas',
      },
      {
        id: 'exp-ot-internet-lenin',
        name: 'Internet Lenin',
        amount: 6000,
        categoryId: CATEGORY_OTROS,
        dueDay: 10,
        rubro: 'servicios',
      },
      {
        id: 'exp-ot-tc-lenin',
        name: 'TC Lenin',
        amount: 18000,
        categoryId: CATEGORY_OTROS,
        dueDay: 1,
        isCard: true,
        charges: [],
        rubro: 'credito',
      },
      {
        id: 'exp-ot-tc-melissa',
        name: 'TC Melissa',
        amount: 80000,
        categoryId: CATEGORY_OTROS,
        dueDay: 1,
        isCard: true,
        charges: [],
        rubro: 'credito',
      },
      {
        id: 'exp-ot-mat-mateo',
        name: 'Matrícula Mateo',
        amount: 23800,
        categoryId: CATEGORY_OTROS,
        dueDay: null,
        rubro: 'escuelas',
      },
      {
        id: 'exp-ot-mat-marcela',
        name: 'Matrícula Marcela',
        amount: 18000,
        categoryId: CATEGORY_OTROS,
        dueDay: null,
        rubro: 'escuelas',
      },
      { id: 'exp-ot-iglesia', name: 'Iglesia', amount: 50000, categoryId: CATEGORY_OTROS, dueDay: null, rubro: 'iglesia' },

      { id: 'exp-pr-agua', name: 'Agua', amount: 2000, categoryId: CATEGORY_PRADERAS, dueDay: 29, rubro: 'servicios' },
      { id: 'exp-pr-luz', name: 'Luz', amount: 30400, categoryId: CATEGORY_PRADERAS, dueDay: 10, rubro: 'servicios' },
      {
        id: 'exp-pr-internet',
        name: 'Internet',
        amount: 7084,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 10,
        rubro: 'servicios',
      },
      { id: 'exp-pr-casa', name: 'Casa', amount: 22000, categoryId: CATEGORY_PRADERAS, dueDay: null, rubro: 'vivienda' },
      { id: 'exp-pr-comida', name: 'Comida', amount: 50000, categoryId: CATEGORY_PRADERAS, dueDay: 1, rubro: 'comida' },
      {
        id: 'exp-pr-seguridad',
        name: 'Seguridad',
        amount: 2000,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'servicios',
      },
      {
        id: 'exp-pr-camioneta',
        name: 'Camioneta',
        amount: 45000,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'camionetas',
      },
      {
        id: 'exp-pr-gasolina',
        name: 'Gasolina',
        amount: 16000,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'camionetas',
      },
      {
        id: 'exp-pr-esc-mateo',
        name: 'Escuela Mateo',
        amount: 0,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'escuelas',
      },
      {
        id: 'exp-pr-esc-marcela',
        name: 'Escuela Marcela',
        amount: 18000,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'escuelas',
      },
      {
        id: 'exp-pr-recorrido',
        name: 'Recorrido',
        amount: 6630,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'escuelas',
      },
      {
        id: 'exp-pr-dona-pina',
        name: 'Doña Pina',
        amount: 12000,
        categoryId: CATEGORY_PRADERAS,
        dueDay: 1,
        rubro: 'familia',
      },
      { id: 'exp-pr-madre', name: 'Madre', amount: 10000, categoryId: CATEGORY_PRADERAS, dueDay: 1, rubro: 'familia' },
    ],
  }
}

export function createEmptyMonth() {
  return {
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    incomes: [],
    categories: [
      { id: CATEGORY_SAN_ANDRES, name: 'Casa San Andrés', layout: 'half' },
      { id: CATEGORY_PRADERAS, name: 'Casa Praderas de Sandino', layout: 'half' },
      { id: CATEGORY_OTROS, name: 'Otros gastos', layout: 'full' },
    ],
    expenses: [],
  }
}

export function cloneMonth(month) {
  return structuredClone(month)
}
