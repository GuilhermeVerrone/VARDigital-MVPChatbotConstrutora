import { describe, expect, it } from 'vitest';
import { buildDownPaymentPlan, illustrativeSalesConditions, simulatePayment, type SalesCondition } from '../src';
import { toCents } from '../src/money';
import { PAY_REF_DATE, simpleCondition } from './payment-helpers';

// Teste de propriedade sem dependência externa: gerador pseudoaleatório com semente fixa
// (reprodutível). Cada caso sorteia condição, entrada, renda e prazo.

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const cents = (r: () => number, lo: number, hi: number) => Math.round(between(r, lo, hi) * 100) / 100;
const addMonths = (months: number) => {
  const total = 2026 * 12 + 10 + months; // novembro/2026 = índice 10
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-04`;
};

function randomCondition(r: () => number): SalesCondition {
  const balloons = r() < 0.6 ? { intervalMonths: r() < 0.5 ? 6 : 12, maxRatio: between(r, 0.05, 0.3) } : null;
  const base = simpleCondition();
  return {
    ...base,
    adjustmentToleranceRatio: between(r, 0, 0.2),
    installments: {
      ...base.installments,
      act: { minRatio: between(r, 0, 0.15), minAmount: cents(r, 0, 20000) },
      monthly: {
        maxCount: Math.floor(between(r, 0, 120)),
        minAmount: cents(r, 1, 2000),
        monthlyInterestRate: r() < 0.5 ? 0 : between(r, 0.001, 0.02),
      },
      balloons,
      keysRatio: r() < 0.5 ? 0 : between(r, 0.01, 0.2),
      maxIncomeCommitment: between(r, 0.1, 0.5),
      desiredInstallmentToleranceRatio: between(r, 0, 0.3),
      correction: r() < 0.5 ? { index: 'NENHUM', projectedMonthlyRate: null } : { index: 'INCC', projectedMonthlyRate: between(r, 0, 0.01) },
    },
  };
}

describe('propriedade: o plano da entrada fecha em centavos exatos', () => {
  it('2000 cenários aleatórios respeitam as invariantes do plano', () => {
    const r = rng(20261104);
    for (let i = 0; i < 2000; i++) {
      const condition = randomCondition(r);
      const downPayment = cents(r, 10000, 400000);
      const cashNow = r() < 0.2 ? 0 : cents(r, 0, downPayment * 1.2);
      const months = Math.floor(between(r, -3, 80));
      const result = buildDownPaymentPlan({
        condition,
        referenceDate: PAY_REF_DATE,
        deliveryDate: addMonths(months),
        downPayment,
        cashNow,
        maxMonthly: cents(r, 0, 8000),
        desiredInstallment: r() < 0.5 ? undefined : cents(r, 100, 6000),
        acceptsBalloons: r() < 0.5,
      });
      const { plan, shortfall } = result;
      const ctx = JSON.stringify({ i, condition: condition.installments, downPayment, cashNow, months });

      // Soma do plano = entrada, em centavos exatos.
      const sum = toCents(plan.act) + toCents(plan.monthly.principal) + toCents(plan.balloons.total) + toCents(plan.keys.amount);
      expect(sum, ctx).toBe(toCents(downPayment));
      // Mensais = principal + juros; total pago = entrada + juros.
      expect(toCents(plan.monthly.total), ctx).toBe(toCents(plan.monthly.principal) + toCents(plan.monthly.interest));
      expect(toCents(plan.totalPaid), ctx).toBe(toCents(downPayment) + toCents(plan.interestTotal));
      // Nenhum componente negativo; prazos dentro dos limites da condição.
      for (const v of [plan.act, plan.monthly.principal, plan.monthly.interest, plan.balloons.total, plan.keys.amount, shortfall]) {
        expect(v, ctx).toBeGreaterThanOrEqual(0);
      }
      expect(plan.monthly.count, ctx).toBeLessThanOrEqual(condition.installments.monthly.maxCount);
      expect(plan.monthly.count, ctx).toBeLessThanOrEqual(Math.max(0, plan.monthsUntilDelivery - 1));
      if (plan.monthly.count > 0) expect(plan.monthly.amount, ctx).toBeGreaterThanOrEqual(condition.installments.monthly.minAmount - 0.01);
      if (!condition.installments.balloons) expect(plan.balloons.count, ctx).toBe(0);
      expect(plan.balloons.total, ctx).toBeLessThanOrEqual(downPayment * (condition.installments.balloons?.maxRatio ?? 0) + 0.01);
      // Reforços nunca depois das mensais da janela; chaves só com prazo.
      for (const m of plan.balloons.months) expect(m, ctx).toBeLessThan(Math.max(1, plan.monthsUntilDelivery));
      if (plan.monthsUntilDelivery === 0) expect(plan.keys.amount, ctx).toBe(0);
      // A falta é exatamente o ato que passa do dinheiro disponível.
      expect(toCents(shortfall), ctx).toBe(Math.max(0, toCents(plan.act) - toCents(cashNow)));
    }
  });

  it('o ato nunca cai abaixo do mínimo da condição (limitado pela entrada)', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const condition = randomCondition(r);
      const downPayment = cents(r, 10000, 400000);
      const { plan } = buildDownPaymentPlan({
        condition,
        referenceDate: PAY_REF_DATE,
        deliveryDate: addMonths(Math.floor(between(r, 0, 60))),
        downPayment,
        cashNow: 0,
        maxMonthly: cents(r, 0, 8000),
        acceptsBalloons: true,
      });
      const floor = Math.max(downPayment * condition.installments.act.minRatio, condition.installments.act.minAmount);
      expect(plan.act).toBeGreaterThanOrEqual(Math.min(floor, downPayment - plan.keys.amount) - 0.01);
    }
  });
});

describe('propriedade: simulatePayment com as condições do seed', () => {
  it('toda entrada parcelada fecha em centavos e o saldo bate com o preço', () => {
    const r = rng(99);
    const slugs = Object.keys(illustrativeSalesConditions) as Array<keyof typeof illustrativeSalesConditions>;
    for (let i = 0; i < 500; i++) {
      const condition = illustrativeSalesConditions[slugs[i % slugs.length]!];
      const unitPrice = cents(r, 150000, 3000000);
      const result = simulatePayment(
        {
          mode: 'ENTRADA_PARCELADA',
          referenceDate: PAY_REF_DATE,
          unitPrice,
          deliveryDate: addMonths(Math.floor(between(r, 0, 60))),
          cashNow: cents(r, 0, unitPrice * 0.3),
          buyers: [{ grossMonthlyIncome: cents(r, 1500, 40000), monthlyDebts: cents(r, 0, 1500) }],
          acceptsBalloons: r() < 0.5,
          desiredInstallment: r() < 0.5 ? undefined : cents(r, 300, 8000),
        },
        condition,
      );
      const p = result.plan!;
      const sum = toCents(p.act) + toCents(p.monthly.principal) + toCents(p.balloons.total) + toCents(p.keys.amount);
      expect(sum).toBe(toCents(p.total));
      expect(toCents(result.balanceAtKeys!) + toCents(p.total)).toBe(toCents(unitPrice));
    }
  });
});
