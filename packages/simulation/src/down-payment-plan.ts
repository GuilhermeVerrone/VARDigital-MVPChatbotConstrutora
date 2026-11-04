import { priceFactor } from './amortization';
import { fullMonthsBetween } from './dates';
import { fromCents, roundCents, toCents } from './money';
import type { CorrectionIndex, SalesCondition } from './sales-condition';

// Plano da entrada (modo 3): ato, mensais até as chaves, reforços e parcela de chaves. Tudo em
// centavos inteiros: ato + principal das mensais + reforços + chaves = entrada, sempre exato.
// Nenhuma regra de negócio mora aqui: tetos, pisos, juros e tolerâncias vêm da condição comercial.

export type DesiredInstallmentOutcome = 'NONE' | 'WITHIN' | 'SLIGHTLY_ABOVE' | 'UNREACHABLE';

export interface CorrectionProjection {
  index: CorrectionIndex;
  monthlyRate: number;
  /** Total da entrada se os pagamentos futuros forem corrigidos pela taxa projetada. */
  projectedTotal: number;
  projectedIncrease: number;
}

export interface DownPaymentPlan {
  /** Entrada em valores nominais (sem juros nem correção). */
  total: number;
  monthsUntilDelivery: number;
  /** Ato (sinal), pago hoje. */
  act: number;
  monthly: {
    count: number;
    /** Parcela regular (principal + juros). */
    amount: number;
    /** Última parcela: quita o saldo exato. */
    lastAmount: number;
    /** Parte da entrada paga pelas mensais. */
    principal: number;
    interest: number;
    /** principal + juros. */
    total: number;
  };
  balloons: { count: number; amount: number; total: number; months: number[] };
  keys: { amount: number; month: number | null };
  interestTotal: number;
  /** Entrada + juros da construtora (sem correção). */
  totalPaid: number;
  /** null quando a condição não projeta (índice NENHUM ou taxa não informada). */
  correction: CorrectionProjection | null;
}

export interface DownPaymentPlanArgs {
  condition: SalesCondition;
  referenceDate: string;
  deliveryDate: string;
  /** Entrada total já definida (dentro de mínimo e máximo da condição). */
  downPayment: number;
  /** Dinheiro disponível hoje para o ato. */
  cashNow: number;
  /** Mensal máxima que a renda comporta (renda × limite − dívidas). */
  maxMonthly: number;
  desiredInstallment?: number | undefined;
  acceptsBalloons: boolean;
}

export interface DownPaymentPlanResult {
  plan: DownPaymentPlan;
  /** Quanto falta de dinheiro no ato para o plano caber. 0 = cabe. */
  shortfall: number;
  desired: DesiredInstallmentOutcome;
  /** O ato precisou subir acima do mínimo/dinheiro para a mensal caber. */
  actRaisedForCapacity: boolean;
  balloonsUsed: boolean;
  /** Mensais limitadas pelo prazo/teto da condição (e não pela renda). */
  monthlyCountLimit: number;
}

interface Monthly {
  amount: number;
  lastAmount: number;
  principal: number;
  interest: number;
  payments: number[];
}

/** Parcela regular em centavos (Price; sem juros, divisão truncada para a última absorver o resto). */
function regularPayment(principal: number, rate: number, count: number): number {
  const raw = principal * priceFactor(rate, count);
  return rate === 0 ? Math.floor(raw) : Math.round(raw);
}

function monthlySchedule(principal: number, rate: number, count: number): Monthly {
  if (count <= 0 || principal <= 0) return { amount: 0, lastAmount: 0, principal: 0, interest: 0, payments: [] };
  const pmt = regularPayment(principal, rate, count);
  const payments: number[] = [];
  let balance = principal;
  let interestTotal = 0;
  for (let k = 1; k <= count; k++) {
    const interest = Math.round(balance * rate);
    const amortization = k === count ? balance : Math.min(Math.max(pmt - interest, 0), balance);
    payments.push(amortization + interest);
    interestTotal += interest;
    balance -= amortization;
  }
  return { amount: payments[0]!, lastAmount: payments[count - 1]!, principal, interest: interestTotal, payments };
}

function peak(m: Monthly): number {
  return Math.max(m.amount, m.lastAmount);
}

function balloonMonthsFor(horizon: number, interval: number): number[] {
  const months: number[] = [];
  for (let m = interval; m <= horizon; m += interval) months.push(m);
  return months;
}

export function buildDownPaymentPlan(args: DownPaymentPlanArgs): DownPaymentPlanResult {
  const { condition, referenceDate, deliveryDate, acceptsBalloons } = args;
  const rules = condition.installments;
  const rate = rules.monthly.monthlyInterestRate;
  const minPaymentC = toCents(rules.monthly.minAmount);
  const downC = toCents(args.downPayment);
  const cashC = toCents(args.cashNow);
  const maxMonthlyC = Math.max(0, toCents(args.maxMonthly));

  const monthsUntilDelivery = Math.max(0, fullMonthsBetween(referenceDate, deliveryDate));
  // Mensais e reforços ocorrem nos meses 1..(entrega − 1); as chaves são pagas na entrega.
  const horizon = Math.max(0, monthsUntilDelivery - 1);
  const maxCount = Math.min(horizon, rules.monthly.maxCount);

  const keysC = monthsUntilDelivery >= 1 ? Math.floor(downC * rules.keysRatio) : 0;
  const actCeilingC = downC - keysC;
  const actMinC = Math.min(actCeilingC, Math.max(toCents(args.downPayment * rules.act.minRatio), toCents(rules.act.minAmount)));
  const act0C = Math.min(actCeilingC, Math.max(actMinC, cashC));

  const balloonMonths = rules.balloons && acceptsBalloons ? balloonMonthsFor(horizon, rules.balloons.intervalMonths) : [];
  const balloonCount = balloonMonths.length;
  const poolC = balloonCount > 0 ? Math.floor(downC * rules.balloons!.maxRatio) : 0;

  /** Maior n ≤ maxCount cuja parcela regular respeita o piso; 0 se nem uma parcela cabe. */
  const countFor = (principal: number): number => {
    for (let n = maxCount; n >= 1; n--) if (regularPayment(principal, rate, n) >= minPaymentC) return n;
    return 0;
  };

  /** Maior principal (e prazo) cuja mensal de pico cabe no teto, respeitando o piso da parcela. */
  const maxPrincipalFor = (capC: number): { principal: number; count: number } => {
    for (let n = maxCount; n >= 1; n--) {
      let p = Math.floor(capC / priceFactor(rate, n));
      while (p > 0 && peak(monthlySchedule(p, rate, n)) > capC) p--;
      if (p > 0 && regularPayment(p, rate, n) >= minPaymentC) return { principal: p, count: n };
    }
    return { principal: 0, count: 0 };
  };

  interface State {
    actC: number;
    balloonEachC: number;
    monthly: Monthly;
    count: number;
    raised: boolean;
  }

  const evaluate = (actC: number, balloonEachC: number, raised: boolean): State => {
    const remaining = downC - keysC - actC - balloonEachC * balloonCount;
    const count = countFor(remaining);
    // Sem mensal possível, o resto vai para o ato.
    const finalAct = count === 0 ? actC + remaining : actC;
    return { actC: finalAct, balloonEachC, monthly: monthlySchedule(count === 0 ? 0 : remaining, rate, count), count, raised };
  };

  const solve = (capC: number, forceBalloons: boolean): State => {
    const remaining0 = downC - keysC - act0C;
    const eachCap = balloonCount > 0 ? Math.min(Math.floor(poolC / balloonCount), Math.floor(remaining0 / balloonCount)) : 0;
    let state = evaluate(act0C, forceBalloons ? eachCap : 0, false);
    if (peak(state.monthly) <= capC) return state;

    // 1º: reforços (se o lead aceita), só o necessário para a mensal caber.
    if (eachCap > 0) {
      const need = remaining0 - maxPrincipalFor(capC).principal;
      const each = Math.min(eachCap, Math.max(state.balloonEachC, Math.ceil(need / balloonCount)));
      state = evaluate(act0C, each, false);
      if (peak(state.monthly) <= capC) return state;
    }

    // 2º/3º: o dinheiro já está todo no ato; calcula o ato necessário para a mensal caber.
    const balloonsC = state.balloonEachC * balloonCount;
    const ceilingC = downC - keysC - balloonsC;
    const needed = ceilingC - maxPrincipalFor(capC).principal;
    return evaluate(Math.min(ceilingC, Math.max(act0C, needed)), state.balloonEachC, true);
  };

  // Parcela desejada é um teto: tenta nela, depois um pouco acima; senão usa o máximo de reforços
  // e a renda como limite. Sem preferência, só a renda limita.
  const tiers: Array<{ capC: number; outcome: DesiredInstallmentOutcome; force: boolean }> = [];
  if (args.desiredInstallment !== undefined) {
    const wishC = toCents(args.desiredInstallment);
    const within = Math.min(wishC, maxMonthlyC);
    tiers.push({ capC: within, outcome: 'WITHIN', force: false });
    const above = Math.min(Math.floor(wishC * (1 + rules.desiredInstallmentToleranceRatio)), maxMonthlyC);
    if (above > within) tiers.push({ capC: above, outcome: 'SLIGHTLY_ABOVE', force: false });
    if (maxMonthlyC > Math.max(within, above)) tiers.push({ capC: maxMonthlyC, outcome: 'UNREACHABLE', force: true });
  } else {
    tiers.push({ capC: maxMonthlyC, outcome: 'NONE', force: false });
  }

  let chosen: { state: State; tier: (typeof tiers)[number] } | undefined;
  for (const tier of tiers) {
    chosen = { state: solve(tier.capC, tier.force), tier };
    if (chosen.state.actC <= cashC) break;
  }
  if (!chosen) throw new Error('nenhum cenário de parcela avaliado');

  const { state } = chosen;
  const balloonsTotalC = state.balloonEachC * balloonCount;
  const monthly = state.monthly;
  const interestC = monthly.interest;

  const paymentsByMonth: Array<[number, number]> = [];
  monthly.payments.forEach((p, i) => paymentsByMonth.push([i + 1, p]));
  if (balloonCount > 0 && state.balloonEachC > 0) balloonMonths.forEach((m) => paymentsByMonth.push([m, state.balloonEachC]));
  if (keysC > 0) paymentsByMonth.push([monthsUntilDelivery, keysC]);

  const { index, projectedMonthlyRate } = rules.correction;
  let correction: CorrectionProjection | null = null;
  if (index !== 'NENHUM' && projectedMonthlyRate !== null) {
    const futureC = paymentsByMonth.reduce((sum, [m, p]) => sum + toCents(roundCents(fromCents(p) * Math.pow(1 + projectedMonthlyRate, m))), 0);
    const projectedC = state.actC + futureC;
    correction = {
      index,
      monthlyRate: projectedMonthlyRate,
      projectedTotal: fromCents(projectedC),
      projectedIncrease: fromCents(projectedC - downC - interestC),
    };
  }

  const balloonsUsed = state.balloonEachC > 0;
  const plan: DownPaymentPlan = {
    total: fromCents(downC),
    monthsUntilDelivery,
    act: fromCents(state.actC),
    monthly: {
      count: state.count,
      amount: fromCents(monthly.amount),
      lastAmount: fromCents(monthly.lastAmount),
      principal: fromCents(monthly.principal),
      interest: fromCents(interestC),
      total: fromCents(monthly.principal + interestC),
    },
    balloons: {
      count: balloonsUsed ? balloonCount : 0,
      amount: fromCents(balloonsUsed ? state.balloonEachC : 0),
      total: fromCents(balloonsTotalC),
      months: balloonsUsed ? balloonMonths : [],
    },
    keys: { amount: fromCents(keysC), month: keysC > 0 ? monthsUntilDelivery : null },
    interestTotal: fromCents(interestC),
    totalPaid: fromCents(downC + interestC),
    correction,
  };

  return {
    plan,
    shortfall: fromCents(Math.max(0, state.actC - cashC)),
    desired: chosen.tier.outcome,
    actRaisedForCapacity: state.raised,
    balloonsUsed,
    monthlyCountLimit: maxCount,
  };
}

/** Modo 2: a entrada inteira no ato; o saldo vai para o financiamento nas chaves. */
export function buildUpfrontPlan(referenceDate: string, deliveryDate: string, downPayment: number): DownPaymentPlan {
  const downC = toCents(downPayment);
  return {
    total: fromCents(downC),
    monthsUntilDelivery: Math.max(0, fullMonthsBetween(referenceDate, deliveryDate)),
    act: fromCents(downC),
    monthly: { count: 0, amount: 0, lastAmount: 0, principal: 0, interest: 0, total: 0 },
    balloons: { count: 0, amount: 0, total: 0, months: [] },
    keys: { amount: 0, month: null },
    interestTotal: 0,
    totalPaid: fromCents(downC),
    correction: null,
  };
}
