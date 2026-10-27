import { fullMonthsBetween } from './dates';
import type { ConstructionPlan } from './input';
import { fromCents, toCents } from './money';

export interface ConstructionFlow {
  monthsUntilDelivery: number;
  /** Sinal/ato, no mês 0. */
  signal: number;
  /** Entrada parcelada: meses 1..n. */
  monthly: { count: number; amount: number; total: number };
  /** Reforços/intermediárias, nos meses indicados. */
  balloons: { count: number; amount: number; total: number; months: number[] };
  /** Pago na entrega das chaves: financiamento + FGTS + subsídio (via agente financeiro). */
  keys: { financed: number; fgts: number; subsidy: number; total: number };
  /** Parcelas de evolução de obra (juros ao banco durante a obra): não modeladas no MVP. */
  constructionInterestModeled: false;
}

/**
 * Divide a entrada em sinal, mensais e reforços até a entrega das chaves. Tudo em centavos
 * inteiros: a soma das partes é exatamente a entrada (o resíduo de arredondamento vai no sinal).
 * Sem meses até a entrega, a entrada inteira vira sinal.
 */
export function buildConstructionFlow(
  plan: ConstructionPlan,
  referenceDate: string,
  downPayment: number,
  keys: { financed: number; fgts: number; subsidy: number },
): ConstructionFlow {
  const monthsUntilDelivery = Math.max(0, fullMonthsBetween(referenceDate, plan.deliveryDate));
  // Mensais e reforços ocorrem nos meses 1..(entrega − 1); a entrega é das chaves.
  const installmentMonths = Math.max(0, monthsUntilDelivery - 1);
  const balloonMonths: number[] = [];
  for (let m = plan.balloonIntervalMonths; m <= installmentMonths; m += plan.balloonIntervalMonths) {
    balloonMonths.push(m);
  }

  const totalCents = toCents(downPayment);
  let signalCents = totalCents;
  let monthlyEach = 0;
  let balloonEach = 0;

  if (installmentMonths > 0) {
    const balloonPool = balloonMonths.length > 0 ? Math.floor(totalCents * plan.balloonRatio) : 0;
    balloonEach = balloonMonths.length > 0 ? Math.floor(balloonPool / balloonMonths.length) : 0;
    const balloonTotal = balloonEach * balloonMonths.length;
    const signalBase = Math.floor(totalCents * plan.signalRatio);
    monthlyEach = Math.floor((totalCents - signalBase - balloonTotal) / installmentMonths);
    signalCents = totalCents - balloonTotal - monthlyEach * installmentMonths;
  }

  const monthlyCount = installmentMonths > 0 ? installmentMonths : 0;
  const balloonCount = installmentMonths > 0 ? balloonMonths.length : 0;
  return {
    monthsUntilDelivery,
    signal: fromCents(signalCents),
    monthly: {
      count: monthlyCount,
      amount: fromCents(monthlyEach),
      total: fromCents(monthlyEach * monthlyCount),
    },
    balloons: {
      count: balloonCount,
      amount: fromCents(balloonEach),
      total: fromCents(balloonEach * balloonCount),
      months: installmentMonths > 0 ? balloonMonths : [],
    },
    keys: {
      financed: keys.financed,
      fgts: keys.fgts,
      subsidy: keys.subsidy,
      total: fromCents(toCents(keys.financed) + toCents(keys.fgts) + toCents(keys.subsidy)),
    },
    constructionInterestModeled: false,
  };
}
