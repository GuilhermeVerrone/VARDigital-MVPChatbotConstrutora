import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { illustrativeSalesConditions, PaymentModeNotOfferedError, simulatePayment } from '@mvp/simulation';
import {
  buildPaymentInput,
  dateFromIso,
  getParametersInForce,
  IllustrativeSalesConditionRejectedError,
  isSimulationDataError,
  MissingSimulationDataError,
  NoSalesConditionInForceError,
  publishSalesCondition,
  runAndRecordPaymentSimulation,
  seedElevare,
} from '../src';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-11-05';
let t: TestDb;
let lumenId: string;
let unitId: string;
let leadId: string;

beforeAll(async () => {
  t = await createTestDb();
  await seedElevare(t.db, { today: TODAY });
  const lumen = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' }, include: { units: { where: { code: 'LU-0304' } } } });
  lumenId = lumen.id;
  unitId = lumen.units[0]!.id;
  const lead = await t.db.lead.create({
    data: { phone: '5500911110000', name: 'Maria', birthDate: new Date('1990-03-05'), source: 'SITE_FORM', developmentId: lumenId, status: 'IN_PROGRESS' },
  });
  leadId = lead.id;
  await t.db.financialProfile.create({
    data: {
      leadId,
      grossMonthlyIncome: 9000,
      incomeType: 'CLT',
      monthlyDebts: 500,
      availableDownPayment: 20000,
      cashNow: 30000,
      acceptsBalloons: true,
      ownsResidentialProperty: false,
      firstFinancing: true,
    },
  });
});
afterAll(() => t.drop());

const run = (mode: Parameters<typeof runAndRecordPaymentSimulation>[1]['mode'], extra: Partial<Parameters<typeof runAndRecordPaymentSimulation>[1]> = {}) =>
  runAndRecordPaymentSimulation(t.db, { leadId, unitId, mode, referenceDate: TODAY, ...extra });

describe('runAndRecordPaymentSimulation', () => {
  it('modo 1 (à vista): grava o modo e a versão da condição; sem parâmetros do banco', async () => {
    const { simulation, result, salesConditionVersion, parametersVersion } = await run('A_VISTA');
    expect(result.cash?.amountToPay).toBe(265880);
    expect(simulation).toMatchObject({ paymentMode: 'A_VISTA', verdict: 'VIAVEL', parameterSetId: null, parametersVersion: null });
    expect(simulation.propertyValue.toNumber()).toBe(289000);
    expect(salesConditionVersion).toBe(illustrativeSalesConditions['lumen-urban'].version);
    expect(parametersVersion).toBeNull();
    const stored = await t.db.simulation.findUniqueOrThrow({ where: { id: simulation.id }, include: { salesCondition: true } });
    expect(stored.salesCondition?.version).toBe(salesConditionVersion);
    expect(stored.downPaymentPlan).toBeNull();
  });

  it('modo 2 (entrada à vista): grava a entrada e a estimativa do banco com a versão dos parâmetros', async () => {
    const { simulation, result, parametersVersion } = await run('ENTRADA_A_VISTA', { choices: { cashNow: 80000 } });
    expect(result.downPayment?.chosen).toBeCloseTo(57800, 2);
    expect(result.bankEstimate).not.toBeNull();
    expect(simulation.paymentMode).toBe('ENTRADA_A_VISTA');
    expect(simulation.requiredDownPayment?.toNumber()).toBeCloseTo(57800, 2);
    expect(simulation.financedAmount?.toNumber()).toBeCloseTo(289000 - 57800, 2);
    expect(simulation.bankEstimate).not.toBeNull();
    expect(parametersVersion).not.toBeNull();
    expect(simulation.parametersVersion).toBe(parametersVersion);
    expect(simulation.parameterSetId).not.toBeNull();
  });

  it('modo 3 (entrada parcelada): grava o plano completo; a soma do plano é a entrada', async () => {
    const { simulation, result } = await run('ENTRADA_PARCELADA');
    expect(simulation.paymentMode).toBe('ENTRADA_PARCELADA');
    expect(result.plan).not.toBeNull();
    const plan = simulation.downPaymentPlan as { total: number; act: number; keys: { amount: number }; monthly: { total: number }; balloons: { total: number } };
    expect(plan).toEqual(JSON.parse(JSON.stringify(result.plan)));
    const sum = plan.act + plan.keys.amount + plan.monthly.total + plan.balloons.total;
    expect(plan.total).toBeCloseTo(result.downPayment!.chosen, 2);
    expect(sum).toBeGreaterThanOrEqual(plan.total - 0.01);
    expect(['VIAVEL', 'VIAVEL_COM_AJUSTES', 'INVIAVEL']).toContain(simulation.verdict);
    // o que foi gravado reproduz o cálculo (mesma entrada, mesma condição e mesmos parâmetros)
    const params = (await getParametersInForce(t.db, TODAY)).params;
    expect(simulatePayment(simulation.input, illustrativeSalesConditions['lumen-urban'], params)).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it('lê a condição VIGENTE na data e grava a versão usada', async () => {
    const base = illustrativeSalesConditions['lumen-urban'];
    await publishSalesCondition(t.db, {
      developmentId: lumenId,
      condition: { ...base, cash: { ...base.cash, discountRatio: 0.15 } },
      version: 'lumen-v2',
      validFrom: '2027-01-01',
      actor: 'ana',
      reason: 'campanha de janeiro',
      today: TODAY,
    });
    const before = await run('A_VISTA', { referenceDate: '2026-12-31' });
    const after = await run('A_VISTA', { referenceDate: '2027-01-01' });
    expect(before.salesConditionVersion).toBe(base.version);
    expect(after.salesConditionVersion).toBe('lumen-v2');
    expect(before.result.cash?.amountToPay).toBe(265880);
    expect(after.result.cash?.amountToPay).toBe(245650);
    const stored = await t.db.simulation.findUniqueOrThrow({ where: { id: after.simulation.id }, include: { salesCondition: true } });
    expect(stored.salesCondition?.version).toBe('lumen-v2');
    // a simulação antiga continua apontando para a versão que usou
    const old = await t.db.simulation.findUniqueOrThrow({ where: { id: before.simulation.id }, include: { salesCondition: true } });
    expect(old.salesCondition?.version).toBe(base.version);
  });

  it('sem parâmetros do banco vigentes na data, a estimativa é omitida e nenhuma versão de parâmetros é gravada', async () => {
    const dev = await t.db.development.create({ data: { slug: 'antigo', name: 'Antigo', city: 'X', description: 'x', deliveryDate: new Date('2028-12-01') } });
    const unit = await t.db.unit.create({ data: { developmentId: dev.id, code: 'X-1', typology: 'Studio', areaM2: 30, price: 300000 } });
    const base = illustrativeSalesConditions['lumen-urban'];
    await publishSalesCondition(t.db, { developmentId: dev.id, condition: base, version: 'antigo-v1', validFrom: '2025-06-01', actor: 'seed', reason: 'teste', today: TODAY, allowRetroactive: true });
    const res = await runAndRecordPaymentSimulation(t.db, { leadId, unitId: unit.id, mode: 'ENTRADA_A_VISTA', referenceDate: '2025-12-31', choices: { cashNow: 90000 } });
    expect(res.result.bankEstimate).toBeNull();
    expect(res.parametersVersion).toBeNull();
    expect(res.simulation.parameterSetId).toBeNull();
    expect(res.simulation.salesConditionId).not.toBeNull();
  });

  it('dados faltando: nascimento para a estimativa, perfil para o modo 3', async () => {
    const semNascimento = await t.db.lead.create({ data: { phone: '5500911110001', name: 'Sem Data' } });
    await expect(runAndRecordPaymentSimulation(t.db, { leadId: semNascimento.id, unitId, mode: 'ENTRADA_A_VISTA', referenceDate: TODAY, choices: { cashNow: 80000 } })).rejects.toMatchObject({
      missing: expect.arrayContaining(['financialProfile']),
    });
    await expect(runAndRecordPaymentSimulation(t.db, { leadId: semNascimento.id, unitId, mode: 'ENTRADA_PARCELADA', referenceDate: TODAY })).rejects.toBeInstanceOf(MissingSimulationDataError);
    // o modo 1 não pede nada do lead
    expect((await runAndRecordPaymentSimulation(t.db, { leadId: semNascimento.id, unitId, mode: 'A_VISTA', referenceDate: TODAY })).simulation.verdict).toBe('VIAVEL');
  });

  it('recusas tipadas: sem condição vigente, ILUSTRATIVO em produção, modo não oferecido', async () => {
    await expect(run('A_VISTA', { referenceDate: '2025-12-31' })).rejects.toBeInstanceOf(NoSalesConditionInForceError);
    await expect(run('A_VISTA', { rejectIllustrative: true })).rejects.toBeInstanceOf(IllustrativeSalesConditionRejectedError);

    const parc = await t.db.development.findUniqueOrThrow({ where: { slug: 'parc-verde' }, include: { units: { take: 1 } } });
    const base = illustrativeSalesConditions['parc-verde'];
    await publishSalesCondition(t.db, {
      developmentId: parc.id,
      condition: { ...base, installments: { ...base.installments, enabled: false } },
      version: 'parc-sem-modo-3',
      validFrom: '2026-12-01',
      actor: 'ana',
      reason: 'modo 3 suspenso',
      today: TODAY,
    });
    const err = await runAndRecordPaymentSimulation(t.db, { leadId, unitId: parc.units[0]!.id, mode: 'ENTRADA_PARCELADA', referenceDate: '2026-12-02' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentModeNotOfferedError);
    expect(isSimulationDataError(err)).toBe(true);
    expect(isSimulationDataError(new Error('banco caiu'))).toBe(false);
    expect(await t.db.simulation.count({ where: { unitId: parc.units[0]!.id } })).toBe(0);
  });
});

describe('buildPaymentInput', () => {
  const condition = illustrativeSalesConditions['lumen-urban'];
  const unit = { price: { toNumber: () => 289000 } } as never;
  const development = { deliveryDate: dateFromIso('2029-12-15') };

  it('com a estimativa do banco desligada, a data de nascimento não é exigida', () => {
    const input = buildPaymentInput({
      mode: 'ENTRADA_A_VISTA',
      lead: { birthDate: null },
      profile: null,
      unit,
      development,
      condition: { ...condition, bankEstimate: { enabled: false } },
      referenceDate: TODAY,
      choices: { cashNow: 70000 },
    });
    expect(input).toMatchObject({ mode: 'ENTRADA_A_VISTA', cashNow: 70000, financing: null, unitPrice: 289000, deliveryDate: '2029-12-15' });
  });

  it('com a estimativa ligada e sem nascimento, pede o dado', () => {
    expect(() =>
      buildPaymentInput({ mode: 'ENTRADA_A_VISTA', lead: { birthDate: null }, profile: { cashNow: null, availableDownPayment: { toNumber: () => 1 } } as never, unit, development, condition, referenceDate: TODAY }),
    ).toThrow(/lead\.birthDate/);
  });
});
