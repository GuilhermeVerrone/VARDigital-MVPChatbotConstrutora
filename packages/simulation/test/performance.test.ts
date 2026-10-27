import { describe, expect, it } from 'vitest';
import { illustrativeParameters, simulate } from '../src';
import { baseInput } from './helpers';

// Spec §7.1 / aceite da Fase 1: cálculo da simulação em menos de 1 segundo.
describe('desempenho', () => {
  const input = baseInput({
    propertyValue: 240000,
    applicant: { ...baseInput().applicant, grossMonthlyIncome: 4500, fgts: { balance: 15000, contributionMonths: 60 } },
    coApplicant: { ...baseInput().applicant, grossMonthlyIncome: 2500 },
    construction: { deliveryDate: '2029-12-31', signalRatio: 0.1, balloonRatio: 0.3, balloonIntervalMonths: 6 },
  });

  it('uma simulação completa (3 linhas, cronogramas de até 420 meses) leva < 1 s', () => {
    const t0 = performance.now();
    simulate(input, illustrativeParameters);
    const ms = performance.now() - t0;
    console.info(`[desempenho] simulação única (fria): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(1000);
  });

  it('100 simulações seguidas em < 1 s (folga para concorrência)', () => {
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) simulate(input, illustrativeParameters);
    const ms = performance.now() - t0;
    console.info(`[desempenho] 100 simulações: ${ms.toFixed(1)} ms (${(ms / 100).toFixed(3)} ms cada)`);
    expect(ms).toBeLessThan(1000);
  });
});
