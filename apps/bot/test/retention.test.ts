import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedDatabase } from '@mvp/db';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createRetention } from '../src/retention';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate erasure_tasks, processed_messages, audit_logs, consents, conversations, leads cascade');
});

const log = () => ({ info: vi.fn(), error: vi.fn() });

describe('retenção', () => {
  it('apaga quem está parado há mais que o prazo e preserva os ativos', async () => {
    const now = new Date('2027-05-01T00:00:00Z');
    const old = await t.db.lead.create({ data: { name: 'Antigo', phone: '5513900000001', channelJid: '5513900000001@s.whatsapp.net' } });
    const recent = await t.db.lead.create({ data: { name: 'Recente', phone: '5513900000002' } });
    await t.db.conversation.create({ data: { leadId: old.id, channel: 'WHATSAPP', state: 'DONE' } });
    await t.sql("update leads set updated_at = '2026-10-01' where id = $1", [old.id]);
    await t.sql("update conversations set updated_at = '2026-10-01' where lead_id = $1", [old.id]);
    await t.sql("update leads set updated_at = '2027-04-20' where id = $1", [recent.id]);

    const l = log();
    const r = createRetention({ db: t.db, days: 180, intervalMs: 1000, log: l, now: () => now });
    expect(await r.sweep()).toMatchObject({ leads: 1 });
    expect(await t.db.lead.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await t.db.lead.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(l.info).toHaveBeenCalledWith(expect.objectContaining({ leads: 1 }), expect.any(String));
    expect(JSON.stringify(l.info.mock.calls)).not.toContain('Antigo');
    expect((await t.sql("select reason from audit_logs where action = 'erased_by_retention'")).rows).toEqual([{ reason: 'retencao' }]);
  });

  it('com 0 dias a rotina não roda', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5513900000003' } });
    await t.sql("update leads set updated_at = '2020-01-01' where id = $1", [lead.id]);
    const l = log();
    const r = createRetention({ db: t.db, days: 0, intervalMs: 10, log: l });
    r.start();
    await new Promise((res) => setTimeout(res, 60));
    r.stop();
    expect(await t.db.lead.count()).toBe(1);
  });

  it('erro na passada vai para o log sem derrubar a rotina', async () => {
    const l = log();
    const broken = { ...t.db, lead: { findMany: () => Promise.reject(new Error('banco caiu 5513900000003')) } } as unknown as typeof t.db;
    const r = createRetention({ db: broken, days: 30, intervalMs: 1000, log: l });
    r.start();
    await vi.waitFor(() => expect(l.error).toHaveBeenCalled());
    r.stop();
    expect(JSON.stringify(l.error.mock.calls)).not.toContain('5513900000003');
  });
});
