import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeParameters, simulate } from '@mvp/simulation';
import {
  changeParameters,
  dateFromIso,
  getParametersInForce,
  IllustrativeParametersRejectedError,
  listParameterSets,
  MissingSimulationDataError,
  NoParametersInForceError,
  runAndRecordSimulation,
  seedDatabase,
} from '../src';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-10-27';
let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.drop());

describe('seed', () => {
  it('cria 1 empreendimento, unidades, 3 linhas de crédito e 2 corretores; rodar de novo não duplica', async () => {
    const first = await seedDatabase(t.db, { today: TODAY });
    expect(first).toMatchObject({ parameters: 'created', parametersVersion: illustrativeParameters.version, units: 6, brokers: 2 });
    const second = await seedDatabase(t.db, { today: TODAY });
    expect(second).toMatchObject({ parameters: 'kept', developmentId: first.developmentId });

    expect(await t.db.development.count()).toBe(1);
    expect(await t.db.unit.count()).toBe(6);
    expect(await t.db.broker.count()).toBe(2);
    expect(await t.db.parameterSet.count()).toBe(1);
    expect((await t.db.creditLine.findMany({ orderBy: { priority: 'asc' } })).map((l) => l.code)).toEqual([
      'programa-habitacional-faixa-a',
      'programa-habitacional-faixa-b',
      'sbpe',
    ]);
    const dev = await t.db.development.findFirstOrThrow({ include: { units: true } });
    expect(dev.dataStatus).toBe('ILUSTRATIVO');
    expect(dev.units.every((u) => u.status === 'AVAILABLE')).toBe(true);
    // contatos fictícios, inalcançáveis
    expect((await t.db.broker.findMany()).every((b) => b.phone.startsWith('5500') && b.email!.endsWith('.invalid'))).toBe(true);
  });

  it('não sobrescreve parâmetros já alterados pela CLI', async () => {
    await seedDatabase(t.db, { today: TODAY });
    await changeParameters(t.db, { set: ['lines.sbpe.maxLtv=0.7'], validFrom: '2026-11-01', actor: 'ana', reason: 'x', today: TODAY });
    await seedDatabase(t.db, { today: TODAY });
    expect(await listParameterSets(t.db)).toHaveLength(2);
    expect((await getParametersInForce(t.db, '2026-11-01')).params.creditLines.find((l) => l.id === 'sbpe')!.maxLtv).toBe(0.7);
  });
});

describe('simulação com parâmetros vigentes (aceite da Fase 2)', () => {
  async function leadWithProfile(overrides: Record<string, unknown> = {}) {
    return t.db.lead.create({
      data: {
        name: 'Lead Teste',
        phone: '5500988887777',
        birthDate: dateFromIso('1990-05-20'),
        financialProfile: {
          create: {
            grossMonthlyIncome: 12000,
            incomeType: 'CLT',
            monthlyDebts: 500,
            availableDownPayment: 90000,
            fgtsBalance: 20000,
            fgtsContributionMonths: 60,
            ownsResidentialProperty: false,
            firstFinancing: true,
            ...overrides,
          },
        },
      },
    });
  }
  const unit = (code: string) => t.db.unit.findFirstOrThrow({ where: { code } });

  beforeEach(async () => {
    await seedDatabase(t.db, { today: TODAY });
  });

  it('lê a versão vigente NA DATA da simulação e grava parametros_versao; antes e depois de uma alteração via CLI', async () => {
    const lead = await leadWithProfile();
    const u = await unit('B-1501'); // R$ 520 mil → só SBPE

    const before = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: '2026-10-27' });
    expect(before.simulation.parametersVersion).toBe(illustrativeParameters.version);
    expect(before.result.parametersVersion).toBe(illustrativeParameters.version);
    expect(before.result.selected!.lineId).toBe('sbpe');

    await changeParameters(t.db, { set: ['lines.sbpe.annualInterestRate=0.1299'], validFrom: '2026-11-01', actor: 'ana', reason: 'alta da taxa', today: TODAY });

    // mesma data de antes → mesma versão e mesmo número (reprodutível)
    const again = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: '2026-10-27' });
    expect(again.simulation.parametersVersion).toBe(illustrativeParameters.version);
    expect(again.simulation.firstInstallment!.toNumber()).toBe(before.simulation.firstInstallment!.toNumber());

    // a partir da vigência nova → versão nova, taxa nova, parcela maior
    const after = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: '2026-11-01' });
    expect(after.simulation.parametersVersion).toBe('v2-2026-11-01');
    expect(after.result.selected!.financing!.rates.effectiveAnnual).toBeCloseTo(0.1299, 10);
    expect(before.result.selected!.financing!.rates.effectiveAnnual).toBeCloseTo(0.1149, 10);

    // a simulação gravada antes continua apontando para a versão que usou (FK + texto)
    const stored = await t.db.simulation.findUniqueOrThrow({ where: { id: before.simulation.id }, include: { parameterSet: true, creditLine: true } });
    expect(stored.parameterSet.version).toBe(illustrativeParameters.version);
    expect(stored.creditLine!.code).toBe('sbpe');
    expect(stored.creditLine!.annualInterestRate.toNumber()).toBe(0.1149);
    const storedAfter = await t.db.simulation.findUniqueOrThrow({ where: { id: after.simulation.id }, include: { creditLine: true } });
    expect(storedAfter.creditLine!.annualInterestRate.toNumber()).toBe(0.1299);
    expect(storedAfter.creditLine!.parameterSetId).toBe(after.simulation.parameterSetId);
  });

  it('o que foi gravado é exatamente o que o motor puro calcula com a versão vigente', async () => {
    const lead = await leadWithProfile({ grossMonthlyIncome: 4200, monthlyDebts: 150, availableDownPayment: 55000, fgtsBalance: 18000, fgtsContributionMonths: 48 });
    const u = await unit('A-504');
    const { simulation, result } = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: TODAY, choices: { system: 'SAC' } });

    const params = await getParametersInForce(t.db, TODAY);
    const pure = simulate(simulation.input, params.params);
    expect(result).toEqual(pure);
    expect(simulation.result).toEqual(JSON.parse(JSON.stringify(pure)));

    const f = pure.selected!.financing!;
    expect(simulation.verdict).toBe(pure.verdict);
    expect(simulation.system).toBe('SAC');
    expect(simulation.termMonths).toBe(pure.selected!.term!.months);
    expect(simulation.propertyValue.toNumber()).toBe(240000);
    expect(simulation.financedAmount!.toNumber()).toBe(f.financedAmount);
    expect(simulation.requiredDownPayment!.toNumber()).toBe(f.requiredDownPayment);
    expect(simulation.subsidy!.toNumber()).toBe(f.subsidy);
    expect(simulation.fgtsUsed!.toNumber()).toBe(f.fgtsUsed);
    expect(simulation.firstInstallment!.toNumber()).toBe(f.firstInstallment!.total);
    expect(simulation.lastInstallment!.toNumber()).toBe(f.lastInstallment!.total);
    expect(simulation.constructionFlow).toEqual(JSON.parse(JSON.stringify(f.constructionFlow)));
    expect(simulation.input).toMatchObject({
      referenceDate: TODAY,
      propertyValue: 240000,
      construction: { deliveryDate: '2029-06-30', signalRatio: 0.1, balloonRatio: 0.3, balloonIntervalMonths: 12 },
    });
    // mesmo caso do exemplo do motor (packages/simulation/examples/lead-exemplo.json): faixa A
    expect(pure.selected!.lineId).toBe('programa-habitacional-faixa-a');
  });

  it('co-proponente vem do perfil; sem capacidade de pagamento grava INVIAVEL com a versão usada', async () => {
    const lead = await leadWithProfile({
      grossMonthlyIncome: 3000,
      monthlyDebts: 0,
      availableDownPayment: 0,
      fgtsBalance: null,
      coApplicantIncome: 2500,
      coApplicantIncomeType: 'AUTONOMO',
      coApplicantBirthDate: dateFromIso('1993-01-10'),
    });
    const u = await unit('A-101');
    const ok = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: TODAY });
    expect(ok.simulation.input).toMatchObject({ coApplicant: { grossMonthlyIncome: 2500, incomeType: 'AUTONOMO', monthlyDebts: 0, fgts: null } });
    expect(ok.result.selected!.capacity!.familyIncome).toBe(5500);

    await t.db.financialProfile.update({ where: { leadId: lead.id }, data: { ownsResidentialProperty: true, firstFinancing: false, grossMonthlyIncome: 1000, coApplicantIncome: null } });
    // SBPE aceita quem já tem imóvel; com renda de 1000 não há capacidade → INVIAVEL, mas com linha
    const low = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: (await unit('B-1501')).id, referenceDate: TODAY });
    expect(low.simulation.verdict).toBe('INVIAVEL');
    expect(low.simulation.parametersVersion).toBe(illustrativeParameters.version);
  });

  it('recusa simular sem tabela vigente, sem dados mínimos, ou com ILUSTRATIVO em produção (nada gravado)', async () => {
    const lead = await leadWithProfile();
    const u = await unit('A-101');
    await expect(runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: '2025-12-31' })).rejects.toBeInstanceOf(NoParametersInForceError);
    await expect(
      runAndRecordSimulation(t.db, { leadId: lead.id, unitId: u.id, referenceDate: TODAY, rejectIllustrative: true }),
    ).rejects.toBeInstanceOf(IllustrativeParametersRejectedError);

    const noBirth = await t.db.lead.create({ data: { phone: '5500900001111', financialProfile: { create: { grossMonthlyIncome: 5000, incomeType: 'CLT', ownsResidentialProperty: false, firstFinancing: true } } } });
    await expect(runAndRecordSimulation(t.db, { leadId: noBirth.id, unitId: u.id, referenceDate: TODAY })).rejects.toThrow(MissingSimulationDataError);
    const noProfile = await t.db.lead.create({ data: { phone: '5500900002222', birthDate: dateFromIso('1990-01-01') } });
    await expect(runAndRecordSimulation(t.db, { leadId: noProfile.id, unitId: u.id, referenceDate: TODAY })).rejects.toThrow(/financialProfile/);

    expect(await t.db.simulation.count()).toBe(0);
  });
});
