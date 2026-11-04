import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNextJob, enqueueJob, eraseLead, listPendingErasures, markErasureDone, pickUnitForTypology, purgeInactive, runAndRecordSimulation, saveTurn,
  seedDatabase,
} from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
const TODAY = '2026-10-29';
const PHONE = '5513981264295';
const JID = `${PHONE}@s.whatsapp.net`;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: TODAY });
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate erasure_tasks, processed_messages, delivery_jobs, crm_simulations, crm_contacts, chat_sessions, audit_logs, financial_profiles, consents, conversations, simulations, leads cascade');
});

/** Lead completo: consentimento, conversa, perfil, simulação, entregas, contato no CRM e mensagens na fila. */
async function fullLead(phone = PHONE, jid = JID) {
  const lead = await t.db.lead.create({ data: { phone, channelJid: jid, name: 'Maria da Silva', email: 'maria@gmail.com', birthDate: new Date('1990-03-05'), status: 'DELIVERED' } });
  await t.db.consent.create({ data: { leadId: lead.id, textVersion: 'ilustrativo-1', channel: 'WHATSAPP', acceptedAt: new Date('2026-10-29T12:00:00Z') } });
  const conv = await t.db.conversation.create({ data: { leadId: lead.id, channel: 'WHATSAPP', state: 'RESULT', context: { data: { phone, name: 'Maria da Silva' } }, history: [{ role: 'lead', text: 'minha renda é 7 mil' }] } });
  await t.db.financialProfile.create({
    data: { leadId: lead.id, grossMonthlyIncome: 7000, incomeType: 'CLT', monthlyDebts: 0, availableDownPayment: 40000, ownsResidentialProperty: false, firstFinancing: true },
  });
  const unit = (await pickUnitForTypology(t.db, '2 dormitórios'))!;
  const { simulation } = await runAndRecordSimulation(t.db, { leadId: lead.id, unitId: unit.id, referenceDate: TODAY });
  await enqueueJob(t.db, { kind: 'BROKER_NOTIFY', simulationId: simulation.id });
  const contact = await t.db.crmContact.create({ data: { phone, name: 'Maria da Silva' } });
  await t.db.crmSimulation.create({ data: { contactId: contact.id, simulationId: simulation.id, summary: {} } });
  await t.db.processedMessage.create({ data: { channel: 'WHATSAPP', externalId: `${phone}-1`, sessionId: 's', chatKey: jid, leadId: lead.id, status: 'DONE' } });
  await t.db.processedMessage.create({ data: { channel: 'WHATSAPP', externalId: `${phone}-2`, sessionId: 's', chatKey: jid, status: 'DONE' } });
  return { lead, conv, simulation };
}

const count = async (table: string) => Number((await t.sql(`select count(*)::int as n from ${table}`)).rows[0].n);

describe('eraseLead', () => {
  it('apaga o lead e tudo que depende dele, inclusive o que não tem chave para o lead', async () => {
    const { lead } = await fullLead();
    const summary = await eraseLead(t.db, lead.id, { reason: 'titular' });
    expect(summary).toMatchObject({ leadId: lead.id, chatId: JID, counts: { conversations: 1, simulations: 1, messages: 2, crmContacts: 1 } });
    for (const table of ['leads', 'consents', 'conversations', 'financial_profiles', 'simulations', 'delivery_jobs', 'crm_contacts', 'crm_simulations', 'processed_messages']) {
      expect(await count(table), table).toBe(0);
    }
  });

  it('deixa um registro mínimo na auditoria, sem telefone, nome, e-mail nem renda', async () => {
    const { lead } = await fullLead();
    await eraseLead(t.db, lead.id, { reason: 'titular', now: new Date('2026-10-30T10:00:00Z') });
    const rows = (await t.sql("select * from audit_logs where action like 'erased%'")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'lead', entity_id: lead.id, action: 'erased_by_request', reason: 'titular' });
    expect(rows[0].after.consents).toEqual([{ textVersion: 'ilustrativo-1', acceptedAt: '2026-10-29T12:00:00.000Z', revokedAt: null }]);
    const everything = JSON.stringify((await t.sql('select * from audit_logs')).rows) + JSON.stringify((await t.sql('select * from erasure_tasks')).rows.map((r) => ({ ...r, chat_id: null })));
    for (const pii of ['981264295', 'Maria', 'gmail', '7000', '40000']) expect(everything).not.toContain(pii);
  });

  it('registra a limpeza do canal e some com o endereço quando ela é feita', async () => {
    const { lead } = await fullLead();
    await eraseLead(t.db, lead.id, { reason: 'titular' });
    const pending = await listPendingErasures(t.db);
    expect(pending).toMatchObject([{ chatId: JID }]);
    await markErasureDone(t.db, pending[0]!.id);
    expect(await listPendingErasures(t.db)).toEqual([]);
    expect((await t.sql('select chat_id, done_at from erasure_tasks')).rows[0]).toMatchObject({ chat_id: null, done_at: expect.any(Date) });
  });

  it('não toca nos dados de outro lead e é idempotente', async () => {
    const a = await fullLead();
    const b = await fullLead('5513999990000', '5513999990000@s.whatsapp.net');
    expect(await eraseLead(t.db, a.lead.id, { reason: 'titular' })).not.toBeNull();
    expect(await eraseLead(t.db, a.lead.id, { reason: 'titular' })).toBeNull();
    expect(await t.db.lead.findUnique({ where: { id: b.lead.id } })).not.toBeNull();
    expect(await count('crm_contacts')).toBe(1);
    expect(await count('simulations')).toBe(1);
    expect(await count('processed_messages')).toBe(2);
  });

  it('apaga o contato do CRM pelo telefone informado na conversa quando a coluna do lead está vazia', async () => {
    const { lead } = await fullLead();
    await t.db.lead.update({ where: { id: lead.id }, data: { phone: null } });
    await eraseLead(t.db, lead.id, { reason: 'titular' });
    expect(await count('crm_contacts')).toBe(0);
  });
});

describe('retenção', () => {
  it('apaga só quem está inativo desde a data de corte', async () => {
    const old = await fullLead();
    const recent = await fullLead('5513999990000', '5513999990000@s.whatsapp.net');
    const past = new Date('2026-01-01T00:00:00Z');
    await t.sql('update leads set updated_at = $1 where id = $2', [past, old.lead.id]);
    await t.sql('update conversations set updated_at = $1 where lead_id = $2', [past, old.lead.id]);
    await t.sql('update simulations set generated_at = $1 where lead_id = $2', [past, old.lead.id]);
    await t.sql("update processed_messages set received_at = $1 where chat_key = $2", [past, JID]);
    await t.sql("insert into chat_sessions (chat_hash, state, attempts, updated_at) values ('velho', 'CONSENT_ASKED', 0, $1), ('mudo', 'OPTED_OUT', 0, $1), ('novo', 'CONSENT_ASKED', 0, now())", [past]);

    const out = await purgeInactive(t.db, { inactiveSince: new Date('2026-06-01T00:00:00Z') });
    expect(out.leads).toBe(1);
    expect(await t.db.lead.findUnique({ where: { id: old.lead.id } })).toBeNull();
    expect(await t.db.lead.findUnique({ where: { id: recent.lead.id } })).not.toBeNull();
    expect((await t.sql('select chat_hash from chat_sessions order by chat_hash')).rows.map((r) => r.chat_hash)).toEqual(['mudo', 'novo']);
    expect((await t.sql("select count(*)::int as n from audit_logs where action = 'erased_by_retention'")).rows[0].n).toBe(1);
  });

  it('uma conversa ou simulação recente mantém o lead', async () => {
    const { lead } = await fullLead();
    await t.sql('update leads set updated_at = $1 where id = $2', [new Date('2026-01-01T00:00:00Z'), lead.id]);
    const out = await purgeInactive(t.db, { inactiveSince: new Date('2026-06-01T00:00:00Z') });
    expect(out.leads).toBe(0);
  });
});

describe('handoff no banco', () => {
  it('saveTurn dá um código ao handoff, guarda a data e mantém o código num segundo handoff', async () => {
    const { lead, conv } = await fullLead();
    const at = new Date('2026-10-29T13:00:00Z');
    const args = { conversationId: conv.id, leadId: lead.id, state: 'HANDOFF', context: {}, history: [] };
    await saveTurn(t.db, { ...args, writes: { handoff: true, status: 'HANDOFF', at, jobs: [{ kind: 'HANDOFF_NOTIFY', leadId: lead.id, dedupeKey: 'h1' }] } });
    const first = await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(first).toMatchObject({ handoff: true, handoffAt: at, takenByBrokerId: null });
    expect(first.handoffCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);

    await t.db.conversation.update({ where: { id: conv.id }, data: { takenBy: { connect: { id: (await t.db.broker.findFirstOrThrow()).id } }, takenAt: at } });
    await saveTurn(t.db, { ...args, writes: { handoff: true, at: new Date('2026-10-29T15:00:00Z') } });
    const second = await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(second.handoffCode).toBe(first.handoffCode);
    expect(second.takenByBrokerId).toBeNull();
  });

  it('o job de handoff é por lead (sem simulação) e é reservado pela fila', async () => {
    const lead = await t.db.lead.create({ data: { status: 'HANDOFF' } });
    expect(await enqueueJob(t.db, { kind: 'HANDOFF_NOTIFY', leadId: lead.id, dedupeKey: 'k' })).toBe(true);
    expect(await enqueueJob(t.db, { kind: 'HANDOFF_NOTIFY', leadId: lead.id, dedupeKey: 'k' })).toBe(false);
    const job = await claimNextJob(t.db, { lockMs: 60_000, maxAttempts: 3 });
    expect(job).toMatchObject({ kind: 'HANDOFF_NOTIFY', leadId: lead.id, simulationId: null });
    await expect(enqueueJob(t.db, { kind: 'HANDOFF_NOTIFY' })).rejects.toThrow();
  });

  it('parar de receber revoga o consentimento sem apagá-lo', async () => {
    const { lead, conv } = await fullLead();
    const at = new Date('2026-10-30T09:00:00Z');
    await saveTurn(t.db, { conversationId: conv.id, leadId: lead.id, state: 'OPTED_OUT', context: {}, history: [], writes: { status: 'OPTED_OUT', at } });
    expect((await t.db.consent.findFirstOrThrow({ where: { leadId: lead.id } })).revokedAt).toEqual(at);
  });
});
