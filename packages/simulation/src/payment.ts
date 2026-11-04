import { buildDownPaymentPlan, buildUpfrontPlan, type DesiredInstallmentOutcome, type DownPaymentPlan } from './down-payment-plan';
import { compareIsoDates } from './dates';
import { fromCents, roundCents, toCents } from './money';
import { parsePaymentInput, type FinancingProfile, type PaymentInput } from './payment-input';
import { ParametersNotInForceError, simulate, type SimulationResult, type Verdict } from './simulate';
import { parseSalesCondition, offeredModes, type PaymentMode, type SalesCondition } from './sales-condition';

export type PaymentReason =
  | 'DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE'
  | 'DOWN_PAYMENT_SHORTFALL'
  /** A renda não comporta nem a menor mensal que a condição aceita. */
  | 'NO_PAYMENT_CAPACITY';

export type PaymentSuggestionCode =
  | 'INCREASE_DOWN_PAYMENT'
  | 'PLAN_DOWN_PAYMENT'
  | 'ADD_CO_APPLICANT'
  | 'ACCEPT_BALLOONS'
  | 'CONSIDER_INSTALLMENTS'
  | 'PAY_OFF_DEBTS'
  | 'SMALLER_UNIT'
  | 'RETURN_LATER';

export interface PaymentSuggestion {
  code: PaymentSuggestionCode;
  amount?: number;
}

export type PaymentAlertCode =
  | 'ILLUSTRATIVE_CONDITION'
  /** O valor pedido ficou fora de [mínima, máxima] e foi ajustado (value = entrada usada). */
  | 'DOWN_PAYMENT_ADJUSTED'
  /** A entrega já aconteceu (ou é este mês): sem mensais nem reforços. */
  | 'NO_TIME_FOR_INSTALLMENTS'
  /** Parcelas corrigidas pelo índice da condição (informativo). */
  | 'CORRECTION_APPLIES'
  | 'HIGH_INCOME_COMMITMENT'
  | 'DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY'
  | 'DESIRED_INSTALLMENT_UNREACHABLE'
  | 'BANK_ESTIMATE_NEEDS_ADJUSTMENTS'
  | 'BANK_ESTIMATE_NOT_VIABLE'
  /** Parâmetros bancários não vigentes na data: a estimativa foi omitida. */
  | 'BANK_ESTIMATE_UNAVAILABLE';

export interface PaymentAlert {
  code: PaymentAlertCode;
  value?: number;
}

export interface PaymentResult {
  mode: PaymentMode;
  conditionVersion: string;
  conditionStatus: SalesCondition['status'];
  referenceDate: string;
  unitPrice: number;
  verdict: Verdict;
  reasons: PaymentReason[];
  suggestions: PaymentSuggestion[];
  alerts: PaymentAlert[];
  /** Modo 1. */
  cash: { discountRatio: number; discount: number; amountToPay: number } | null;
  /** Modos 2 e 3. */
  downPayment: { min: number; max: number; chosen: number; cashNow: number; shortfall: number } | null;
  plan: DownPaymentPlan | null;
  /** Preço − entrada: o que vai para o financiamento nas chaves (modos 2 e 3). */
  balanceAtKeys: number | null;
  /** Modo 3. */
  capacity: {
    familyIncome: number;
    monthlyDebts: number;
    commitmentLimit: number;
    maxMonthly: number;
    /** (maior mensal + dívidas) / renda. */
    incomeCommitment: number | null;
  } | null;
  desiredInstallment: DesiredInstallmentOutcome | null;
  /** Estimativa do banco sobre o saldo (reaproveita o `simulate()`), se ligada e com perfil. */
  bankEstimate: SimulationResult | null;
}

export class SalesConditionNotInForceError extends Error {
  constructor(version: string, referenceDate: string) {
    super(`condição comercial ${version} não está vigente em ${referenceDate}`);
    this.name = 'SalesConditionNotInForceError';
  }
}

export class PaymentModeNotOfferedError extends Error {
  constructor(mode: PaymentMode, version: string) {
    super(`a condição ${version} não oferece o modo ${mode}`);
    this.name = 'PaymentModeNotOfferedError';
  }
}

function bankEstimateFor(
  financing: FinancingProfile | null | undefined,
  condition: SalesCondition,
  bankParams: unknown,
  input: PaymentInput,
  downPaymentC: number,
  alerts: PaymentAlert[],
): SimulationResult | null {
  if (!condition.bankEstimate.enabled || !financing || bankParams === undefined) return null;
  try {
    const result = simulate(
      {
        referenceDate: input.referenceDate,
        propertyValue: input.unitPrice,
        applicant: financing.applicant,
        coApplicant: financing.coApplicant,
        availableDownPayment: fromCents(downPaymentC),
        ownsResidentialProperty: financing.ownsResidentialProperty,
        firstFinancing: financing.firstFinancing,
        system: financing.system,
        desiredTermMonths: financing.desiredTermMonths,
        // Na entrega a entrada inteira já foi paga: financia só o saldo.
        useFullDownPayment: true,
      },
      bankParams,
    );
    if (result.verdict === 'INVIAVEL') alerts.push({ code: 'BANK_ESTIMATE_NOT_VIABLE' });
    else if (result.verdict === 'VIAVEL_COM_AJUSTES') alerts.push({ code: 'BANK_ESTIMATE_NEEDS_ADJUSTMENTS' });
    return result;
  } catch (error) {
    if (error instanceof ParametersNotInForceError) {
      alerts.push({ code: 'BANK_ESTIMATE_UNAVAILABLE' });
      return null;
    }
    throw error;
  }
}

function verdictFromShortfall(
  shortfallC: number,
  downPaymentC: number,
  tolerance: number,
): { verdict: Verdict; reasons: PaymentReason[] } {
  if (shortfallC === 0) return { verdict: 'VIAVEL', reasons: [] };
  const within = shortfallC <= downPaymentC * tolerance;
  return {
    verdict: within ? 'VIAVEL_COM_AJUSTES' : 'INVIAVEL',
    reasons: [within ? 'DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE' : 'DOWN_PAYMENT_SHORTFALL'],
  };
}

/**
 * Simulação de pagamento (V2) para os 3 modos. Função pura: sem I/O e sem relógio; mesma entrada,
 * condição e parâmetros bancários → mesmo resultado. Todas as regras vêm da condição comercial.
 * `bankParams` (opcional) são os parâmetros financeiros do `simulate()` para a estimativa do banco.
 */
export function simulatePayment(rawInput: unknown, rawCondition: unknown, bankParams?: unknown): PaymentResult {
  const condition = parseSalesCondition(rawCondition);
  const input = parsePaymentInput(rawInput);
  if (
    compareIsoDates(input.referenceDate, condition.validFrom) < 0 ||
    (condition.validTo !== null && compareIsoDates(input.referenceDate, condition.validTo) > 0)
  ) {
    throw new SalesConditionNotInForceError(condition.version, input.referenceDate);
  }
  if (!offeredModes(condition).includes(input.mode)) throw new PaymentModeNotOfferedError(input.mode, condition.version);

  const alerts: PaymentAlert[] = [];
  if (condition.status === 'ILUSTRATIVO') alerts.push({ code: 'ILLUSTRATIVE_CONDITION' });
  const base = {
    mode: input.mode,
    conditionVersion: condition.version,
    conditionStatus: condition.status,
    referenceDate: input.referenceDate,
    unitPrice: input.unitPrice,
  };
  const empty = {
    cash: null,
    downPayment: null,
    plan: null,
    balanceAtKeys: null,
    capacity: null,
    desiredInstallment: null,
    bankEstimate: null,
  } satisfies Partial<PaymentResult>;

  if (input.mode === 'A_VISTA') {
    const amountToPay = roundCents(input.unitPrice * (1 - condition.cash.discountRatio));
    return {
      ...base,
      ...empty,
      verdict: 'VIAVEL',
      reasons: [],
      suggestions: [],
      alerts,
      cash: {
        discountRatio: condition.cash.discountRatio,
        discount: roundCents(input.unitPrice - amountToPay),
        amountToPay,
      },
    };
  }

  // Entrada: a maior entre a mínima e a desejada, limitada à máxima (modos 2 e 3).
  const minC = toCents(input.unitPrice * condition.downPayment.minRatio);
  const maxC = toCents(input.unitPrice * condition.downPayment.maxRatio);
  const wantedC = input.desiredDownPayment === undefined ? minC : toCents(input.desiredDownPayment);
  const downC = Math.min(maxC, Math.max(minC, wantedC));
  if (input.desiredDownPayment !== undefined && downC !== wantedC) {
    alerts.push({ code: 'DOWN_PAYMENT_ADJUSTED', value: fromCents(downC) });
  }
  const cashC = toCents(input.cashNow);
  if (condition.installments.correction.index !== 'NENHUM') alerts.push({ code: 'CORRECTION_APPLIES' });
  const down = fromCents(downC);
  const balanceAtKeys = roundCents(input.unitPrice - down);
  const suggestions: PaymentSuggestion[] = [];

  if (input.mode === 'ENTRADA_A_VISTA') {
    const shortfallC = Math.max(0, downC - cashC);
    const { verdict, reasons } = verdictFromShortfall(shortfallC, downC, condition.adjustmentToleranceRatio);
    if (shortfallC > 0) {
      const shortfall = fromCents(shortfallC);
      suggestions.push({ code: verdict === 'INVIAVEL' ? 'PLAN_DOWN_PAYMENT' : 'INCREASE_DOWN_PAYMENT', amount: shortfall });
      if (condition.installments.enabled) suggestions.push({ code: 'CONSIDER_INSTALLMENTS' });
      suggestions.push({ code: 'SMALLER_UNIT' });
    }
    const bankEstimate = bankEstimateFor(input.financing, condition, bankParams, input, downC, alerts);
    return {
      ...base,
      ...empty,
      verdict,
      reasons,
      suggestions,
      alerts,
      downPayment: { min: fromCents(minC), max: fromCents(maxC), chosen: down, cashNow: input.cashNow, shortfall: fromCents(shortfallC) },
      plan: buildUpfrontPlan(input.referenceDate, input.deliveryDate, down),
      balanceAtKeys,
      bankEstimate,
    };
  }

  // Modo 3: entrada parcelada com a construtora.
  const rules = condition.installments;
  const familyIncome = input.buyers.reduce((s, b) => s + b.grossMonthlyIncome, 0);
  const monthlyDebts = input.buyers.reduce((s, b) => s + b.monthlyDebts, 0);
  const maxMonthlyC = Math.max(0, toCents(familyIncome * rules.maxIncomeCommitment - monthlyDebts));
  const maxMonthly = fromCents(maxMonthlyC);

  const built = buildDownPaymentPlan({
    condition,
    referenceDate: input.referenceDate,
    deliveryDate: input.deliveryDate,
    downPayment: down,
    cashNow: input.cashNow,
    maxMonthly,
    desiredInstallment: input.desiredInstallment,
    acceptsBalloons: input.acceptsBalloons,
  });
  const { plan } = built;
  const shortfallC = toCents(built.shortfall);
  const { verdict, reasons } = verdictFromShortfall(shortfallC, downC, condition.adjustmentToleranceRatio);

  const peakMonthly = Math.max(plan.monthly.amount, plan.monthly.lastAmount);
  const incomeCommitment = plan.monthly.count > 0 ? (peakMonthly + monthlyDebts) / familyIncome : null;
  if (built.monthlyCountLimit === 0) alerts.push({ code: 'NO_TIME_FOR_INSTALLMENTS' });
  if (incomeCommitment !== null && incomeCommitment >= rules.maxIncomeCommitment * rules.highCommitmentAlertRatio) {
    alerts.push({ code: 'HIGH_INCOME_COMMITMENT', value: incomeCommitment });
  }
  if (built.desired === 'SLIGHTLY_ABOVE') alerts.push({ code: 'DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY', value: peakMonthly });
  if (built.desired === 'UNREACHABLE') alerts.push({ code: 'DESIRED_INSTALLMENT_UNREACHABLE', value: peakMonthly });

  if (built.monthlyCountLimit > 0 && maxMonthlyC < toCents(rules.monthly.minAmount) && verdict === 'INVIAVEL') {
    reasons.unshift('NO_PAYMENT_CAPACITY');
    if (monthlyDebts > 0) suggestions.push({ code: 'PAY_OFF_DEBTS' });
  }
  if (shortfallC > 0) {
    suggestions.push({ code: verdict === 'INVIAVEL' ? 'PLAN_DOWN_PAYMENT' : 'INCREASE_DOWN_PAYMENT', amount: built.shortfall });
    if (built.actRaisedForCapacity) {
      if (input.buyers.length === 1) suggestions.push({ code: 'ADD_CO_APPLICANT' });
      if (!input.acceptsBalloons && rules.balloons) suggestions.push({ code: 'ACCEPT_BALLOONS' });
    }
    suggestions.push({ code: 'SMALLER_UNIT' });
    if (verdict === 'INVIAVEL') suggestions.push({ code: 'RETURN_LATER' });
  }

  const bankEstimate = bankEstimateFor(input.financing, condition, bankParams, input, downC, alerts);
  return {
    ...base,
    ...empty,
    verdict,
    reasons,
    suggestions,
    alerts,
    downPayment: { min: fromCents(minC), max: fromCents(maxC), chosen: down, cashNow: input.cashNow, shortfall: built.shortfall },
    plan,
    balanceAtKeys,
    capacity: { familyIncome, monthlyDebts, commitmentLimit: rules.maxIncomeCommitment, maxMonthly, incomeCommitment },
    desiredInstallment: input.desiredInstallment === undefined ? null : built.desired,
    bankEstimate,
  };
}
