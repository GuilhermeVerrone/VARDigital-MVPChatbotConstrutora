import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '@mvp/db';
import { createTestDb, type TestDb } from '../../db/test/db';
import { SimulatedCrm } from '../src';
import { crmContract } from './contract';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());
beforeEach(() => t.sql('truncate crm_simulations, crm_contacts, simulations, leads cascade'));

// O contrato roda sobre o banco: `make` limpa e devolve os corretores do seed.
crmContract('SimulatedCrm', async () => {
  await t.sql('truncate crm_simulations, crm_contacts cascade');
  const brokers = await t.db.broker.findMany({ orderBy: { name: 'asc' } });
  return {
    crm: new SimulatedCrm(t.db),
    ownerIds: brokers.map((b) => b.id),
    countContacts: () => t.db.crmContact.count(),
  };
});

describe('SimulatedCrm', () => {
  it('atualização mantém nome e e-mail quando o novo valor vem vazio e guarda o último estado', async () => {
    const crm = new SimulatedCrm(t.db);
    await crm.upsertContact({ phone: '5513981264295', name: 'Maria da Silva', email: 'maria@gmail.com', scoreClass: 'HOT', status: 'SIMULATED', development: 'X', brokerId: null });
    await crm.upsertContact({ phone: '5513981264295', name: null, email: null, scoreClass: 'WARM', status: 'DELIVERED', development: 'X', brokerId: null });
    const row = await t.db.crmContact.findUniqueOrThrow({ where: { phone: '5513981264295' } });
    expect(row).toMatchObject({ name: 'Maria da Silva', email: 'maria@gmail.com', data: { status: 'DELIVERED', scoreClass: 'WARM' } });
  });
});
