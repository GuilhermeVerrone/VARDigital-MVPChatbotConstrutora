import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignBroker, claimNextJob, completeJob, deferJob, enqueueJob, failJob, pickUnitForTypology, requeueDeadJob, runAndRecordSimulation, seedDatabase } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
const TODAY = '2026-10-29';

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: TODAY });
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate delivery_jobs, crm_simulations, crm_contacts, simulations, financial_profiles, leads cascade');
  await t.sql('update brokers set last_assigned_at = null, active = true');
});

async function simulationId(phone = '5513981264295') {
  const lead = await t.db.lead.create({ data: { phone, name: 'Maria da Silva', birthDate: new Date('1990-03-05'), status: 'IN_PROGRESS' } });
  await t.db.financialProfile.create({
    data: { leadId: lead.id, grossMonthlyIncome: 7000, incomeType: 'CLT', monthlyDebts: 0, availableDownPayment: 40000, ownsResidentialProperty: false, firstFinancing: true },
  });
  const unit = (await pickUnitForTypology(t.db, '2 dormitórios'))!;
  const { simulation } = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: unit.id, referenceDate: TODAY });
  return { leadId: lead.id, simulationId: simulation.id };
}

describe('pickUnitForTypology', () => {
  it('devolve a unidade disponível mais barata da tipologia', async () => {
    expect((await pickUnitForTypology(t.db, '2 dormitórios'))?.code).toBe('A-101');
    expect(await pickUnitForTypology(t.db, 'castelo')).toBeNull();
  });
});

describe('fila de entregas', () => {
  const opts = { lockMs: 60_000, maxAttempts: 3 };

  it('não enfileira a mesma entrega duas vezes (dedupeKey)', async () => {
    const { simulationId: id } = await simulationId();
    expect(await enqueueJob(t.db, { kind: 'CRM_SYNC', simulationId: id })).toBe(true);
    expect(await enqueueJob(t.db, { kind: 'CRM_SYNC', simulationId: id })).toBe(false);
    expect(await enqueueJob(t.db, { kind: 'CRM_SYNC', simulationId: id, dedupeKey: `CRM_SYNC:${id}:2` })).toBe(true);
    expect(await t.db.deliveryJob.count()).toBe(2);
  });

  it('reserva, conclui e não devolve de novo; falha reagenda com espera e depois vira DEAD', async () => {
    const { simulationId: id } = await simulationId();
    await enqueueJob(t.db, { kind: 'BROKER_NOTIFY', simulationId: id, availableAt: new Date('2026-10-29T11:00:00Z') });
    const now = new Date('2026-10-29T12:00:00Z');

    const first = await claimNextJob(t.db, { ...opts, now });
    expect(first).toMatchObject({ kind: 'BROKER_NOTIFY', simulationId: id, attempts: 1 });
    expect(await claimNextJob(t.db, { ...opts, now })).toBeNull(); // reservado

    await failJob(t.db, first!.id, { error: 'boom', retryAt: new Date(now.getTime() + 10_000) });
    expect(await claimNextJob(t.db, { ...opts, now })).toBeNull(); // ainda em espera
    const later = new Date(now.getTime() + 11_000);
    const second = await claimNextJob(t.db, { ...opts, now: later });
    expect(second?.attempts).toBe(2);

    await failJob(t.db, second!.id, { error: 'permanente', retryAt: null });
    expect((await t.db.deliveryJob.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('DEAD');
    expect(await requeueDeadJob(t.db, first!.id, later)).toBe(true);
    const third = await claimNextJob(t.db, { ...opts, now: later });
    expect(third?.attempts).toBe(1);
    expect(await completeJob(t.db, third!.id)).toBe(true);
    expect(await claimNextJob(t.db, { ...opts, now: later })).toBeNull();
  });

  it('reserva vencida volta para a fila; sem tentativas restantes vira DEAD', async () => {
    const { simulationId: id } = await simulationId();
    await enqueueJob(t.db, { kind: 'CRM_SYNC', simulationId: id, availableAt: new Date('2026-10-29T11:00:00Z') });
    const t0 = new Date('2026-10-29T12:00:00Z');
    expect((await claimNextJob(t.db, { ...opts, now: t0 }))?.attempts).toBe(1);
    const t1 = new Date(t0.getTime() + 61_000);
    expect((await claimNextJob(t.db, { ...opts, now: t1 }))?.attempts).toBe(2);
    const t2 = new Date(t1.getTime() + 61_000);
    expect((await claimNextJob(t.db, { ...opts, now: t2 }))?.attempts).toBe(3);
    const t3 = new Date(t2.getTime() + 61_000);
    expect(await claimNextJob(t.db, { ...opts, now: t3 })).toBeNull();
    expect((await t.db.deliveryJob.findFirstOrThrow()).status).toBe('DEAD');
  });

  it('filtra por tipo', async () => {
    const { simulationId: id } = await simulationId();
    await enqueueJob(t.db, { kind: 'CRM_SYNC', simulationId: id });
    expect(await claimNextJob(t.db, { ...opts, kinds: ['BROKER_NOTIFY'] })).toBeNull();
    expect((await claimNextJob(t.db, { ...opts, kinds: ['CRM_SYNC'] }))?.kind).toBe('CRM_SYNC');
  });

  it('FIRST_CONTACT (V2) é enfileirado uma vez e reservado como os outros tipos', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5500900000042', source: 'SITE_FORM' } });
    expect(await enqueueJob(t.db, { kind: 'FIRST_CONTACT', leadId: lead.id })).toBe(true);
    expect(await enqueueJob(t.db, { kind: 'FIRST_CONTACT', leadId: lead.id })).toBe(false);
    expect(await claimNextJob(t.db, opts)).toMatchObject({ kind: 'FIRST_CONTACT', leadId: lead.id, attempts: 1 });
  });

  it('deferJob devolve o job para a fila na hora marcada sem gastar tentativa', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5500900000043', source: 'SITE_FORM' } });
    const now = new Date('2026-11-05T12:00:00Z');
    await enqueueJob(t.db, { kind: 'FIRST_CONTACT', leadId: lead.id, availableAt: now });
    const job = (await claimNextJob(t.db, { ...opts, now }))!;
    const until = new Date(now.getTime() + 3_600_000);
    expect(await deferJob(t.db, job.id, until, 'fora do horário')).toBe(true);
    expect(await claimNextJob(t.db, { ...opts, now })).toBeNull();
    expect(await claimNextJob(t.db, { ...opts, now: until })).toMatchObject({ id: job.id, attempts: 1 });
  });
});

describe('atribuição de corretor (round-robin)', () => {
  it('alterna entre os corretores ativos e mantém o já atribuído', async () => {
    const a = await simulationId('5513981264295');
    const b = await simulationId('5513981264296');
    const c = await simulationId('5513981264297');
    const first = (await assignBroker(t.db, a.leadId))!;
    const second = (await assignBroker(t.db, b.leadId))!;
    const third = (await assignBroker(t.db, c.leadId))!;
    expect(first.id).not.toBe(second.id);
    expect(third.id).toBe(first.id);
    expect(first.existing).toBe(false);

    const again = (await assignBroker(t.db, a.leadId))!;
    expect(again).toMatchObject({ id: first.id, existing: true });
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: a.leadId } })).brokerId).toBe(first.id);
    expect(await t.db.auditLog.count({ where: { action: 'broker_assigned' } })).toBe(3);
  });

  it('ignora corretor inativo; sem nenhum ativo devolve null', async () => {
    const a = await simulationId('5513981264295');
    await t.sql(`update brokers set active = false where phone = '5500900000001'`);
    expect((await assignBroker(t.db, a.leadId))?.phone).toBe('5500900000002');
    const b = await simulationId('5513981264296');
    await t.sql('update brokers set active = false');
    expect(await assignBroker(t.db, b.leadId)).toBeNull();
  });

  it('lead conhecido no CRM (mesmo telefone) vai para o responsável', async () => {
    const a = await simulationId('5513981264295');
    const second = await t.db.broker.findFirstOrThrow({ where: { phone: '5500900000002' } });
    await t.db.crmContact.create({ data: { phone: '5513981264295', ownerBrokerId: second.id } });
    expect(await assignBroker(t.db, a.leadId)).toMatchObject({ id: second.id, existing: true });
  });
});
