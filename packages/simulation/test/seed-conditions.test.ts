import { describe, expect, it } from 'vitest';
import { illustrativeSalesConditions, offeredModes, simulatePayment } from '../src';

describe('seed ILUSTRATIVO das condições comerciais', () => {
  const entries = Object.entries(illustrativeSalesConditions);

  it('cobre os 3 empreendimentos Elevare', () => {
    expect(Object.keys(illustrativeSalesConditions).sort()).toEqual(['altomare', 'lumen-urban', 'parc-verde']);
  });

  it.each(entries)('%s: ILUSTRATIVO, vigente e com os 3 modos', (_slug, condition) => {
    expect(condition.status).toBe('ILUSTRATIVO');
    expect(condition.validTo).toBeNull();
    expect(offeredModes(condition)).toEqual(['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA']);
  });

  it.each(entries)('%s: simula os 3 modos e sempre avisa que é ilustrativo', (_slug, condition) => {
    const common = { referenceDate: '2026-11-04', unitPrice: 500000, deliveryDate: '2028-11-04' };
    const results = [
      simulatePayment({ ...common, mode: 'A_VISTA' }, condition),
      simulatePayment({ ...common, mode: 'ENTRADA_A_VISTA', cashNow: 200000 }, condition),
      simulatePayment(
        { ...common, mode: 'ENTRADA_PARCELADA', cashNow: 80000, buyers: [{ grossMonthlyIncome: 20000, monthlyDebts: 0 }], acceptsBalloons: true },
        condition,
      ),
    ];
    for (const r of results) expect(r.alerts.map((a) => a.code)).toContain('ILLUSTRATIVE_CONDITION');
  });

  it('as condições diferem entre si (cada empreendimento tem a sua)', () => {
    const versions = new Set(entries.map(([, c]) => c.version));
    expect(versions.size).toBe(3);
  });
});
