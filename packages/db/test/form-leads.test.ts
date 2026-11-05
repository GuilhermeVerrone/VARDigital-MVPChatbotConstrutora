import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignContactCode, closeUnconfirmedFormLeads, extractContactCode, findFormLead, startFormConversation } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate audit_logs, consents, conversations, leads cascade');
});

async function formLead(over: { phone?: string | null; createdAt?: Date; consent?: boolean } = {}) {
  const lead = await t.db.lead.create({
    data: { name: 'Ana Souza', phone: over.phone === undefined ? '5511912345678' : over.phone, source: 'SITE_FORM', status: 'NEW', ...(over.createdAt ? { createdAt: over.createdAt } : {}) },
  });
  if (over.consent !== false) {
    await t.db.consent.create({ data: { leadId: lead.id, textVersion: 'web-1', channel: 'WEB', acceptedAt: new Date() } });
  }
  return lead;
}

describe('código de contato', () => {
  it('extrai o código do texto do wa.me em qualquer caixa', () => {
    expect(extractContactCode('Oi! Quero minha simulação (ELV-4821)')).toBe('ELV-4821');
    expect(extractContactCode('meu código é elv 4821, obrigada')).toBe('ELV-4821');
    expect(extractContactCode('quero um apartamento')).toBeNull();
  });

  it('gera um código único e estável por lead', async () => {
    const a = await formLead();
    const b = await formLead({ phone: '5511900000002' });
    const codeA = await assignContactCode(t.db, a.id);
    expect(codeA).toMatch(/^ELV-\d{4}$/);
    expect(await assignContactCode(t.db, a.id)).toBe(codeA);
    expect(await assignContactCode(t.db, b.id)).not.toBe(codeA);
  });
});

describe('findFormLead', () => {
  it('casa pelo telefone, pelo código e pelo endereço já gravado', async () => {
    const lead = await formLead();
    const code = await assignContactCode(t.db, lead.id);
    expect((await findFormLead(t.db, { chatId: 'x@s.whatsapp.net', phone: '5511912345678' }, null))?.leadId).toBe(lead.id);
    expect((await findFormLead(t.db, { chatId: '123@lid', phone: null }, code))?.leadId).toBe(lead.id);
    await t.db.lead.update({ where: { id: lead.id }, data: { channelJid: '123@lid' } });
    expect((await findFormLead(t.db, { chatId: '123@lid', phone: null }, null))?.leadId).toBe(lead.id);
    expect(await findFormLead(t.db, { chatId: '999@lid', phone: null }, null)).toBeNull();
  });

  it('ignora lead sem consentimento, que já tem conversa ou que não veio do formulário', async () => {
    const noConsent = await formLead({ phone: '5511900000010', consent: false });
    expect(await findFormLead(t.db, { chatId: 'a@lid', phone: noConsent.phone }, null)).toBeNull();

    const talking = await formLead({ phone: '5511900000011' });
    await t.db.conversation.create({ data: { leadId: talking.id, channel: 'WHATSAPP', state: 'NAME', context: {}, history: [] } });
    expect(await findFormLead(t.db, { chatId: 'b@lid', phone: talking.phone }, null)).toBeNull();

    await t.db.lead.create({ data: { name: 'Zé', phone: '5511900000012', source: 'WHATSAPP' } });
    expect(await findFormLead(t.db, { chatId: 'c@lid', phone: '5511900000012' }, null)).toBeNull();
  });
});

describe('startFormConversation', () => {
  it('abre a conversa uma vez só e grava o endereço e a confirmação', async () => {
    const lead = await formLead();
    const args = { leadId: lead.id, chatId: '5511912345678@s.whatsapp.net', state: 'CONTACT_CONFIRM', context: {}, history: [], confirmed: true, at: new Date('2026-11-06T12:00:00Z') };
    expect((await startFormConversation(t.db, args)).created).toBe(true);
    expect((await startFormConversation(t.db, args)).created).toBe(false);
    const after = await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.channelJid).toBe(args.chatId);
    expect(after.contactConfirmedAt?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(after.status).toBe('IN_PROGRESS');
    expect(await t.db.conversation.count({ where: { leadId: lead.id } })).toBe(1);
  });
});

describe('closeUnconfirmedFormLeads', () => {
  it('encerra quem não confirmou em 48 h e deixa os demais', async () => {
    const now = new Date('2026-11-06T12:00:00Z');
    const old = await formLead({ createdAt: new Date('2026-11-04T11:00:00Z') });
    const fresh = await formLead({ phone: '5511900000020', createdAt: new Date('2026-11-06T10:00:00Z') });
    const confirmed = await formLead({ phone: '5511900000021', createdAt: new Date('2026-11-01T10:00:00Z') });
    await t.db.lead.update({ where: { id: confirmed.id }, data: { contactConfirmedAt: new Date('2026-11-01T11:00:00Z') } });

    expect(await closeUnconfirmedFormLeads(t.db, now)).toBe(1);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('CLOSED');
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('NEW');
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: confirmed.id } })).status).toBe('NEW');
    expect(await closeUnconfirmedFormLeads(t.db, now)).toBe(0);
  });
});
