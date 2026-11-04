import type { PaymentInput, SalesCondition } from '../src';

/**
 * Condição de "conta redonda" para casos conferíveis à mão: entrada mínima 20%, ato mínimo 10% da
 * entrada, chaves 5%, até 36 mensais de no mínimo R$ 300, reforços semestrais até 30%, sem juros.
 */
export function simpleCondition(overrides: Partial<SalesCondition> = {}): SalesCondition {
  return {
    version: 'teste-v1',
    status: 'VALIDADO',
    validFrom: '2026-01-01',
    validTo: null,
    adjustmentToleranceRatio: 0.1,
    cash: { enabled: true, discountRatio: 0.08 },
    downPayment: { minRatio: 0.2, maxRatio: 0.5 },
    upfront: { enabled: true },
    installments: {
      enabled: true,
      act: { minRatio: 0.1, minAmount: 5000 },
      monthly: { maxCount: 36, minAmount: 300, monthlyInterestRate: 0 },
      balloons: { intervalMonths: 6, maxRatio: 0.3 },
      keysRatio: 0.05,
      maxIncomeCommitment: 0.3,
      highCommitmentAlertRatio: 0.9,
      desiredInstallmentToleranceRatio: 0.15,
      correction: { index: 'NENHUM', projectedMonthlyRate: null },
    },
    bankEstimate: { enabled: true },
    ...overrides,
  };
}

export function withInstallments(patch: Partial<SalesCondition['installments']>): SalesCondition {
  const base = simpleCondition();
  return { ...base, installments: { ...base.installments, ...patch } };
}

export const PAY_REF_DATE = '2026-11-04';
/** 24 meses até as chaves → mensais nos meses 1..23. */
export const DELIVERY_24 = '2028-11-04';

type InstallmentInput = Extract<PaymentInput, { mode: 'ENTRADA_PARCELADA' }>;

export function installmentInput(overrides: Partial<InstallmentInput> = {}): InstallmentInput {
  return {
    mode: 'ENTRADA_PARCELADA',
    referenceDate: PAY_REF_DATE,
    unitPrice: 300000,
    deliveryDate: DELIVERY_24,
    cashNow: 6000,
    buyers: [{ grossMonthlyIncome: 10000, monthlyDebts: 0 }],
    acceptsBalloons: false,
    ...overrides,
  };
}
