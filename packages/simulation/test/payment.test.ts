import { describe, expect, it } from 'vitest';
import {
  illustrativeParameters,
  InvalidPaymentInputError,
  InvalidSalesConditionError,
  PaymentModeNotOfferedError,
  SalesConditionNotInForceError,
  simulatePayment,
} from '../src';
import { DELIVERY_24, installmentInput, PAY_REF_DATE, simpleCondition, withInstallments } from './payment-helpers';

const common = { referenceDate: PAY_REF_DATE, unitPrice: 300000, deliveryDate: DELIVERY_24 };
const upfront = (o: Record<string, unknown> = {}) => ({ ...common, mode: 'ENTRADA_A_VISTA', cashNow: 60000, ...o });
const codes = (r: { alerts: Array<{ code: string }> }) => r.alerts.map((a) => a.code);

describe('modo 1 — à vista', () => {
  it('aplica o desconto da condição e não analisa renda', () => {
    const r = simulatePayment({ ...common, mode: 'A_VISTA' }, simpleCondition());
    expect(r.verdict).toBe('VIAVEL');
    expect(r.cash).toEqual({ discountRatio: 0.08, discount: 24000, amountToPay: 276000 });
    expect(r.plan).toBeNull();
    expect(r.capacity).toBeNull();
  });

  it('desconto zero paga o preço cheio', () => {
    const cond = simpleCondition({ cash: { enabled: true, discountRatio: 0 } });
    expect(simulatePayment({ ...common, mode: 'A_VISTA' }, cond).cash?.amountToPay).toBe(300000);
  });

  it('alerta quando a condição é ILUSTRATIVO', () => {
    const r = simulatePayment({ ...common, mode: 'A_VISTA' }, simpleCondition({ status: 'ILUSTRATIVO' }));
    expect(codes(r)).toContain('ILLUSTRATIVE_CONDITION');
  });
});

describe('modo 2 — entrada à vista + financiamento', () => {
  it('viável: dinheiro cobre a entrada mínima', () => {
    const r = simulatePayment(upfront(), simpleCondition());
    expect(r.verdict).toBe('VIAVEL');
    expect(r.downPayment).toMatchObject({ min: 60000, max: 150000, chosen: 60000, shortfall: 0 });
    expect(r.balanceAtKeys).toBe(240000);
    expect(r.plan?.act).toBe(60000);
    expect(r.plan?.monthly.count).toBe(0);
  });

  it('viável com ajustes: falta até a tolerância da entrada', () => {
    const r = simulatePayment(upfront({ cashNow: 55000 }), simpleCondition());
    expect(r.verdict).toBe('VIAVEL_COM_AJUSTES');
    expect(r.reasons).toEqual(['DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE']);
    expect(r.downPayment?.shortfall).toBe(5000);
    expect(r.suggestions[0]).toEqual({ code: 'INCREASE_DOWN_PAYMENT', amount: 5000 });
  });

  it('inviável: falta acima da tolerância, sugere parcelar a entrada', () => {
    const r = simulatePayment(upfront({ cashNow: 30000 }), simpleCondition());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons).toEqual(['DOWN_PAYMENT_SHORTFALL']);
    expect(r.suggestions.map((s) => s.code)).toContain('CONSIDER_INSTALLMENTS');
  });

  it('a tolerância é parâmetro: com 0% a mesma falta vira inviável', () => {
    const r = simulatePayment(upfront({ cashNow: 55000 }), simpleCondition({ adjustmentToleranceRatio: 0 }));
    expect(r.verdict).toBe('INVIAVEL');
  });

  it('entrada desejada maior que a mínima vale; fora dos limites é ajustada com alerta', () => {
    expect(simulatePayment(upfront({ desiredDownPayment: 100000, cashNow: 100000 }), simpleCondition()).downPayment?.chosen).toBe(100000);
    const high = simulatePayment(upfront({ desiredDownPayment: 200000 }), simpleCondition());
    expect(high.downPayment?.chosen).toBe(150000);
    expect(high.alerts).toContainEqual({ code: 'DOWN_PAYMENT_ADJUSTED', value: 150000 });
    const low = simulatePayment(upfront({ desiredDownPayment: 10000 }), simpleCondition());
    expect(low.downPayment?.chosen).toBe(60000);
  });
});

describe('modo 3 — entrada parcelada', () => {
  it('viável: cabe na renda sem ajustes', () => {
    const r = simulatePayment(installmentInput(), simpleCondition());
    expect(r.verdict).toBe('VIAVEL');
    expect(r.plan?.act).toBe(6000);
    expect(r.plan?.monthly.count).toBe(23);
    expect(r.capacity).toMatchObject({ familyIncome: 10000, maxMonthly: 3000 });
    expect(r.balanceAtKeys).toBe(240000);
    expect(r.desiredInstallment).toBeNull();
  });

  it('viável com reforços quando a renda é menor e o lead aceita', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 5000, monthlyDebts: 0 }], acceptsBalloons: true }), simpleCondition());
    expect(r.verdict).toBe('VIAVEL');
    expect(r.plan?.balloons.count).toBe(3);
  });

  it('viável com ajustes: falta pouco de ato; sugere co-proponente e reforços', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 5000, monthlyDebts: 0 }], cashNow: 20000 }), simpleCondition());
    expect(r.verdict).toBe('VIAVEL_COM_AJUSTES');
    expect(r.downPayment?.shortfall).toBe(2500);
    expect(r.plan?.act).toBe(22500);
    const sug = r.suggestions.map((s) => s.code);
    expect(sug).toEqual(expect.arrayContaining(['INCREASE_DOWN_PAYMENT', 'ADD_CO_APPLICANT', 'ACCEPT_BALLOONS']));
  });

  it('inviável: falta muito ato', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 5000, monthlyDebts: 0 }] }), simpleCondition());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons).toContain('DOWN_PAYMENT_SHORTFALL');
    expect(r.suggestions.map((s) => s.code)).toContain('RETURN_LATER');
  });

  it('inviável por capacidade: renda não comporta nem a parcela mínima', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 800, monthlyDebts: 100 }] }), simpleCondition());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons[0]).toBe('NO_PAYMENT_CAPACITY');
    expect(r.suggestions.map((s) => s.code)).toContain('PAY_OFF_DEBTS');
  });

  it('dívidas reduzem a capacidade; casal soma as rendas', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 6000, monthlyDebts: 500 }, { grossMonthlyIncome: 4000, monthlyDebts: 0 }] }), simpleCondition());
    expect(r.capacity).toMatchObject({ familyIncome: 10000, monthlyDebts: 500, maxMonthly: 2500 });
  });

  it('alerta de comprometimento alto perto do limite', () => {
    const r = simulatePayment(installmentInput({ buyers: [{ grossMonthlyIncome: 7500, monthlyDebts: 0 }] }), simpleCondition());
    // maxMonthly 2250; mensal ~2217 → 98,5% do limite
    expect(r.verdict).toBe('VIAVEL');
    expect(codes(r)).toContain('HIGH_INCOME_COMMITMENT');
  });

  it('parcela desejada: resultados WITHIN, SLIGHTLY_ABOVE e UNREACHABLE', () => {
    expect(simulatePayment(installmentInput({ desiredInstallment: 2300 }), simpleCondition()).desiredInstallment).toBe('WITHIN');
    const above = simulatePayment(installmentInput({ desiredInstallment: 2000 }), simpleCondition());
    expect(above.desiredInstallment).toBe('SLIGHTLY_ABOVE');
    expect(codes(above)).toContain('DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY');
    const far = simulatePayment(installmentInput({ desiredInstallment: 1000 }), simpleCondition());
    expect(far.desiredInstallment).toBe('UNREACHABLE');
    expect(codes(far)).toContain('DESIRED_INSTALLMENT_UNREACHABLE');
  });

  it('entrega próxima (≤ 1 mês) e já entregue: sem mensais, com alerta', () => {
    const near = simulatePayment(installmentInput({ deliveryDate: '2026-12-04', cashNow: 57000 }), simpleCondition());
    expect(near.verdict).toBe('VIAVEL');
    expect(near.plan?.monthly.count).toBe(0);
    expect(codes(near)).toContain('NO_TIME_FOR_INSTALLMENTS');
    const ready = simulatePayment(installmentInput({ deliveryDate: '2026-01-01', cashNow: 60000 }), simpleCondition());
    expect(ready.plan).toMatchObject({ act: 60000, monthsUntilDelivery: 0 });
  });

  it('entrega distante: respeita o teto de parcelas e usa juros e correção da condição', () => {
    const cond = withInstallments({
      monthly: { maxCount: 36, minAmount: 300, monthlyInterestRate: 0.005 },
      correction: { index: 'INCC', projectedMonthlyRate: 0.004 },
    });
    const r = simulatePayment(installmentInput({ deliveryDate: '2031-11-04' }), cond);
    expect(r.plan?.monthly.count).toBe(36);
    expect(r.plan?.interestTotal).toBeGreaterThan(0);
    expect(r.plan?.correction?.projectedTotal).toBeGreaterThan(r.plan!.total);
    expect(codes(r)).toContain('CORRECTION_APPLIES');
  });
});

describe('estimativa do banco sobre o saldo', () => {
  const financing = {
    applicant: { birthDate: '1990-05-10', grossMonthlyIncome: 9000, incomeType: 'CLT' as const, monthlyDebts: 0, fgts: null },
    coApplicant: null,
    ownsResidentialProperty: false,
    firstFinancing: true,
  };

  it('reaproveita o simulate() com a entrada já paga', () => {
    const rich = { ...financing, applicant: { ...financing.applicant, grossMonthlyIncome: 25000 } };
    const r = simulatePayment(upfront({ financing: rich }), simpleCondition(), illustrativeParameters);
    expect(r.bankEstimate).not.toBeNull();
    expect(r.bankEstimate?.propertyValue).toBe(300000);
    expect(r.bankEstimate?.selected?.financing?.financedAmount).toBe(240000);
  });

  it('funciona no modo 3 e alerta quando o banco não aprova', () => {
    const poor = { ...financing, applicant: { ...financing.applicant, grossMonthlyIncome: 1800 } };
    const r = simulatePayment(installmentInput({ financing: poor }), simpleCondition(), illustrativeParameters);
    expect(r.bankEstimate?.verdict).toBe('INVIAVEL');
    expect(codes(r)).toContain('BANK_ESTIMATE_NOT_VIABLE');
  });

  it('omitida se a condição desliga, se falta o perfil ou os parâmetros', () => {
    const off = simpleCondition({ bankEstimate: { enabled: false } });
    expect(simulatePayment(upfront({ financing }), off, illustrativeParameters).bankEstimate).toBeNull();
    expect(simulatePayment(upfront(), simpleCondition(), illustrativeParameters).bankEstimate).toBeNull();
    expect(simulatePayment(upfront({ financing }), simpleCondition()).bankEstimate).toBeNull();
  });

  it('parâmetros bancários fora da vigência: sem estimativa, com alerta', () => {
    const future = { ...illustrativeParameters, validFrom: '2027-01-01' };
    const r = simulatePayment(upfront({ financing }), simpleCondition(), future);
    expect(r.bankEstimate).toBeNull();
    expect(codes(r)).toContain('BANK_ESTIMATE_UNAVAILABLE');
  });
});

describe('validação e vigência', () => {
  it('condição fora da vigência lança erro tipado', () => {
    expect(() => simulatePayment({ ...common, mode: 'A_VISTA' }, simpleCondition({ validFrom: '2027-01-01' }))).toThrow(SalesConditionNotInForceError);
    expect(() => simulatePayment({ ...common, mode: 'A_VISTA' }, simpleCondition({ validTo: '2026-06-30' }))).toThrow(SalesConditionNotInForceError);
  });

  it('modo não oferecido pela condição lança erro tipado', () => {
    const cond = simpleCondition({ cash: { enabled: false, discountRatio: 0 } });
    expect(() => simulatePayment({ ...common, mode: 'A_VISTA' }, cond)).toThrow(PaymentModeNotOfferedError);
  });

  it('entrada e condição inválidas lançam erro tipado', () => {
    expect(() => simulatePayment({ ...common, mode: 'ENTRADA_A_VISTA' }, simpleCondition())).toThrow(InvalidPaymentInputError);
    expect(() => simulatePayment({ ...common, mode: 'A_VISTA' }, { version: 'x' })).toThrow(InvalidSalesConditionError);
  });

  it('é determinística e não muta a entrada', () => {
    const input = Object.freeze(installmentInput({ desiredInstallment: 2000 }));
    expect(simulatePayment(input, simpleCondition())).toEqual(simulatePayment(input, simpleCondition()));
  });
});
