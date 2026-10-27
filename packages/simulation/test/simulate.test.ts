import { describe, expect, it } from 'vitest';
import {
  InvalidParametersError,
  InvalidSimulationInputError,
  ParametersNotInForceError,
  illustrativeParameters,
  pricePayment,
  roundCents,
  simulate,
  type AlertCode,
  type SimulationResult,
} from '../src';
import { REF_DATE, baseInput, bornYearsAgo, simpleLine, simpleParams } from './helpers';

const codes = (alerts: { code: AlertCode }[]) => alerts.map((a) => a.code);
const fin = (r: SimulationResult) => r.selected!.financing!;

// Linha de teste: 1% a.m., sem seguros, cota 80%, comprometimento 30%, SAC 360 meses.
// Fator SAC da 1ª parcela = 1/360 + 0,01 = 0,0127777…

describe('parecer (spec §4.3, RF-24)', () => {
  it('VIAVEL: entrada disponível cobre a necessária; cota limita (casos à mão)', () => {
    // renda 10.000 → parcela_max 3.000 → cabe 3.000 / 0,012777… = 234.782,60
    // cota 80% de 250.000 = 200.000 → financiável = 200.000 (LTV) → entrada 50.000
    const r = simulate(baseInput(), simpleParams());
    expect(r.verdict).toBe('VIAVEL');
    expect(r.reasons).toEqual([]);
    expect(r.selected!.capacity!.maxInstallment).toBe(3000);
    expect(fin(r)).toMatchObject({
      system: 'SAC',
      maxFinanceableByLtv: 200000,
      maxFinanceableByInstallment: 234782.6,
      maxFinanceable: 200000,
      limitingFactor: 'LTV',
      financedAmount: 200000,
      requiredDownPayment: 50000,
      downPaymentUsed: 50000,
      shortfall: 0,
    });
    // 1ª: 200.000/360 + 2.000 = 2.555,56; última: 555,56 + 5,56 = 561,11
    expect(fin(r).firstInstallment!.total).toBe(2555.56);
    expect(fin(r).lastInstallment!.total).toBe(561.11);
    expect(fin(r).incomeCommitment).toBeCloseTo(0.255556, 6);
    expect(r.selected!.term!.months).toBe(360);
  });

  it('VIAVEL_COM_AJUSTES: falta de entrada dentro da tolerância (10% da entrada)', () => {
    const r = simulate(baseInput({ availableDownPayment: 46000 }), simpleParams());
    expect(r.verdict).toBe('VIAVEL_COM_AJUSTES');
    expect(r.reasons).toEqual(['DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE']);
    expect(fin(r).shortfall).toBe(4000);
    expect(r.suggestions).toEqual([{ code: 'INCREASE_DOWN_PAYMENT', amount: 4000 }, { code: 'SMALLER_UNIT' }]);
    expect(r.alerts).toContainEqual({ code: 'DOWN_PAYMENT_INSUFFICIENT', value: 4000 });
  });

  it('limite exato da tolerância é ajuste; um centavo acima é inviável', () => {
    expect(simulate(baseInput({ availableDownPayment: 45000 }), simpleParams()).verdict).toBe('VIAVEL_COM_AJUSTES');
    expect(simulate(baseInput({ availableDownPayment: 44999.99 }), simpleParams()).verdict).toBe('INVIAVEL');
  });

  it('INVIAVEL: falta de entrada acima da tolerância', () => {
    const r = simulate(baseInput({ availableDownPayment: 30000 }), simpleParams());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons).toEqual(['DOWN_PAYMENT_SHORTFALL']);
    expect(r.suggestions[0]).toEqual({ code: 'PLAN_DOWN_PAYMENT', amount: 20000 });
  });

  it('a tolerância vem do parâmetro, não do código', () => {
    const r = simulate(baseInput({ availableDownPayment: 30000 }), simpleParams(undefined, { adjustmentToleranceRatio: 0.5 }));
    expect(r.verdict).toBe('VIAVEL_COM_AJUSTES');
  });
});

describe('capacidade de pagamento (spec §4.1, RF-16)', () => {
  it('parcela limita o financiamento: sugere co-proponente e prazo maior', () => {
    // renda 5.000 → parcela_max 1.500; prazo 240: fator 1/240 + 0,01 → cabe 105.882,35
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, grossMonthlyIncome: 5000 }, availableDownPayment: 135000, desiredTermMonths: 240 }), simpleParams());
    const f = fin(r);
    expect(f.limitingFactor).toBe('INSTALLMENT');
    expect(f.maxFinanceableByInstallment).toBe(105882.35);
    expect(f.requiredDownPayment).toBe(144117.65);
    expect(r.verdict).toBe('VIAVEL_COM_AJUSTES');
    expect(r.suggestions.map((s) => s.code)).toEqual(['INCREASE_DOWN_PAYMENT', 'ADD_CO_APPLICANT', 'LONGER_TERM', 'SMALLER_UNIT']);
    expect(codes(r.alerts)).toContain('CO_APPLICANT_RECOMMENDED');
    // 1ª parcela encosta no limite → alerta de comprometimento alto
    expect(f.firstInstallment!.total).toBeLessThanOrEqual(1500);
    expect(codes(r.alerts)).toContain('HIGH_INCOME_COMMITMENT');
  });

  it('dívidas reduzem a parcela máxima', () => {
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, monthlyDebts: 1200 } }), simpleParams());
    expect(r.selected!.capacity!.maxInstallment).toBe(1800);
  });

  it.each([
    ['dívidas = 30% da renda (parcela_max = 0)', 3000],
    ['dívidas acima de 30% (parcela_max < 0)', 3500],
  ])('INVIAVEL quando %s', (_label, debts) => {
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, monthlyDebts: debts } }), simpleParams());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons).toEqual(['NO_PAYMENT_CAPACITY']);
    expect(r.suggestions.map((s) => s.code)).toEqual(['PAY_OFF_DEBTS', 'ADD_CO_APPLICANT', 'SMALLER_UNIT', 'RETURN_LATER']);
    expect(fin(r).financedAmount).toBe(0);
    expect(fin(r).firstInstallment).toBeNull();
  });

  it('INVIAVEL quando a parcela_max não cobre nem seguros e taxas', () => {
    const line = simpleLine({ adminFeeMonthly: 25, insurance: { mipMonthlyRateByAge: [{ upToAgeYears: 80, monthlyRate: 0 }], dfiMonthlyRate: 0.0001 } });
    // parcela_max = 10.000 × 30% − 2.950 = 50 < DFI 25 + taxa 25 → nada cabe
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, monthlyDebts: 2950 } }), simpleParams([line]));
    expect(r.reasons).toEqual(['NO_PAYMENT_CAPACITY']);
    expect(fin(r).maxFinanceableByInstallment).toBe(0);
  });

  it('co-proponente soma renda e dívidas', () => {
    const co = { ...baseInput().applicant, grossMonthlyIncome: 4000, monthlyDebts: 200 };
    const r = simulate(baseInput({ coApplicant: co }), simpleParams());
    expect(r.selected!.capacity).toMatchObject({ familyIncome: 14000, monthlyDebts: 200, maxInstallment: 4000 });
  });
});

describe('cota de financiamento (spec §4.2)', () => {
  it('cota diferente muda o financiável (parâmetro injetado)', () => {
    const r = simulate(baseInput(), simpleParams([simpleLine({ maxLtv: 0.7 })]));
    expect(fin(r)).toMatchObject({ maxFinanceableByLtv: 175000, financedAmount: 175000, requiredDownPayment: 75000 });
    expect(r.verdict).toBe('INVIAVEL');
  });

  it('cota 100% com renda alta: entrada zero', () => {
    const r = simulate(
      baseInput({ applicant: { ...baseInput().applicant, grossMonthlyIncome: 50000 }, availableDownPayment: 0 }),
      simpleParams([simpleLine({ maxLtv: 1 })]),
    );
    expect(fin(r)).toMatchObject({ financedAmount: 250000, requiredDownPayment: 0 });
    expect(r.verdict).toBe('VIAVEL');
  });

  it('valor financiável é o MENOR entre cota e parcela', () => {
    for (const income of [3000, 6000, 8000, 12000, 30000]) {
      const r = simulate(baseInput({ applicant: { ...baseInput().applicant, grossMonthlyIncome: income } }), simpleParams());
      const f = fin(r);
      expect(f.maxFinanceable).toBe(Math.min(f.maxFinanceableByLtv, f.maxFinanceableByInstallment));
    }
  });
});

describe('idade e prazo (spec §4.5)', () => {
  it('idade limita o prazo: 60 anos com idade máx. 80 → 240 meses', () => {
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, birthDate: bornYearsAgo(60) } }), simpleParams());
    expect(r.selected!.term).toMatchObject({ months: 240, maxByAge: 240, limitedByAge: true });
    expect(r.alerts).toContainEqual({ code: 'AGE_LIMITS_TERM', value: 240 });
  });

  it('idade no limite exato do prazo mínimo ainda é simulável', () => {
    // 70 anos → restam 120 meses = prazo mínimo
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, birthDate: bornYearsAgo(70) } }), simpleParams());
    expect(r.selected!.term!.months).toBe(120);
    expect(r.reasons).not.toContain('AGE_LIMIT');
  });

  it('INVIAVEL quando a idade não permite nem o prazo mínimo (um dia a mais)', () => {
    // nascido 1 dia antes de completar 70 anos + 1 mês → 841 meses → restam 119 < 120
    const r = simulate(baseInput({ applicant: { ...baseInput().applicant, birthDate: '1956-09-25' } }), simpleParams());
    expect(r.verdict).toBe('INVIAVEL');
    expect(r.reasons).toEqual(['AGE_LIMIT']);
    expect(r.suggestions.map((s) => s.code)).toContain('ADD_CO_APPLICANT');
    expect(fin(r).firstInstallment).toBeNull();
  });

  it('co-proponente: regra OLDEST usa o mais velho; YOUNGEST o mais novo', () => {
    const co = { ...baseInput().applicant, birthDate: bornYearsAgo(65), grossMonthlyIncome: 3000 };
    const oldest = simulate(baseInput({ coApplicant: co }), simpleParams());
    expect(oldest.selected!.term!.months).toBe(180);
    const youngest = simulate(baseInput({ coApplicant: co }), simpleParams([simpleLine({ ageRule: 'YOUNGEST' })]));
    expect(youngest.selected!.term!.months).toBe(360);
  });

  it('prazo desejado fora dos limites é ajustado e sinalizado', () => {
    const r = simulate(baseInput({ desiredTermMonths: 500 }), simpleParams());
    expect(r.selected!.term!.months).toBe(360);
    expect(r.alerts).toContainEqual({ code: 'TERM_ADJUSTED', value: 360 });
    const short = simulate(baseInput({ desiredTermMonths: 60 }), simpleParams());
    expect(short.selected!.term!.months).toBe(120);
  });

  it('menor de 18 anos é entrada inválida', () => {
    expect(() =>
      simulate(baseInput({ applicant: { ...baseInput().applicant, birthDate: '2008-10-27' } }), simpleParams()),
    ).toThrow(InvalidSimulationInputError);
    expect(() =>
      simulate(baseInput({ applicant: { ...baseInput().applicant, birthDate: '2008-10-26' } }), simpleParams()),
    ).not.toThrow();
  });
});

describe('FGTS na entrada (spec §4.6, RF-21)', () => {
  const withFgts = (balance: number, contributionMonths: number) => ({ ...baseInput().applicant, fgts: { balance, contributionMonths } });

  it('FGTS reduz a entrada em dinheiro', () => {
    const r = simulate(baseInput({ applicant: withFgts(20000, 40), availableDownPayment: 30000 }), simpleParams());
    expect(fin(r)).toMatchObject({ fgtsAvailable: 20000, fgtsUsed: 20000, financedAmount: 200000, requiredDownPayment: 30000 });
    expect(r.verdict).toBe('VIAVEL');
  });

  it('sem o tempo mínimo de contribuição, FGTS não entra', () => {
    const r = simulate(baseInput({ applicant: withFgts(20000, 35), availableDownPayment: 30000 }), simpleParams());
    expect(fin(r).fgtsUsed).toBe(0);
    expect(r.alerts).toContainEqual({ code: 'FGTS_MIN_TIME_NOT_MET', value: 36 });
    expect(r.verdict).toBe('INVIAVEL');
  });

  it('quem já possui imóvel não usa FGTS (regra da linha)', () => {
    const r = simulate(baseInput({ applicant: withFgts(20000, 40), ownsResidentialProperty: true }), simpleParams());
    expect(fin(r).fgtsUsed).toBe(0);
    expect(codes(r.alerts)).toContain('FGTS_NOT_ELIGIBLE');
  });

  it('FGTS maior que o necessário reduz o financiamento, nunca passa do valor do imóvel', () => {
    const r = simulate(baseInput({ applicant: withFgts(400000, 120), availableDownPayment: 0 }), simpleParams());
    expect(fin(r)).toMatchObject({ fgtsUsed: 250000, financedAmount: 0, requiredDownPayment: 0, firstInstallment: null });
  });

  it('soma FGTS dos dois proponentes que cumprem o tempo mínimo', () => {
    const co = { ...withFgts(5000, 12), grossMonthlyIncome: 2000 };
    const r = simulate(baseInput({ applicant: withFgts(10000, 50), coApplicant: co }), simpleParams());
    expect(fin(r).fgtsUsed).toBe(10000);
    expect(codes(r.alerts)).toContain('FGTS_MIN_TIME_NOT_MET');
  });
});

describe('enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO', () => {
  const lead = (income: number, propertyValue: number, extra: Partial<ReturnType<typeof baseInput>> = {}) =>
    baseInput({
      propertyValue,
      applicant: { ...baseInput().applicant, grossMonthlyIncome: income },
      availableDownPayment: 100000,
      ...extra,
    });

  it('renda baixa + imóvel no teto → faixa A, com subsídio da tabela', () => {
    const r = simulate(lead(3200, 220000), illustrativeParameters);
    expect(r.selected!.lineId).toBe('programa-habitacional-faixa-a');
    expect(fin(r).subsidy).toBe(30000);
    expect(r.alerts[0]).toEqual({ code: 'ILLUSTRATIVE_PARAMETERS' });
  });

  it('renda acima da faixa A → faixa B; a faixa A aparece como inelegível por renda', () => {
    const r = simulate(lead(6000, 300000), illustrativeParameters);
    expect(r.selected!.lineId).toBe('programa-habitacional-faixa-b');
    const a = r.lines.find((l) => l.lineId === 'programa-habitacional-faixa-a')!;
    expect(a).toMatchObject({ eligible: false, ineligibilityReasons: ['INCOME_ABOVE_LIMIT', 'PROPERTY_VALUE_ABOVE_LIMIT'] });
  });

  it('renda alta → só SBPE (taxa efetiva)', () => {
    const r = simulate(lead(20000, 600000, { availableDownPayment: 150000 }), illustrativeParameters);
    expect(r.selected!.lineId).toBe('sbpe');
    expect(fin(r).rates.effectiveAnnual).toBeCloseTo(0.1149, 12);
    expect(r.lines.filter((l) => l.eligible).map((l) => l.lineId)).toEqual(['sbpe']);
  });

  it('quem já possui imóvel ou já financiou cai fora dos programas', () => {
    const owns = simulate(lead(3200, 220000, { ownsResidentialProperty: true }), illustrativeParameters);
    expect(owns.selected!.lineId).toBe('sbpe');
    const notFirst = simulate(lead(3200, 220000, { firstFinancing: false }), illustrativeParameters);
    expect(notFirst.lines[0]!.ineligibilityReasons).toEqual(['NOT_FIRST_FINANCING']);
  });

  it('escolhe a linha de melhor parecer; empate → prioridade', () => {
    const r = simulate(lead(4500, 250000), illustrativeParameters);
    const eligible = r.lines.filter((l) => l.eligible);
    expect(eligible.length).toBeGreaterThan(1);
    const rank = { VIAVEL: 0, VIAVEL_COM_AJUSTES: 1, INVIAVEL: 2 };
    const best = Math.min(...eligible.map((l) => rank[l.verdict]));
    const expected = eligible.filter((l) => rank[l.verdict] === best).sort((a, b) => a.priority - b.priority)[0]!;
    expect(r.selected!.lineId).toBe(expected.lineId);
  });

  it('nenhuma linha elegível → INVIAVEL com NO_ELIGIBLE_LINE', () => {
    const line = simpleLine({ eligibility: { ...simpleLine().eligibility, maxPropertyValue: 200000 } });
    const r = simulate(baseInput(), simpleParams([line]));
    expect(r).toMatchObject({ verdict: 'INVIAVEL', reasons: ['NO_ELIGIBLE_LINE'], selected: null });
  });

  it('renda informal gera alerta', () => {
    const r = simulate(lead(3200, 220000, { applicant: { ...baseInput().applicant, grossMonthlyIncome: 3200, incomeType: 'AUTONOMO' } }), illustrativeParameters);
    expect(codes(r.alerts)).toContain('INFORMAL_INCOME');
  });
});

describe('subsídio (RF-22, tabela)', () => {
  const subsidyLine = simpleLine({
    subsidy: { maxPropertyValue: 260000, bands: [{ maxFamilyIncome: 3000, amount: 40000 }, { maxFamilyIncome: 12000, amount: 15000 }] },
  });

  it('aplica a faixa de renda e reduz a entrada', () => {
    const r = simulate(baseInput({ availableDownPayment: 35000 }), simpleParams([subsidyLine]));
    expect(fin(r)).toMatchObject({ subsidy: 15000, requiredDownPayment: 35000, financedAmount: 200000 });
    expect(r.verdict).toBe('VIAVEL');
  });

  it('imóvel acima do teto do subsídio → sem subsídio', () => {
    const r = simulate(baseInput({ propertyValue: 270000 }), simpleParams([subsidyLine]));
    expect(fin(r).subsidy).toBe(0);
  });
});

describe('sistema, Price e entrada total', () => {
  it('Price: 1ª parcela = PMT do valor financiado e nunca passa da parcela máxima', () => {
    const r = simulate(baseInput({ system: 'PRICE', applicant: { ...baseInput().applicant, grossMonthlyIncome: 6000 } }), simpleParams());
    const f = fin(r);
    expect(f.system).toBe('PRICE');
    expect(f.firstInstallment!.total).toBe(roundCents(pricePayment(f.financedAmount, 0.01, 360)));
    expect(f.firstInstallment!.total).toBeLessThanOrEqual(1800);
    expect(f.lastInstallment!.total).toBe(f.firstInstallment!.total);
  });

  it('sistema não oferecido pela linha é trocado e sinalizado', () => {
    const r = simulate(baseInput({ system: 'PRICE' }), simpleParams([simpleLine({ systems: ['SAC'] })]));
    expect(fin(r).system).toBe('SAC');
    expect(codes(r.alerts)).toContain('SYSTEM_ADJUSTED');
  });

  it('useFullDownPayment: usa toda a entrada e financia menos', () => {
    const r = simulate(baseInput({ availableDownPayment: 80000, useFullDownPayment: true }), simpleParams());
    expect(fin(r)).toMatchObject({ requiredDownPayment: 50000, downPaymentUsed: 80000, financedAmount: 170000 });
    // 170.000/360 + 1.700
    expect(fin(r).firstInstallment!.total).toBe(2172.22);
  });
});

describe('fluxo de pagamento da obra (RF-23, simples)', () => {
  const plan = { deliveryDate: '2029-10-26', signalRatio: 0.1, balloonRatio: 0.3, balloonIntervalMonths: 12 };

  it('sinal + mensais + reforços somam exatamente a entrada; chaves = financiamento + FGTS + subsídio', () => {
    const r = simulate(baseInput({ construction: plan }), simpleParams());
    const flow = fin(r).constructionFlow!;
    // 36 meses até a entrega → 35 mensais; reforços nos meses 12 e 24
    expect(flow).toMatchObject({
      monthsUntilDelivery: 36,
      signal: 5000.1,
      monthly: { count: 35, amount: 857.14, total: 29999.9 },
      balloons: { count: 2, amount: 7500, total: 15000, months: [12, 24] },
      keys: { financed: 200000, fgts: 0, subsidy: 0, total: 200000 },
      constructionInterestModeled: false,
    });
    expect(roundCents(flow.signal + flow.monthly.total + flow.balloons.total)).toBe(50000);
  });

  it('entrega no mês corrente → entrada toda no sinal', () => {
    const r = simulate(baseInput({ construction: { ...plan, deliveryDate: '2026-11-10' } }), simpleParams());
    expect(fin(r).constructionFlow).toMatchObject({ signal: 50000, monthly: { count: 0 }, balloons: { count: 0 } });
  });

  it('mensal da obra acima da capacidade gera alerta', () => {
    const r = simulate(
      baseInput({ applicant: { ...baseInput().applicant, grossMonthlyIncome: 3000 }, construction: { ...plan, deliveryDate: '2027-04-26' } }),
      simpleParams(),
    );
    expect(codes(r.alerts)).toContain('CONSTRUCTION_INSTALLMENT_ABOVE_CAPACITY');
  });

  it('entrega anterior à data da simulação é inválida', () => {
    expect(() => simulate(baseInput({ construction: { ...plan, deliveryDate: '2026-01-01' } }), simpleParams())).toThrow(
      InvalidSimulationInputError,
    );
  });
});

describe('pureza, validação e vigência', () => {
  it('determinístico e sem mutar a entrada', () => {
    const input = Object.freeze(baseInput({ construction: { deliveryDate: '2029-10-26', signalRatio: 0.1, balloonRatio: 0.3, balloonIntervalMonths: 6 } }));
    const params = Object.freeze(simpleParams());
    expect(simulate(input, params)).toEqual(simulate(structuredClone(input), structuredClone(params)));
  });

  it('parâmetros fora da vigência → erro (nunca simula com tabela vencida)', () => {
    const params = simpleParams(undefined, { validFrom: '2026-01-01', validTo: '2026-06-30' });
    expect(() => simulate(baseInput(), params)).toThrow(ParametersNotInForceError);
    expect(() => simulate(baseInput({ referenceDate: '2025-12-31', applicant: { ...baseInput().applicant, birthDate: '1990-01-01' } }), simpleParams())).toThrow(
      ParametersNotInForceError,
    );
    expect(() => simulate(baseInput({ referenceDate: '2026-06-30' }), params)).not.toThrow();
  });

  it.each([
    ['renda zero', { applicant: { ...baseInput().applicant, grossMonthlyIncome: 0 } }],
    ['dívida negativa', { applicant: { ...baseInput().applicant, monthlyDebts: -1 } }],
    ['entrada negativa', { availableDownPayment: -10 }],
    ['valor do imóvel zero', { propertyValue: 0 }],
    ['data inexistente', { referenceDate: '2026-02-30' }],
    ['tipo de renda fora da lista', { applicant: { ...baseInput().applicant, incomeType: 'MEI' } }],
    ['renda NaN', { applicant: { ...baseInput().applicant, grossMonthlyIncome: Number.NaN } }],
  ])('entrada inválida: %s', (_label, patch) => {
    expect(() => simulate({ ...baseInput(), ...patch }, simpleParams())).toThrow(InvalidSimulationInputError);
  });

  it.each([
    ['cota acima de 100%', { creditLines: [simpleLine({ maxLtv: 1.2 })] }],
    ['prazo mínimo > máximo', { creditLines: [simpleLine({ termMonths: { min: 400, max: 360 } })] }],
    ['faixas de MIP fora de ordem', {
      creditLines: [simpleLine({ insurance: { dfiMonthlyRate: 0, mipMonthlyRateByAge: [{ upToAgeYears: 50, monthlyRate: 0 }, { upToAgeYears: 40, monthlyRate: 0 }] } })],
    }],
    ['ids repetidos', { creditLines: [simpleLine(), simpleLine()] }],
    ['sem linhas', { creditLines: [] }],
  ])('parâmetros inválidos: %s', (_label, patch) => {
    expect(() => simulate(baseInput(), { ...simpleParams(), ...patch })).toThrow(InvalidParametersError);
  });

  it('seed ILUSTRATIVO é válido e marcado como tal', () => {
    expect(illustrativeParameters.status).toBe('ILUSTRATIVO');
    expect(illustrativeParameters.creditLines.every((l) => l.name.includes('ILUSTRATIVO'))).toBe(true);
    expect(simulate(baseInput({ referenceDate: REF_DATE }), illustrativeParameters).parametersVersion).toBe('2026-10-ILUSTRATIVO-v1');
  });
});
