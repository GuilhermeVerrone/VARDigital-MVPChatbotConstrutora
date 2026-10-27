import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSchedule, maxPrincipalForInstallment, pricePayment, roundCents, toRates, type AmortizationSystem, type MonthlyCharges } from '../src';

interface ReferenceCase {
  id: string;
  description: string;
  system: AmortizationSystem;
  principal: number;
  annualRate: number;
  rateConvention: 'NOMINAL' | 'EFFECTIVE';
  termMonths: number;
  charges: MonthlyCharges;
  maxInstallment: number;
  expected: {
    monthlyRate: number;
    first: Record<string, number>;
    last: Record<string, number>;
    totals: Record<string, number>;
    maxPrincipal: number;
  };
}

// Todo arquivo em test/fixtures/ com esse formato entra na suíte (ex.: planilha do financeiro).
const fixturesDir = join(import.meta.dirname, 'fixtures');
const referenceCases: ReferenceCase[] = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as { cases: ReferenceCase[] }).cases);

const pick = (i: { amortization: number; interest: number; mip: number; dfi: number; fees: number; total: number }) => ({
  amortization: i.amortization,
  interest: i.interest,
  mip: i.mip,
  dfi: i.dfi,
  fees: i.fees,
  total: i.total,
});

describe('casos de livro-texto (conferíveis à mão)', () => {
  it('Price: 100.000 a 1% a.m. em 12 meses → parcela 8.884,88', () => {
    expect(roundCents(pricePayment(100000, 0.01, 12))).toBe(8884.88);
    const s = buildSchedule('PRICE', 100000, 0.01, 12);
    expect(new Set(s.installments.map((i) => i.total))).toEqual(new Set([8884.88]));
    expect(s.installments[0]).toMatchObject({ interest: 1000, amortization: 7884.88 });
  });

  it('SAC: 120.000 a 1% a.m. em 12 meses → 11.200 … 10.100, juros 7.800', () => {
    const s = buildSchedule('SAC', 120000, 0.01, 12);
    expect(s.installments[0]).toMatchObject({ amortization: 10000, interest: 1200, total: 11200 });
    expect(s.installments[1]).toMatchObject({ interest: 1100, total: 11100 });
    expect(s.installments[11]).toMatchObject({ amortization: 10000, interest: 100, total: 10100, balanceAfter: 0 });
    expect(s.totals).toMatchObject({ interest: 7800, amortization: 120000, paid: 127800 });
  });

  it('seguros e taxa: MIP sobre o saldo, DFI e taxa fixos', () => {
    const s = buildSchedule('SAC', 120000, 0.01, 12, { mipMonthlyRate: 0.001, dfiMonthly: 10, feesMonthly: 25 });
    // 10.000 + 1.200 + 120 (MIP 0,1% de 120.000) + 10 + 25
    expect(s.installments[0]).toMatchObject({ mip: 120, dfi: 10, fees: 25, total: 11355 });
    // última: saldo 10.000 → juros 100, MIP 10
    expect(s.installments[11]).toMatchObject({ mip: 10, total: 10145 });
    expect(s.totals.fees).toBe(300);
  });
});

describe(`casos de referência calculados à parte (${referenceCases.length} casos, Python decimal)`, () => {
  it.each(referenceCases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const rates = toRates(c.annualRate, c.rateConvention);
    expect(rates.monthly).toBeCloseTo(c.expected.monthlyRate, 14);

    const s = buildSchedule(c.system, c.principal, rates.monthly, c.termMonths, c.charges);
    expect(pick(s.installments[0]!)).toEqual(c.expected.first);
    expect(pick(s.installments[s.installments.length - 1]!)).toEqual(c.expected.last);
    expect(s.totals).toEqual(c.expected.totals);
    expect(maxPrincipalForInstallment(c.system, c.maxInstallment, rates.monthly, c.termMonths, c.charges)).toBe(
      c.expected.maxPrincipal,
    );
  });
});

describe('propriedades do cronograma', () => {
  const charges = { mipMonthlyRate: 0.00028, dfiMonthly: 21, feesMonthly: 25 };
  const i = toRates(0.1149, 'EFFECTIVE').monthly;

  it.each(['SAC', 'PRICE'] as const)('%s quita o saldo e amortiza exatamente o principal', (system) => {
    const s = buildSchedule(system, 287345.67, i, 417, charges);
    expect(s.installments).toHaveLength(417);
    expect(s.installments.at(-1)!.balanceAfter).toBe(0);
    expect(s.totals.amortization).toBe(287345.67);
  });

  it('SAC: amortização constante e parcelas decrescentes', () => {
    const s = buildSchedule('SAC', 300000, i, 360, charges);
    expect(new Set(s.installments.map((x) => x.amortization))).toEqual(new Set([833.33]));
    for (let k = 1; k < s.installments.length; k++) {
      expect(s.installments[k]!.total).toBeLessThan(s.installments[k - 1]!.total);
    }
  });

  it('Price: parcela-base (amortização + juros) constante', () => {
    const s = buildSchedule('PRICE', 300000, i, 360);
    expect(new Set(s.installments.map((x) => x.total)).size).toBe(1);
  });

  it.each(['SAC', 'PRICE'] as const)('%s: teto de financiamento é o maior valor cuja 1ª parcela cabe', (system) => {
    for (const cap of [800, 1234.56, 3000, 9999.99]) {
      const pv = maxPrincipalForInstallment(system, cap, i, 360, charges);
      expect(buildSchedule(system, pv, i, 360, charges).installments[0]!.total).toBeLessThanOrEqual(cap);
      expect(buildSchedule(system, pv + 1, i, 360, charges).installments[0]!.total).toBeGreaterThan(cap);
    }
  });

  it('teto é zero se a parcela não cobre nem seguros/taxas', () => {
    expect(maxPrincipalForInstallment('SAC', 40, i, 360, charges)).toBe(0);
    expect(maxPrincipalForInstallment('PRICE', -100, i, 360)).toBe(0);
  });

  it('rejeita prazo e valor inválidos', () => {
    expect(() => buildSchedule('SAC', 1000, 0.01, 0)).toThrow(RangeError);
    expect(() => buildSchedule('SAC', 1000, 0.01, 12.5)).toThrow(RangeError);
    expect(() => buildSchedule('PRICE', 0, 0.01, 12)).toThrow(RangeError);
  });
});
