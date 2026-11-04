import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findReleasableHandoff, listOpenHandoffs, releaseHandoff, saveTurn, seedDatabase, takeHandoff } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
let brokerA: string;
let brokerB: string;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
  const brokers = await t.db.broker.findMany({ orderBy: { name: 'asc' } });
  brokerA = brokers[0]!.id;
  brokerB = brokers[1]!.id;
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate audit_logs, financial_profiles, consents, conversations, leads cascade');
});

let seq = 0;

async function waitingLead(name = 'Maria da Silva', brokerId: string | null = brokerA) {
  const phone = `551398126${String(4000 + ++seq)}`;
  const lead = await t.db.lead.create({ data: { name, phone, channelJid: `${phone}@s.whatsapp.net`, status: 'HANDOFF', brokerId } });
  const conv = await t.db.conversation.create({ data: { leadId: lead.id, channel: 'WHATSAPP', state: 'IN_PROGRESS' } });
  await saveTurn(t.db, { conversationId: conv.id, leadId: lead.id, state: 'HANDOFF', context: { data: { phone } }, history: [], writes: { handoff: true, status: 'HANDOFF' } });
  const code = (await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).handoffCode!;
  return { lead, conv, code };
}

describe('assumir e devolver o handoff', () => {
  it('o corretor assume pelo código (sem diferenciar maiúsculas), o lead fica com ele e a auditoria registra', async () => {
    const { lead, conv, code } = await waitingLead(undefined, null);
    const r = await takeHandoff(t.db, code.toLowerCase(), brokerA);
    expect(r).toMatchObject({ ok: true, conversationId: conv.id, leadId: lead.id, name: 'Maria da Silva', phone: lead.phone, alreadyYours: false });
    expect(await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ brokerId: brokerA });
    expect(await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ takenByBrokerId: brokerA, takenAt: expect.any(Date) });
    expect((await t.db.auditLog.findMany({ where: { action: 'handoff_taken' } })).length).toBe(1);
    expect(await takeHandoff(t.db, code, brokerA)).toMatchObject({ ok: true, alreadyYours: true });
  });

  it('código inexistente, conversa que não espera mais e conversa de outro corretor são recusados', async () => {
    const { conv, code } = await waitingLead();
    expect(await takeHandoff(t.db, 'ZZZZZZ', brokerA)).toEqual({ ok: false, reason: 'not_found' });
    await takeHandoff(t.db, code, brokerA);
    expect(await takeHandoff(t.db, code, brokerB)).toMatchObject({ ok: false, reason: 'taken_by_other', takenByName: expect.any(String) });
    await t.db.conversation.update({ where: { id: conv.id }, data: { state: 'RESULT' } });
    expect(await takeHandoff(t.db, code, brokerA)).toEqual({ ok: false, reason: 'not_waiting' });
  });

  it('só quem assumiu devolve; a devolução limpa o código, o responsável e volta o status do lead', async () => {
    const { lead, conv, code } = await waitingLead();
    expect(await findReleasableHandoff(t.db, code, brokerA)).toEqual({ ok: false, reason: 'not_yours' });
    await takeHandoff(t.db, code, brokerA);
    expect(await findReleasableHandoff(t.db, code, brokerB)).toEqual({ ok: false, reason: 'not_yours' });
    const found = await findReleasableHandoff(t.db, code, brokerA);
    expect(found).toMatchObject({ ok: true, conversationId: conv.id, chatId: `${lead.phone}@s.whatsapp.net` });

    await releaseHandoff(t.db, { conversationId: conv.id, leadId: lead.id, brokerId: brokerA, state: 'RESULT', context: {}, history: [], leadStatus: 'DELIVERED', at: new Date() });
    expect(await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ state: 'RESULT', handoff: false, handoffCode: null, takenByBrokerId: null });
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('DELIVERED');
    expect(await findReleasableHandoff(t.db, code, brokerA)).toEqual({ ok: false, reason: 'not_found' });

    // Um novo handoff gera código novo.
    await saveTurn(t.db, { conversationId: conv.id, leadId: lead.id, state: 'HANDOFF', context: {}, history: [], writes: { handoff: true } });
    expect((await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).handoffCode).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('lista os handoffs em aberto do corretor: os atribuídos a ele e os que ele assumiu', async () => {
    const mine = await waitingLead('Ana Souza', brokerA);
    await waitingLead('Bruno Lima', brokerB);
    const none = await waitingLead('Carla Dias', null);
    await takeHandoff(t.db, none.code, brokerA);
    const list = await listOpenHandoffs(t.db, brokerA);
    expect(list.map((h) => [h.name, h.takenByMe]).sort()).toEqual([['Ana Souza', false], ['Carla Dias', true]]);
    expect(list.find((h) => h.name === 'Ana Souza')!.code).toBe(mine.code);
  });
});
