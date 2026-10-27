import type { CreditLine, SimulationInput, SimulationParameters } from '../src';

/**
 * Linha "de conta redonda" para casos conferíveis à mão: 12% a.a. nominal = 1% a.m.,
 * sem seguros nem taxas, cota 80%, comprometimento 30%, prazo 120–360, idade máx. 80 anos.
 */
export function simpleLine(overrides: Partial<CreditLine> = {}): CreditLine {
  return {
    id: 'linha-teste',
    name: 'Linha de teste',
    priority: 1,
    eligibility: { maxFamilyIncome: null, maxPropertyValue: null, requiresFirstFinancing: false, requiresNoOwnedProperty: false },
    maxLtv: 0.8,
    annualInterestRate: 0.12,
    rateConvention: 'NOMINAL',
    maxIncomeCommitment: 0.3,
    termMonths: { min: 120, max: 360 },
    maxAgeAtEndMonths: 960,
    ageRule: 'OLDEST',
    systems: ['SAC', 'PRICE'],
    insurance: { mipMonthlyRateByAge: [{ upToAgeYears: 80, monthlyRate: 0 }], dfiMonthlyRate: 0 },
    adminFeeMonthly: 0,
    otherMonthlyFees: [],
    subsidy: null,
    fgts: { allowed: true, minContributionMonths: 36, maxPropertyValue: null, requiresNoOwnedProperty: true },
    ...overrides,
  };
}

export function simpleParams(lines: CreditLine[] = [simpleLine()], overrides: Partial<SimulationParameters> = {}): SimulationParameters {
  return {
    version: 'teste-v1',
    status: 'VALIDADO',
    validFrom: '2026-01-01',
    validTo: null,
    defaultSystem: 'SAC',
    adjustmentToleranceRatio: 0.1,
    highCommitmentAlertRatio: 0.9,
    informalIncomeTypes: ['AUTONOMO', 'OUTROS'],
    creditLines: lines,
    ...overrides,
  };
}

export const REF_DATE = '2026-10-26';

/** Data de nascimento para a idade (anos completos) na REF_DATE. */
export function bornYearsAgo(years: number): string {
  return `${2026 - years}-10-26`;
}

export function baseInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    referenceDate: REF_DATE,
    propertyValue: 250000,
    applicant: {
      birthDate: bornYearsAgo(30),
      grossMonthlyIncome: 10000,
      incomeType: 'CLT',
      monthlyDebts: 0,
      fgts: null,
    },
    coApplicant: null,
    availableDownPayment: 60000,
    ownsResidentialProperty: false,
    firstFinancing: true,
    ...overrides,
  };
}
