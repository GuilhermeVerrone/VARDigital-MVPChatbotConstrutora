import { illustrativeParameters, simulate, type SimulationInput } from '@mvp/simulation';

/** Cadastro só com linhas que têm limite de renda: dá para não haver linha elegível. */
export const paramsWithoutSbpe = { ...illustrativeParameters, creditLines: illustrativeParameters.creditLines.filter((l) => l.id !== 'sbpe') };
import type { SimulationView } from '../src';

export const baseInput = (over: Partial<SimulationInput> = {}): SimulationInput => ({
  referenceDate: '2026-10-29',
  propertyValue: 219000,
  applicant: { birthDate: '1990-03-05', grossMonthlyIncome: 7000, incomeType: 'CLT', monthlyDebts: 800, fgts: { balance: 15000, contributionMonths: 36 } },
  coApplicant: null,
  availableDownPayment: 70000,
  ownsResidentialProperty: false,
  firstFinancing: true,
  construction: { deliveryDate: '2029-06-30', signalRatio: 0.1, balloonRatio: 0.3, balloonIntervalMonths: 12 },
  ...over,
});

export function viewFor(input: SimulationInput, over: Partial<SimulationView> = {}, params: unknown = illustrativeParameters): SimulationView {
  return {
    leadName: 'Maria da Silva',
    phone: '5513981264295',
    email: 'maria@gmail.com',
    development: { name: 'Residencial Exemplo (ILUSTRATIVO)', city: 'Cidade Exemplo - UF' },
    unit: { code: 'A-101', typology: '2 dormitórios', areaM2: 42.5 },
    input,
    result: simulate(input, params),
    generatedAt: new Date('2026-10-29T15:00:00Z'),
    simulationId: '5f0d6f46-4c3b-4a9e-9d58-0c1f2f2f3c11',
    ...over,
  };
}

/** Cenários que cobrem os três pareceres e as saídas sem parcela. */
export const SCENARIOS: Record<string, SimulationInput> = {
  viavel: baseInput(),
  ajustes: baseInput({ availableDownPayment: 58000 }),
  faltaEntrada: baseInput({ availableDownPayment: 20000 }),
  semCapacidade: baseInput({ availableDownPayment: 0, applicant: { ...baseInput().applicant, monthlyDebts: 2100 } }),
  semLinha: baseInput({ propertyValue: 600000, availableDownPayment: 100000 }),
  idadeLimite: baseInput({ applicant: { ...baseInput().applicant, birthDate: '1955-01-10' } }),
  coProponente: baseInput({ coApplicant: { birthDate: '1988-07-20', grossMonthlyIncome: 4000, incomeType: 'AUTONOMO', monthlyDebts: 0, fgts: null } }),
  semObra: baseInput({ construction: null }),
};
