/**
 * Seed data: Chery Tiggo 4 Pro only (CrediQ 0660000001280, placa M 419693), corte 26/09/2026.
 * Himla (cuenta 0660000001693, Tiggo 8 en papel) is a separate future bolsa — not included here.
 */

export const TIGGO_BOLSA_ID = 'bolsa-tiggo-4-crediq'

function usd(value) {
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
    capitalBalanceCents: usd(20078.33),
    totalCurrentCents: usd(20081.71),
    accruedInsuranceCents: usd(3.38),
    interestRate: 14.68,
    moraRate: 3.67,
    paymentDay: 5,
    installmentCents: usd(433.11),
    totalInstallments: 108,
    paidInstallments: 22,
    pendingInstallments: 86,
    budgetExpenseId: 'exp-ot-camioneta',
    cutDate: '2026-09-26',
  }

  return { bolsa, movements }
}
