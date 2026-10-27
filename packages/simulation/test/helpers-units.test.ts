import { describe, expect, it } from 'vitest';
import { ageInMonths, buildConstructionFlow, floorCents, fullMonthsBetween, roundCents, toRates } from '../src';

describe('arredondamento', () => {
  it('meio centavo arredonda para cima, inclusive com ruído binário', () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.625)).toBe(2.63);
    expect(roundCents(1.004999)).toBe(1);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });

  it('teto trunca, mas não por ruído binário', () => {
    expect(floorCents(1.999)).toBe(1.99);
    expect(floorCents(0.29 * 100 / 100)).toBe(0.29);
    expect(floorCents(60000.00000000001)).toBe(60000);
    expect(floorCents(59999.99999999999)).toBe(60000);
  });
});

describe('taxas', () => {
  it('nominal: mensal = anual / 12', () => {
    const r = toRates(0.12, 'NOMINAL');
    expect(r.monthly).toBeCloseTo(0.01, 15);
    expect(r.effectiveAnnual).toBeCloseTo(0.12682503013197, 12);
  });

  it('efetiva: (1 + a)^(1/12) − 1 e volta para a mesma anual', () => {
    const r = toRates(0.1149, 'EFFECTIVE');
    expect(Math.pow(1 + r.monthly, 12) - 1).toBeCloseTo(0.1149, 14);
    expect(r.nominalAnnual).toBeCloseTo(r.monthly * 12, 15);
  });
});

describe('datas', () => {
  it('idade em meses completos', () => {
    expect(ageInMonths('1990-05-15', '2026-05-15')).toBe(432);
    expect(ageInMonths('1990-05-15', '2026-05-14')).toBe(431);
    expect(ageInMonths('2000-01-31', '2000-02-29')).toBe(0);
    expect(ageInMonths('2000-01-31', '2000-03-31')).toBe(2);
  });

  it('meses entre datas (negativo para trás)', () => {
    expect(fullMonthsBetween('2026-10-26', '2029-10-26')).toBe(36);
    expect(fullMonthsBetween('2026-10-26', '2026-11-25')).toBe(0);
    expect(fullMonthsBetween('2026-10-26', '2026-09-26')).toBe(-1);
  });

  it('rejeita datas inexistentes ou mal formatadas', () => {
    expect(() => ageInMonths('2026-02-29', '2027-01-01')).toThrow(RangeError);
    expect(() => ageInMonths('26/10/1990', '2027-01-01')).toThrow(RangeError);
  });
});

describe('fluxo de obra: soma exata em centavos', () => {
  const plan = { deliveryDate: '2030-03-15', signalRatio: 0.07, balloonRatio: 0.33, balloonIntervalMonths: 6 };

  it.each([0, 0.01, 0.07, 1234.56, 33333.33, 98765.43, 150000])('entrada %s', (downPayment) => {
    const flow = buildConstructionFlow(plan, '2026-10-26', downPayment, { financed: 200000, fgts: 10000, subsidy: 0 });
    const cents = Math.round(flow.signal * 100) + Math.round(flow.monthly.total * 100) + Math.round(flow.balloons.total * 100);
    expect(cents).toBe(Math.round(downPayment * 100));
    expect(flow.monthly.count).toBe(flow.monthsUntilDelivery - 1);
    expect(flow.balloons.months.every((m) => m % 6 === 0 && m < flow.monthsUntilDelivery)).toBe(true);
    expect(flow.signal).toBeGreaterThanOrEqual(roundCents(downPayment * plan.signalRatio) - 0.01);
    expect(flow.keys.total).toBe(210000);
  });

  it('sem reforços (ratio 0) tudo vira sinal + mensais', () => {
    const flow = buildConstructionFlow({ ...plan, balloonRatio: 0 }, '2026-10-26', 10000, { financed: 1, fgts: 0, subsidy: 0 });
    expect(flow.balloons.total).toBe(0);
    expect(roundCents(flow.signal + flow.monthly.total)).toBe(10000);
  });
});
