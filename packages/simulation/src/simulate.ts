import { buildSchedule, maxPrincipalForInstallment, type AmortizationSystem, type Installment, type MonthlyCharges, type ScheduleTotals } from './amortization';
import { buildConstructionFlow, type ConstructionFlow } from './construction-flow';
import { ageInMonths, compareIsoDates } from './dates';
import { parseSimulationInput, type Proponent, type SimulationInput } from './input';
import { floorCents, roundCents } from './money';
import { parseSimulationParameters, type CreditLine, type SimulationParameters } from './params';
import { toRates, type Rates } from './rates';

/** Quanto acima da parcela desejada ainda conta como "pouca diferença" (ex.: 2.000 → até 2.300). */
export const DESIRED_INSTALLMENT_TOLERANCE_RATIO = 0.15;

export type Verdict = 'VIAVEL' | 'VIAVEL_COM_AJUSTES' | 'INVIAVEL';

export type IneligibilityReason =
  | 'INCOME_ABOVE_LIMIT'
  | 'PROPERTY_VALUE_ABOVE_LIMIT'
  | 'NOT_FIRST_FINANCING'
  | 'OWNS_PROPERTY';

export type VerdictReason =
  | 'NO_ELIGIBLE_LINE'
  /** parcela_max ≤ 0 (dívidas consomem a capacidade) ou não cobre nem seguros/taxas. */
  | 'NO_PAYMENT_CAPACITY'
  /** Idade não permite nem o prazo mínimo da linha. */
  | 'AGE_LIMIT'
  | 'DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE'
  | 'DOWN_PAYMENT_SHORTFALL';

export type SuggestionCode =
  | 'INCREASE_DOWN_PAYMENT'
  | 'ADD_CO_APPLICANT'
  | 'LONGER_TERM'
  | 'SMALLER_UNIT'
  | 'PAY_OFF_DEBTS'
  | 'PLAN_DOWN_PAYMENT'
  | 'RETURN_LATER';

export interface Suggestion {
  code: SuggestionCode;
  /** Valor associado, quando houver (ex.: quanto falta de entrada). */
  amount?: number;
}

export type AlertCode =
  | 'ILLUSTRATIVE_PARAMETERS'
  | 'INFORMAL_INCOME'
  | 'AGE_LIMITS_TERM'
  | 'TERM_ADJUSTED'
  | 'SYSTEM_ADJUSTED'
  | 'HIGH_INCOME_COMMITMENT'
  | 'CO_APPLICANT_RECOMMENDED'
  | 'DOWN_PAYMENT_INSUFFICIENT'
  | 'FGTS_MIN_TIME_NOT_MET'
  | 'FGTS_NOT_ELIGIBLE'
  | 'CONSTRUCTION_INSTALLMENT_ABOVE_CAPACITY'
  /** Coube um pouco acima da parcela desejada (value = 1ª parcela). */
  | 'DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY'
  /** Não coube na parcela desejada: esta é a menor possível (value = 1ª parcela). */
  | 'DESIRED_INSTALLMENT_UNREACHABLE';

export interface Alert {
  code: AlertCode;
  value?: number;
}

export interface Capacity {
  familyIncome: number;
  monthlyDebts: number;
  commitmentLimit: number;
  /** parcela_max = renda × limite − dívidas (spec §4.1). */
  maxInstallment: number;
}

export interface TermInfo {
  months: number;
  min: number;
  max: number;
  /** Prazo máximo permitido pela idade (pode ser < min). */
  maxByAge: number;
  ageMonthsUsed: number;
  limitedByAge: boolean;
}

export interface FinancingResult {
  system: AmortizationSystem;
  rates: Rates;
  maxFinanceableByLtv: number;
  maxFinanceableByInstallment: number;
  /** valor_financiavel = MIN(cota, o que cabe na parcela) (spec §4.2). */
  maxFinanceable: number;
  limitingFactor: 'LTV' | 'INSTALLMENT';
  financedAmount: number;
  subsidy: number;
  fgtsAvailable: number;
  fgtsUsed: number;
  /** Entrada mínima em dinheiro (spec §4.3). */
  requiredDownPayment: number;
  availableDownPayment: number;
  /** Entrada que efetivamente compõe o negócio (mínima, ou toda a disponível se pedido). */
  downPaymentUsed: number;
  shortfall: number;
  /** null quando nada é financiado. */
  firstInstallment: Installment | null;
  lastInstallment: Installment | null;
  totals: ScheduleTotals | null;
  /** (1ª parcela + dívidas) / renda familiar. */
  incomeCommitment: number | null;
  constructionFlow: ConstructionFlow | null;
}

export interface LineResult {
  lineId: string;
  lineName: string;
  priority: number;
  eligible: boolean;
  ineligibilityReasons: IneligibilityReason[];
  verdict: Verdict;
  reasons: VerdictReason[];
  suggestions: Suggestion[];
  alerts: Alert[];
  capacity: Capacity | null;
  term: TermInfo | null;
  financing: FinancingResult | null;
}

export interface SimulationResult {
  parametersVersion: string;
  parametersStatus: SimulationParameters['status'];
  referenceDate: string;
  propertyValue: number;
  verdict: Verdict;
  reasons: VerdictReason[];
  suggestions: Suggestion[];
  alerts: Alert[];
  /** Linha escolhida (melhor parecer; empate → menor prioridade). null se nenhuma elegível. */
  selected: LineResult | null;
  lines: LineResult[];
}

export class ParametersNotInForceError extends Error {
  constructor(version: string, referenceDate: string) {
    super(`parâmetros ${version} não estão vigentes em ${referenceDate}`);
    this.name = 'ParametersNotInForceError';
  }
}

const VERDICT_RANK: Record<Verdict, number> = { VIAVEL: 0, VIAVEL_COM_AJUSTES: 1, INVIAVEL: 2 };

function proponentsOf(input: SimulationInput): Proponent[] {
  return input.coApplicant ? [input.applicant, input.coApplicant] : [input.applicant];
}

function checkEligibility(line: CreditLine, input: SimulationInput, familyIncome: number): IneligibilityReason[] {
  const e = line.eligibility;
  const reasons: IneligibilityReason[] = [];
  if (e.maxFamilyIncome !== null && familyIncome > e.maxFamilyIncome) reasons.push('INCOME_ABOVE_LIMIT');
  if (e.maxPropertyValue !== null && input.propertyValue > e.maxPropertyValue) reasons.push('PROPERTY_VALUE_ABOVE_LIMIT');
  if (e.requiresFirstFinancing && !input.firstFinancing) reasons.push('NOT_FIRST_FINANCING');
  if (e.requiresNoOwnedProperty && input.ownsResidentialProperty) reasons.push('OWNS_PROPERTY');
  return reasons;
}

function subsidyFor(line: CreditLine, input: SimulationInput, familyIncome: number): number {
  const s = line.subsidy;
  if (!s) return 0;
  if (s.maxPropertyValue !== null && input.propertyValue > s.maxPropertyValue) return 0;
  const band = s.bands.find((b) => familyIncome <= b.maxFamilyIncome);
  return band ? band.amount : 0;
}

/** FGTS utilizável na entrada (RF-21): soma dos saldos de quem cumpre o tempo mínimo. */
function fgtsFor(line: CreditLine, input: SimulationInput, alerts: Alert[]): number {
  const withBalance = proponentsOf(input).filter((p) => p.fgts && p.fgts.balance > 0);
  if (withBalance.length === 0) return 0;
  const rule = line.fgts;
  const blocked =
    !rule.allowed ||
    (rule.requiresNoOwnedProperty && input.ownsResidentialProperty) ||
    (rule.maxPropertyValue !== null && input.propertyValue > rule.maxPropertyValue);
  if (blocked) {
    alerts.push({ code: 'FGTS_NOT_ELIGIBLE' });
    return 0;
  }
  let total = 0;
  for (const p of withBalance) {
    if (p.fgts!.contributionMonths >= rule.minContributionMonths) total += p.fgts!.balance;
    else alerts.push({ code: 'FGTS_MIN_TIME_NOT_MET', value: rule.minContributionMonths });
  }
  return total;
}

function mipRateFor(line: CreditLine, ageMonths: number): number {
  const ageYears = Math.floor(ageMonths / 12);
  const bands = line.insurance.mipMonthlyRateByAge;
  // Acima da última faixa, usa a última (a idade máxima da linha já limita o prazo).
  return (bands.find((b) => ageYears <= b.upToAgeYears) ?? bands[bands.length - 1]!).monthlyRate;
}

function termFor(line: CreditLine, input: SimulationInput, alerts: Alert[]): TermInfo {
  const ages = proponentsOf(input).map((p) => ageInMonths(p.birthDate, input.referenceDate));
  const ageMonthsUsed = line.ageRule === 'OLDEST' ? Math.max(...ages) : Math.min(...ages);
  const { min, max } = line.termMonths;
  const maxByAge = line.maxAgeAtEndMonths - ageMonthsUsed;
  const wanted = input.desiredTermMonths ?? max;
  const upper = Math.min(max, maxByAge);
  let months = Math.min(Math.max(wanted, min), upper);
  if (input.desiredTermMonths !== undefined && (wanted < min || wanted > max)) {
    alerts.push({ code: 'TERM_ADJUSTED', value: months });
  }
  const limitedByAge = maxByAge < Math.min(wanted, max);
  if (limitedByAge && maxByAge >= min) alerts.push({ code: 'AGE_LIMITS_TERM', value: maxByAge });
  if (months < min) months = min; // só ocorre se maxByAge < min → parecer AGE_LIMIT
  return { months, min, max, maxByAge, ageMonthsUsed, limitedByAge };
}

function evaluateLine(line: CreditLine, input: SimulationInput, params: SimulationParameters): LineResult {
  const proponents = proponentsOf(input);
  const familyIncome = proponents.reduce((s, p) => s + p.grossMonthlyIncome, 0);
  const monthlyDebts = proponents.reduce((s, p) => s + p.monthlyDebts, 0);
  const base = { lineId: line.id, lineName: line.name, priority: line.priority };

  const ineligibilityReasons = checkEligibility(line, input, familyIncome);
  if (ineligibilityReasons.length > 0) {
    return {
      ...base,
      eligible: false,
      ineligibilityReasons,
      verdict: 'INVIAVEL',
      reasons: ['NO_ELIGIBLE_LINE'],
      suggestions: [],
      alerts: [],
      capacity: null,
      term: null,
      financing: null,
    };
  }

  const alerts: Alert[] = [];
  const reasons: VerdictReason[] = [];
  const suggestions: Suggestion[] = [];
  const hasCoApplicant = input.coApplicant !== null;

  const capacity: Capacity = {
    familyIncome,
    monthlyDebts,
    commitmentLimit: line.maxIncomeCommitment,
    maxInstallment: roundCents(familyIncome * line.maxIncomeCommitment - monthlyDebts),
  };
  const term = termFor(line, input, alerts);

  let system = input.system ?? params.defaultSystem;
  if (!line.systems.includes(system)) {
    system = line.systems[0]!;
    alerts.push({ code: 'SYSTEM_ADJUSTED' });
  }
  const rates = toRates(line.annualInterestRate, line.rateConvention);
  const charges: MonthlyCharges = {
    mipMonthlyRate: mipRateFor(line, term.ageMonthsUsed),
    dfiMonthly: input.propertyValue * line.insurance.dfiMonthlyRate,
    feesMonthly: line.adminFeeMonthly + line.otherMonthlyFees.reduce((s, f) => s + f.amount, 0),
  };

  const ageBlocked = term.maxByAge < term.min;
  const maxByLtv = floorCents(input.propertyValue * line.maxLtv);
  const maxByInstallment =
    capacity.maxInstallment > 0 && !ageBlocked
      ? maxPrincipalForInstallment(system, capacity.maxInstallment, rates.monthly, term.months, charges)
      : 0;
  let maxFinanceable = Math.min(maxByLtv, maxByInstallment);
  const limitingFactor = maxByLtv <= maxByInstallment ? 'LTV' : 'INSTALLMENT';

  // Fontes que não são financiamento, nesta ordem: subsídio, FGTS, dinheiro (spec §4.3).
  const subsidyAvailable = subsidyFor(line, input, familyIncome);
  const fgtsAvailable = fgtsFor(line, input, alerts);
  const subsidy = Math.min(subsidyAvailable, input.propertyValue);
  const fgtsUsed = Math.min(fgtsAvailable, input.propertyValue - subsidy);
  const toFinanceOrPay = roundCents(input.propertyValue - subsidy - fgtsUsed);
  // Parcela desejada: um teto. Tenta nela, depois um pouco acima; se nem assim couber, usa toda a
  // entrada disponível para chegar na menor parcela possível.
  let desired: 'WITHIN' | 'SLIGHTLY_ABOVE' | 'UNREACHABLE' | null = null;
  let useFullDownPayment = input.useFullDownPayment;
  const wish = input.desiredInstallment;
  if (wish !== undefined && wish < capacity.maxInstallment && !ageBlocked && capacity.maxInstallment > 0) {
    const attempts = [
      [wish, 'WITHIN'],
      [wish * (1 + DESIRED_INSTALLMENT_TOLERANCE_RATIO), 'SLIGHTLY_ABOVE'],
    ] as const;
    for (const [cap, outcome] of attempts) {
      const principal = Math.min(maxByLtv, maxPrincipalForInstallment(system, Math.min(cap, capacity.maxInstallment), rates.monthly, term.months, charges));
      if (toFinanceOrPay - principal <= input.availableDownPayment) {
        maxFinanceable = principal;
        desired = outcome;
        break;
      }
    }
    if (!desired) {
      desired = 'UNREACHABLE';
      useFullDownPayment = true;
    }
  }
  const requiredDownPayment = roundCents(Math.max(0, toFinanceOrPay - maxFinanceable));
  const shortfall = roundCents(Math.max(0, requiredDownPayment - input.availableDownPayment));
  const downPaymentUsed = useFullDownPayment
    ? roundCents(Math.max(requiredDownPayment, Math.min(input.availableDownPayment, toFinanceOrPay)))
    : requiredDownPayment;
  const financedAmount = roundCents(toFinanceOrPay - downPaymentUsed);

  let verdict: Verdict;
  if (capacity.maxInstallment <= 0 || (maxByInstallment === 0 && !ageBlocked)) {
    verdict = 'INVIAVEL';
    reasons.push('NO_PAYMENT_CAPACITY');
    if (monthlyDebts > 0) suggestions.push({ code: 'PAY_OFF_DEBTS' });
    if (!hasCoApplicant) suggestions.push({ code: 'ADD_CO_APPLICANT' });
    suggestions.push({ code: 'SMALLER_UNIT' }, { code: 'RETURN_LATER' });
  } else if (ageBlocked) {
    verdict = 'INVIAVEL';
    reasons.push('AGE_LIMIT');
    if (!hasCoApplicant) suggestions.push({ code: 'ADD_CO_APPLICANT' });
    suggestions.push({ code: 'SMALLER_UNIT' });
  } else if (shortfall === 0) {
    verdict = 'VIAVEL';
  } else {
    const withinTolerance = shortfall <= requiredDownPayment * params.adjustmentToleranceRatio;
    verdict = withinTolerance ? 'VIAVEL_COM_AJUSTES' : 'INVIAVEL';
    reasons.push(withinTolerance ? 'DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE' : 'DOWN_PAYMENT_SHORTFALL');
    alerts.push({ code: 'DOWN_PAYMENT_INSUFFICIENT', value: shortfall });
    suggestions.push({ code: withinTolerance ? 'INCREASE_DOWN_PAYMENT' : 'PLAN_DOWN_PAYMENT', amount: shortfall });
    if (limitingFactor === 'INSTALLMENT') {
      if (!hasCoApplicant) {
        suggestions.push({ code: 'ADD_CO_APPLICANT' });
        alerts.push({ code: 'CO_APPLICANT_RECOMMENDED' });
      }
      if (term.months < Math.min(term.max, term.maxByAge)) suggestions.push({ code: 'LONGER_TERM' });
    }
    suggestions.push({ code: 'SMALLER_UNIT' });
  }

  let firstInstallment: Installment | null = null;
  let lastInstallment: Installment | null = null;
  let totals: ScheduleTotals | null = null;
  let incomeCommitment: number | null = null;
  const computable = reasons[0] !== 'NO_PAYMENT_CAPACITY' && reasons[0] !== 'AGE_LIMIT';
  if (computable && financedAmount > 0) {
    const schedule = buildSchedule(system, financedAmount, rates.monthly, term.months, charges);
    firstInstallment = schedule.installments[0]!;
    lastInstallment = schedule.installments[schedule.installments.length - 1]!;
    totals = schedule.totals;
    incomeCommitment = (firstInstallment.total + monthlyDebts) / familyIncome;
    if (desired === 'SLIGHTLY_ABOVE') alerts.push({ code: 'DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY', value: firstInstallment.total });
    if (desired === 'UNREACHABLE') alerts.push({ code: 'DESIRED_INSTALLMENT_UNREACHABLE', value: firstInstallment.total });
    if (incomeCommitment >= line.maxIncomeCommitment * params.highCommitmentAlertRatio) {
      alerts.push({ code: 'HIGH_INCOME_COMMITMENT', value: incomeCommitment });
    }
  }

  let constructionFlow: ConstructionFlow | null = null;
  if (input.construction && computable) {
    constructionFlow = buildConstructionFlow(input.construction, input.referenceDate, downPaymentUsed, {
      financed: financedAmount,
      fgts: roundCents(fgtsUsed),
      subsidy: roundCents(subsidy),
    });
    if (constructionFlow.monthly.amount > capacity.maxInstallment) {
      alerts.push({ code: 'CONSTRUCTION_INSTALLMENT_ABOVE_CAPACITY', value: constructionFlow.monthly.amount });
    }
  }

  return {
    ...base,
    eligible: true,
    ineligibilityReasons: [],
    verdict,
    reasons,
    suggestions,
    alerts,
    capacity,
    term,
    financing: {
      system,
      rates,
      maxFinanceableByLtv: maxByLtv,
      maxFinanceableByInstallment: maxByInstallment,
      maxFinanceable,
      limitingFactor,
      financedAmount,
      subsidy: roundCents(subsidy),
      fgtsAvailable: roundCents(fgtsAvailable),
      fgtsUsed: roundCents(fgtsUsed),
      requiredDownPayment,
      availableDownPayment: input.availableDownPayment,
      downPaymentUsed,
      shortfall,
      firstInstallment,
      lastInstallment,
      totals,
      incomeCommitment,
      constructionFlow,
    },
  };
}

function compareLines(a: LineResult, b: LineResult): number {
  return VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.priority - b.priority;
}

/**
 * Simulação completa (RF-15 a RF-24). Função pura: sem I/O e sem relógio; mesma entrada e
 * mesmos parâmetros → mesmo resultado. Valida entrada e parâmetros (lança erro tipado).
 */
export function simulate(rawInput: unknown, rawParams: unknown): SimulationResult {
  const params = parseSimulationParameters(rawParams);
  const input = parseSimulationInput(rawInput);
  if (
    compareIsoDates(input.referenceDate, params.validFrom) < 0 ||
    (params.validTo !== null && compareIsoDates(input.referenceDate, params.validTo) > 0)
  ) {
    throw new ParametersNotInForceError(params.version, input.referenceDate);
  }

  const lines = [...params.creditLines]
    .sort((a, b) => a.priority - b.priority)
    .map((line) => evaluateLine(line, input, params));
  const selected = lines.filter((l) => l.eligible).sort(compareLines)[0] ?? null;

  const general: Alert[] = [];
  if (params.status === 'ILUSTRATIVO') general.push({ code: 'ILLUSTRATIVE_PARAMETERS' });
  if (proponentsOf(input).some((p) => params.informalIncomeTypes.includes(p.incomeType))) {
    general.push({ code: 'INFORMAL_INCOME' });
  }

  return {
    parametersVersion: params.version,
    parametersStatus: params.status,
    referenceDate: input.referenceDate,
    propertyValue: input.propertyValue,
    verdict: selected?.verdict ?? 'INVIAVEL',
    reasons: selected?.reasons ?? ['NO_ELIGIBLE_LINE'],
    suggestions: selected?.suggestions ?? [{ code: 'SMALLER_UNIT' }, { code: 'RETURN_LATER' }],
    alerts: [...general, ...(selected?.alerts ?? [])],
    selected,
    lines,
  };
}
