/**
 * Seed data for household debt bolsas (PDF / Banpro cuts Sep 2026).
 */

import {
  TIGGO_BOLSA_ID,
  TIGGO_BUDGET_EXPENSE_ID,
  HIMLA_BOLSA_ID,
  HIMLA_BUDGET_EXPENSE_ID,
  TC_MELISSA_BOLSA_ID,
  TC_MELISSA_BUDGET_EXPENSE_ID,
  SAN_ANDRES_BOLSA_ID,
  SAN_ANDRES_BUDGET_EXPENSE_ID,
} from '../src/bolsa-budget-link.js'

export { TIGGO_BOLSA_ID }

function usd(value) {
  return Math.round(Number(value) * 100)
}

function nio(value) {
  return Math.round(Number(value) * 100)
}

/** @returns {{ bolsa: object, movements: object[] }} */
export function createTiggoBolsaSeed() {
  const movements = [
    { id: 'mov-tiggo-01', appliedDate: '2024-12-03', receipt: '20241000179', paymentCents: usd(401.45), capitalCents: usd(330.56), balanceAfterCents: usd(22751.45), movementType: 'cuota' },
    { id: 'mov-tiggo-02', appliedDate: '2025-01-04', receipt: '00011896811', paymentCents: usd(401.41), capitalCents: usd(274.91), balanceAfterCents: usd(22647.25), movementType: 'cuota' },
    { id: 'mov-tiggo-03', appliedDate: '2025-02-01', receipt: '20251000295', paymentCents: usd(432.96), capitalCents: usd(291.77), balanceAfterCents: usd(22559.91), movementType: 'cuota' },
    { id: 'mov-tiggo-04', appliedDate: '2025-03-04', receipt: '00011929806', paymentCents: usd(435.34), capitalCents: usd(247.71), balanceAfterCents: usd(22429.46), movementType: 'cuota' },
    { id: 'mov-tiggo-05', appliedDate: '2025-04-02', receipt: '20251000412', paymentCents: usd(444.33), capitalCents: usd(291.77), balanceAfterCents: usd(22330.54), movementType: 'cuota' },
    { id: 'mov-tiggo-06', appliedDate: '2025-05-02', receipt: '20251000477', paymentCents: usd(435.11), capitalCents: usd(272.3), balanceAfterCents: usd(22221.27), movementType: 'cuota' },
    { id: 'mov-tiggo-07', appliedDate: '2025-06-02', receipt: '20251000545', paymentCents: usd(435.01), capitalCents: usd(280.02), balanceAfterCents: usd(22119.72), movementType: 'cuota' },
    { id: 'mov-tiggo-08', appliedDate: '2025-07-02', receipt: '20251000611', paymentCents: usd(434.91), capitalCents: usd(269.72), balanceAfterCents: usd(22007.87), movementType: 'cuota' },
    { id: 'mov-tiggo-09', appliedDate: '2025-08-05', receipt: '00019010232', paymentCents: usd(434.8), capitalCents: usd(277.45), balanceAfterCents: usd(21903.75), movementType: 'cuota' },
    { id: 'mov-tiggo-10', appliedDate: '2025-09-05', receipt: '00019026891', paymentCents: usd(434.7), capitalCents: usd(276.13), balanceAfterCents: usd(21798.31), movementType: 'cuota' },
    { id: 'mov-tiggo-11', appliedDate: '2025-10-04', receipt: '20251000879', paymentCents: usd(434.59), capitalCents: usd(265.89), balanceAfterCents: usd(21682.63), movementType: 'cuota' },
    { id: 'mov-tiggo-12', appliedDate: '2025-11-05', receipt: '00019060451', paymentCents: usd(434.48), capitalCents: usd(273.35), balanceAfterCents: usd(21574.41), movementType: 'cuota' },
    { id: 'mov-tiggo-13', appliedDate: '2025-12-04', receipt: '20251001064', paymentCents: usd(434.37), capitalCents: usd(263.16), balanceAfterCents: usd(21456.0), movementType: 'cuota' },
    { id: 'mov-tiggo-14', appliedDate: '2026-01-05', receipt: '00019092765', paymentCents: usd(435.94), capitalCents: usd(270.49), balanceAfterCents: usd(21344.92), movementType: 'cuota' },
    { id: 'mov-tiggo-15', appliedDate: '2026-01-20', receipt: '20261001179', paymentCents: usd(435.83), capitalCents: usd(268.35), balanceAfterCents: usd(21231.7), movementType: 'cuota' },
    { id: 'mov-tiggo-16', appliedDate: '2026-02-05', receipt: '00019110300', paymentCents: usd(435.83), capitalCents: usd(435.83), balanceAfterCents: usd(20795.87), movementType: 'extra_capital' },
    { id: 'mov-tiggo-17', appliedDate: '2026-03-05', receipt: '00019126430', paymentCents: usd(435.29), capitalCents: usd(236.8), balanceAfterCents: usd(20654.51), movementType: 'cuota' },
    { id: 'mov-tiggo-18', appliedDate: '2026-03-06', receipt: '00019127316', paymentCents: usd(3.44), capitalCents: usd(0.03), balanceAfterCents: usd(20651.1), movementType: 'cuota' },
    { id: 'mov-tiggo-19', appliedDate: '2026-04-05', receipt: '00019145524', paymentCents: usd(435.15), capitalCents: usd(260.31), balanceAfterCents: usd(20529.84), movementType: 'cuota' },
    { id: 'mov-tiggo-20', appliedDate: '2026-05-06', receipt: '00019161390', paymentCents: usd(435.04), capitalCents: usd(250.46), balanceAfterCents: usd(20398.73), movementType: 'cuota' },
    { id: 'mov-tiggo-21', appliedDate: '2026-06-06', receipt: '00019178642', paymentCents: usd(435.04), capitalCents: usd(257.21), balanceAfterCents: usd(20274.37), movementType: 'cuota' },
    { id: 'mov-tiggo-22', appliedDate: '2026-07-07', receipt: '00019195884', paymentCents: usd(426.0), capitalCents: usd(247.4), balanceAfterCents: usd(20149.11), movementType: 'cuota' },
    { id: 'mov-tiggo-23', appliedDate: '2026-07-09', receipt: '00019196795', paymentCents: usd(8.0), capitalCents: usd(7.45), balanceAfterCents: usd(20141.66), movementType: 'cuota' },
    { id: 'mov-tiggo-24', appliedDate: '2026-08-05', receipt: '00019212233', paymentCents: usd(440.0), capitalCents: usd(254.72), balanceAfterCents: usd(20009.04), movementType: 'cuota' },
    { id: 'mov-tiggo-25', appliedDate: '2026-09-08', receipt: '00019230866', paymentCents: usd(460.0), capitalCents: usd(252.94), balanceAfterCents: usd(19881.82), movementType: 'cuota' },
  ]

  const bolsa = {
    id: TIGGO_BOLSA_ID,
    name: 'Chery Tiggo 4 Pro (CrediQ)',
    creditor: 'CrediQ Inversiones Nicaragua S.A.',
    product: 'Leasing F Financiero',
    vehicle: 'CHERY / TIGGO 4',
    plate: 'M 419693',
    accountNumber: '0660000001280',
    currency: 'USD',
    openingAmountCents: usd(22800),
    capitalBalanceCents: usd(19881.82),
    totalCurrentCents: usd(20081.71),
    accruedInsuranceCents: usd(3.38),
    interestRate: 14.68,
    moraRate: 3.67,
    paymentDay: 5,
    installmentCents: usd(433.11),
    totalInstallments: 108,
    paidInstallments: 22,
    pendingInstallments: 86,
    budgetExpenseId: TIGGO_BUDGET_EXPENSE_ID,
    cutDate: '2026-09-26',
  }

  return { bolsa, movements }
}

/** @returns {{ bolsa: object, movements: object[] }} */
export function createHimlaBolsaSeed() {
  const movements = [
    { id: 'mov-himla-01', appliedDate: '2026-01-20', receipt: '00019101185', paymentCents: usd(429.7), capitalCents: usd(350.0), balanceAfterCents: usd(23943.82), movementType: 'cuota' },
    { id: 'mov-himla-02', appliedDate: '2026-02-21', receipt: '00019119831', paymentCents: usd(859.29), capitalCents: usd(319.25), balanceAfterCents: usd(23427.25), movementType: 'cuota' },
    { id: 'mov-himla-03', appliedDate: '2026-03-20', receipt: '00019135797', paymentCents: usd(429.64), capitalCents: usd(273.54), balanceAfterCents: usd(23294.61), movementType: 'cuota' },
    { id: 'mov-himla-04', appliedDate: '2026-04-20', receipt: '00019154663', paymentCents: usd(435.03), capitalCents: usd(300.89), balanceAfterCents: usd(23183.3), movementType: 'cuota' },
    { id: 'mov-himla-05', appliedDate: '2026-05-19', receipt: '20261001541', paymentCents: usd(428.9), capitalCents: usd(289.74), balanceAfterCents: usd(23066.86), movementType: 'cuota' },
    { id: 'mov-himla-06', appliedDate: '2026-06-20', receipt: '00019185989', paymentCents: usd(465.73), capitalCents: usd(297.95), balanceAfterCents: usd(22968.5), movementType: 'cuota' },
    { id: 'mov-himla-07', appliedDate: '2026-06-24', receipt: '00019188029', paymentCents: usd(10.0), capitalCents: usd(0.0), balanceAfterCents: usd(22958.63), movementType: 'cuota' },
    { id: 'mov-himla-08', appliedDate: '2026-07-20', receipt: '00019202910', paymentCents: usd(476.0), capitalCents: usd(287.0), balanceAfterCents: usd(22838.82), movementType: 'cuota' },
    { id: 'mov-himla-09', appliedDate: '2026-08-31', receipt: '00019225134', paymentCents: usd(480.0), capitalCents: usd(295.0), balanceAfterCents: usd(22727.64), movementType: 'cuota' },
    { id: 'mov-himla-10', appliedDate: '2026-09-06', receipt: '00019229424', paymentCents: usd(470.0), capitalCents: usd(161.5), balanceAfterCents: usd(22483.83), movementType: 'cuota' },
  ]

  const bolsa = {
    id: HIMLA_BOLSA_ID,
    name: 'Himla (CrediQ)',
    creditor: 'CrediQ Inversiones Nicaragua S.A.',
    product: 'Leasing F Financiero',
    vehicle: 'CHERY / TIGGO 8 PRO MAX',
    plate: 'M 456943',
    accountNumber: '0660000001693',
    currency: 'USD',
    openingAmountCents: usd(24000),
    capitalBalanceCents: usd(22483.83),
    totalCurrentCents: usd(22786.86),
    accruedInsuranceCents: usd(46.82),
    interestRate: 15.0,
    moraRate: 3.75,
    paymentDay: 20,
    installmentCents: usd(475.02),
    totalInstallments: 107,
    paidInstallments: 8,
    pendingInstallments: 99,
    budgetExpenseId: HIMLA_BUDGET_EXPENSE_ID,
    cutDate: '2026-09-26',
  }

  return { bolsa, movements }
}

/** @returns {{ bolsa: object, movements: object[] }} */
export function createTcMelissaBolsaSeed() {
  const movements = [
    {
      id: 'mov-tc-mel-01',
      appliedDate: '2026-08-10',
      receipt: 'saldo-corte-ago',
      paymentCents: 0,
      capitalCents: 0,
      balanceAfterCents: nio(155075.14),
      movementType: 'cuota',
    },
    {
      id: 'mov-tc-mel-02',
      appliedDate: '2026-08-28',
      receipt: 'compras-ciclo',
      paymentCents: nio(39047.59),
      capitalCents: nio(39047.59),
      balanceAfterCents: nio(194122.73),
      movementType: 'extra_capital',
    },
    {
      id: 'mov-tc-mel-03',
      appliedDate: '2026-09-01',
      receipt: 'GRACIAS POR SU PAGO',
      paymentCents: nio(18000),
      capitalCents: nio(18000),
      balanceAfterCents: nio(176122.73),
      movementType: 'cuota',
    },
    {
      id: 'mov-tc-mel-04',
      appliedDate: '2026-09-03',
      receipt: 'GRACIAS POR SU PAGO',
      paymentCents: nio(12600),
      capitalCents: nio(12600),
      balanceAfterCents: nio(163622.73),
      movementType: 'cuota',
    },
  ]

  const bolsa = {
    id: TC_MELISSA_BOLSA_ID,
    name: 'TC Melissa (Ficohsa Visa)',
    creditor: 'Banco Ficohsa de Nicaragua S.A.',
    product: 'Visa Platino Disfruta+',
    vehicle: null,
    plate: null,
    accountNumber: 'XXXXXXXXXXXX3992',
    currency: 'NIO',
    openingAmountCents: 0,
    capitalBalanceCents: nio(163622.73),
    totalCurrentCents: nio(163622.73),
    accruedInsuranceCents: null,
    interestRate: 45.0,
    moraRate: 22.5,
    paymentDay: 5,
    installmentCents: nio(12020.41),
    totalInstallments: null,
    paidInstallments: null,
    pendingInstallments: null,
    budgetExpenseId: TC_MELISSA_BUDGET_EXPENSE_ID,
    cutDate: '2026-09-10',
  }

  return { bolsa, movements }
}

/** @returns {{ bolsa: object, movements: object[] }} */
export function createSanAndresBolsaSeed() {
  const movements = [
    {
      id: 'mov-sa-01',
      appliedDate: '2026-03-24',
      receipt: '741234',
      paymentCents: usd(15286.48),
      capitalCents: 0,
      balanceAfterCents: usd(15286.48),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-02',
      appliedDate: '2026-03-24',
      receipt: 'abono-extra',
      paymentCents: usd(233.1),
      capitalCents: usd(233.1),
      balanceAfterCents: usd(15053.38),
      movementType: 'extra_capital',
    },
    {
      id: 'mov-sa-03',
      appliedDate: '2026-04-10',
      receipt: 'adelanto-cuota',
      paymentCents: usd(170.04),
      capitalCents: usd(44.68),
      balanceAfterCents: usd(15008.7),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-04',
      appliedDate: '2026-05-23',
      receipt: 'abono-menor',
      paymentCents: usd(2.32),
      capitalCents: usd(2.32),
      balanceAfterCents: usd(15006.38),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-05',
      appliedDate: '2026-05-27',
      receipt: 'abono-completo',
      paymentCents: usd(167.53),
      capitalCents: usd(44.68),
      balanceAfterCents: usd(14961.7),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-06',
      appliedDate: '2026-06-23',
      receipt: 'abono-menor',
      paymentCents: usd(1.82),
      capitalCents: usd(1.82),
      balanceAfterCents: usd(14959.88),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-07',
      appliedDate: '2026-06-26',
      receipt: 'abono-completo',
      paymentCents: usd(168.02),
      capitalCents: usd(44.68),
      balanceAfterCents: usd(14915.2),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-08',
      appliedDate: '2026-07-31',
      receipt: 'abono-completo',
      paymentCents: usd(169.75),
      capitalCents: usd(44.68),
      balanceAfterCents: usd(14870.52),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-09',
      appliedDate: '2026-08-31',
      receipt: 'abono-menor',
      paymentCents: usd(0.62),
      capitalCents: usd(0.62),
      balanceAfterCents: usd(14869.9),
      movementType: 'cuota',
    },
    {
      id: 'mov-sa-10',
      appliedDate: '2026-09-01',
      receipt: 'abono-completo',
      paymentCents: usd(169.1),
      capitalCents: usd(44.68),
      balanceAfterCents: usd(14870.59),
      movementType: 'cuota',
    },
  ]

  const bolsa = {
    id: SAN_ANDRES_BOLSA_ID,
    name: 'Casa San Andrés (Banpro)',
    creditor: 'Banpro — Grupo Promerica',
    product: 'Hipotecario / Vivienda USD',
    vehicle: null,
    plate: null,
    accountNumber: '741234',
    currency: 'USD',
    openingAmountCents: usd(15286.48),
    capitalBalanceCents: usd(14870.59),
    totalCurrentCents: usd(14870.59),
    accruedInsuranceCents: null,
    interestRate: null,
    moraRate: null,
    paymentDay: 30,
    installmentCents: usd(169.7),
    totalInstallments: 175,
    paidInstallments: 6,
    pendingInstallments: 175,
    budgetExpenseId: SAN_ANDRES_BUDGET_EXPENSE_ID,
    cutDate: '2026-09-26',
  }

  return { bolsa, movements }
}

/** @returns {{ bolsa: object, movements: object[] }[]} */
export function allStandardBolsaSeeds() {
  return [
    createTiggoBolsaSeed(),
    createHimlaBolsaSeed(),
    createTcMelissaBolsaSeed(),
    createSanAndresBolsaSeed(),
  ]
}
