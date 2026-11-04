import { describe, expect, it } from 'vitest';
import { buildDownPaymentPlan, type DownPaymentPlanArgs } from '../src';
import { toCents as toCentsForTest } from '../src/money';
import { DELIVERY_24, PAY_REF_DATE, simpleCondition, withInstallments } from './payment-helpers';

function args(overrides: Partial<DownPaymentPlanArgs> = {}): DownPaymentPlanArgs {
  return {
    condition: simpleCondition(),
    referenceDate: PAY_REF_DATE,
    deliveryDate: DELIVERY_24,
    downPayment: 60000,
    cashNow: 6000,
    maxMonthly: 3000,
    acceptsBalloons: false,
    ...overrides,
  };
}

/** ato + principal das mensais + reforços + chaves, em centavos. */
function sumCents(p: ReturnType<typeof buildDownPaymentPlan>['plan']): number {
  return toCentsForTest(p.act) + toCentsForTest(p.monthly.principal) + toCentsForTest(p.balloons.total) + toCentsForTest(p.keys.amount);
}

describe('buildDownPaymentPlan — viável', () => {
  it('cabe na renda: ato mínimo, 23 mensais, chaves, sem reforços', () => {
    const { plan, shortfall, desired } = buildDownPaymentPlan(args());
    expect(plan.monthsUntilDelivery).toBe(24);
    expect(plan.act).toBe(6000);
    expect(plan.keys).toEqual({ amount: 3000, month: 24 });
    expect(plan.monthly.count).toBe(23);
    expect(plan.monthly.amount).toBe(2217.39);
    expect(plan.monthly.lastAmount).toBe(2217.42);
    expect(plan.balloons.count).toBe(0);
    expect(shortfall).toBe(0);
    expect(desired).toBe('NONE');
    expect(sumCents(plan)).toBe(6000000);
  });

  it('dinheiro acima do ato mínimo vira ato maior e reduz as mensais', () => {
    const { plan, shortfall } = buildDownPaymentPlan(args({ cashNow: 21000 }));
    expect(plan.act).toBe(21000);
    expect(plan.monthly.principal).toBe(36000);
    expect(plan.monthly.amount).toBe(1565.21);
    expect(shortfall).toBe(0);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('ato mínimo vale o maior entre a fração e o piso em reais', () => {
    const cond = withInstallments({ act: { minRatio: 0.05, minAmount: 9000 } });
    expect(buildDownPaymentPlan(args({ condition: cond, cashNow: 0 })).plan.act).toBe(9000);
  });
});

describe('buildDownPaymentPlan — solver (reforços e ato necessário)', () => {
  it('aceita reforços: usa só o necessário para a mensal caber', () => {
    const { plan, shortfall, balloonsUsed, actRaisedForCapacity } = buildDownPaymentPlan(
      args({ maxMonthly: 1500, acceptsBalloons: true }),
    );
    expect(balloonsUsed).toBe(true);
    expect(plan.balloons).toEqual({ count: 3, amount: 5500, total: 16500, months: [6, 12, 18] });
    expect(plan.monthly.count).toBe(23);
    expect(plan.monthly.amount).toBe(1500);
    expect(plan.act).toBe(6000);
    expect(shortfall).toBe(0);
    expect(actRaisedForCapacity).toBe(false);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('não aceita reforços: calcula o ato necessário e a falta', () => {
    const { plan, shortfall, actRaisedForCapacity } = buildDownPaymentPlan(args({ maxMonthly: 1500 }));
    expect(plan.act).toBe(22500);
    expect(plan.monthly.principal).toBe(34500);
    expect(plan.balloons.count).toBe(0);
    expect(shortfall).toBe(16500);
    expect(actRaisedForCapacity).toBe(true);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('reforços não bastam: usa o máximo e sobe o ato', () => {
    const { plan, shortfall } = buildDownPaymentPlan(args({ maxMonthly: 1000, acceptsBalloons: true }));
    expect(plan.balloons.total).toBe(18000);
    // restante 60000 − 3000 − 18000 = 39000; cabem 23 × 1000 = 23000 → ato 16000.
    expect(plan.monthly.principal).toBe(23000);
    expect(plan.act).toBe(16000);
    expect(shortfall).toBe(10000);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('o prazo encolhe para respeitar o valor mínimo da parcela', () => {
    // 7 000 de saldo com piso de R$ 500 → no máximo 14 parcelas.
    const cond = withInstallments({ monthly: { maxCount: 36, minAmount: 500, monthlyInterestRate: 0 } });
    const { plan } = buildDownPaymentPlan(args({ condition: cond, downPayment: 60000, cashNow: 50000, maxMonthly: 5000 }));
    expect(plan.act).toBe(50000);
    expect(plan.monthly.count).toBe(14);
    expect(plan.monthly.amount).toBeGreaterThanOrEqual(500);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('sobra menor que o piso: tudo vira ato', () => {
    const { plan } = buildDownPaymentPlan(args({ cashNow: 56800 }));
    expect(plan.monthly.count).toBe(0);
    expect(plan.act).toBe(57000);
    expect(sumCents(plan)).toBe(6000000);
  });
});

describe('buildDownPaymentPlan — parcela desejada', () => {
  it('cabe na desejada (WITHIN)', () => {
    const r = buildDownPaymentPlan(args({ desiredInstallment: 2300 }));
    expect(r.desired).toBe('WITHIN');
    expect(r.shortfall).toBe(0);
  });

  it('cabe um pouco acima (SLIGHTLY_ABOVE, folga da condição)', () => {
    const r = buildDownPaymentPlan(args({ desiredInstallment: 2000 }));
    expect(r.desired).toBe('SLIGHTLY_ABOVE');
    expect(r.plan.monthly.lastAmount).toBe(2217.42);
    expect(r.shortfall).toBe(0);
  });

  it('a folga é parâmetro: com 0% a mesma desejada deixa de caber', () => {
    const cond = withInstallments({ desiredInstallmentToleranceRatio: 0 });
    const r = buildDownPaymentPlan(args({ condition: cond, desiredInstallment: 2000 }));
    expect(r.desired).toBe('UNREACHABLE');
  });

  it('não alcança a desejada: entrega a menor possível (UNREACHABLE)', () => {
    const r = buildDownPaymentPlan(args({ desiredInstallment: 1000, acceptsBalloons: true }));
    expect(r.desired).toBe('UNREACHABLE');
    expect(r.plan.balloons.total).toBe(18000);
    expect(r.shortfall).toBe(0);
  });
});

describe('buildDownPaymentPlan — juros e correção', () => {
  it('juros pela Price: mensal maior, principal intacto, juros separados', () => {
    const cond = withInstallments({ monthly: { maxCount: 36, minAmount: 300, monthlyInterestRate: 0.01 } });
    const { plan } = buildDownPaymentPlan(args({ condition: cond }));
    expect(plan.monthly.principal).toBe(51000);
    expect(plan.monthly.interest).toBeGreaterThan(0);
    expect(plan.monthly.amount).toBe(2493.18);
    expect(plan.monthly.total).toBeCloseTo(plan.monthly.principal + plan.monthly.interest, 2);
    expect(plan.totalPaid).toBeCloseTo(60000 + plan.interestTotal, 2);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('juros zero: sem juros e sem projeção quando o índice é NENHUM', () => {
    const { plan } = buildDownPaymentPlan(args());
    expect(plan.interestTotal).toBe(0);
    expect(plan.correction).toBeNull();
  });

  it('projeção de correção só aparece com índice e taxa; é informativa (não muda o plano)', () => {
    const base = buildDownPaymentPlan(args()).plan;
    const cond = withInstallments({ correction: { index: 'INCC', projectedMonthlyRate: 0.005 } });
    const { plan } = buildDownPaymentPlan(args({ condition: cond }));
    expect(plan.act).toBe(base.act);
    expect(plan.monthly.amount).toBe(base.monthly.amount);
    expect(plan.correction?.index).toBe('INCC');
    expect(plan.correction!.projectedTotal).toBeGreaterThan(plan.total);
    expect(plan.correction!.projectedIncrease).toBeCloseTo(plan.correction!.projectedTotal - plan.total, 2);
    const noRate = withInstallments({ correction: { index: 'INCC', projectedMonthlyRate: null } });
    expect(buildDownPaymentPlan(args({ condition: noRate })).plan.correction).toBeNull();
  });
});

describe('buildDownPaymentPlan — prazo até as chaves', () => {
  it('entrega em 1 mês: sem mensais; chaves no mês 1, resto no ato', () => {
    const { plan, shortfall } = buildDownPaymentPlan(args({ deliveryDate: '2026-12-04', cashNow: 57000 }));
    expect(plan.monthly.count).toBe(0);
    expect(plan.keys).toEqual({ amount: 3000, month: 1 });
    expect(plan.act).toBe(57000);
    expect(shortfall).toBe(0);
  });

  it('entrega em 2 meses: uma única mensal (mês 1)', () => {
    const { plan } = buildDownPaymentPlan(args({ deliveryDate: '2027-01-04', cashNow: 6000, maxMonthly: 60000 }));
    expect(plan.monthly.count).toBe(1);
    expect(plan.monthly.amount).toBe(51000);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('já entregue (0 meses): entrada inteira no ato, sem chaves', () => {
    const { plan, shortfall } = buildDownPaymentPlan(args({ deliveryDate: '2026-06-01', cashNow: 10000 }));
    expect(plan.monthsUntilDelivery).toBe(0);
    expect(plan.keys).toEqual({ amount: 0, month: null });
    expect(plan.act).toBe(60000);
    expect(shortfall).toBe(50000);
  });

  it('entrega distante: o teto de parcelas limita o prazo', () => {
    const { plan, monthlyCountLimit } = buildDownPaymentPlan(args({ deliveryDate: '2031-11-04' }));
    expect(plan.monthsUntilDelivery).toBe(60);
    expect(monthlyCountLimit).toBe(36);
    expect(plan.monthly.count).toBe(36);
    expect(sumCents(plan)).toBe(6000000);
  });

  it('condição sem reforços ignora o aceite do lead', () => {
    const cond = withInstallments({ balloons: null });
    const { plan, balloonsUsed } = buildDownPaymentPlan(args({ condition: cond, maxMonthly: 1500, acceptsBalloons: true }));
    expect(balloonsUsed).toBe(false);
    expect(plan.balloons.count).toBe(0);
  });
});
