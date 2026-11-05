import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markDelivered, saveTurn, seedDatabase } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());

const history = (leadId: string) =>
  t.db.auditLog.findMany({ where: { entity: 'lead', entityId: leadId, action: 'status_changed' }, orderBy: { id: 'asc' } });

describe('histórico de status do lead', () => {
  it('cada mudança de status vira um evento com o antes e o depois; repetir o mesmo status não grava', async () => {
    const lead = await t.db.lead.create({ data: { name: 'Ana', phone: '5541999990001' } });
    const conv = await t.db.conversation.create({ data: { leadId: lead.id, channel: 'WHATSAPP', state: 'NAME' } });
    const turn = (status: 'IN_PROGRESS' | 'SIMULATED') =>
      saveTurn(t.db, { conversationId: conv.id, leadId: lead.id, state: 'NAME', context: {}, history: [], writes: { status } });

    await turn('IN_PROGRESS');
    await turn('IN_PROGRESS');
    await turn('SIMULATED');
    await markDelivered(t.db, lead.id);
    await markDelivered(t.db, lead.id);

    const rows = await history(lead.id);
    expect(rows.map((r) => [r.actor, (r.before as { status: string }).status, (r.after as { status: string }).status])).toEqual([
      ['bot', 'NEW', 'IN_PROGRESS'],
      ['bot', 'IN_PROGRESS', 'SIMULATED'],
      ['bot', 'SIMULATED', 'DELIVERED'],
    ]);
  });
});
