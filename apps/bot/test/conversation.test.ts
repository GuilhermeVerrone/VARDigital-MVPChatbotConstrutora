import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter, InboundMessage } from '@mvp/channel';
import { ChannelError } from '@mvp/channel';
import { seedDatabase } from '@mvp/db';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createOrchestrator } from '../src/orchestrator';

// Conversa completa pelo orquestrador contra Postgres real. Só o canal de saída é simulado.

const PHONE = '5513981264295';
const JID = `${PHONE}@s.whatsapp.net`;
let t: TestDb;
let clock = new Date('2026-10-29T12:00:00Z');
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());
beforeEach(async () => {
  clock = new Date('2026-10-29T12:00:00Z');
  await t.sql('truncate chat_sessions, audit_logs, financial_profiles, consents, conversations, simulations, leads cascade');
});

function fakeChannel(opts: { failNextSend?: boolean } = {}) {
  const sent: string[] = [];
  const state = { failNextSend: opts.failNextSend ?? false };
  const channel: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendText: async (_c, text) => {
      if (state.failNextSend) { state.failNextSend = false; throw new ChannelError('boom', true, 503); }
      sent.push(text);
      return { externalId: null };
    },
    sendList: async (_c, a) => { sent.push(`${a.title}\n${a.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}`); return { externalId: null }; },
    sendDocument: async () => ({ externalId: null }),
  };
  return { channel, sent, state };
}

function bot(ch = fakeChannel()) {
  const handle = createOrchestrator({
    db: t.db, channel: ch.channel, hashSecret: 'segredo-de-teste-123456', now: () => clock, sleep: async () => undefined,
  });
  const say = async (text: string, id = `m${++n}`, chat = JID, phone: string | null = PHONE) => {
    const before = ch.sent.length;
    const msg: InboundMessage = {
      channel: 'WHATSAPP', sessionId: 's', externalId: id, chatId: chat, phone, pushName: null, type: 'text', text, receivedAt: clock.toISOString(),
    };
    await handle(msg);
    return ch.sent.slice(before);
  };
  return { say, ch, handle };
}

const FLOW = ['Maria da Silva', 'sim', 'maria@gmail.com', '1', '7 mil', 'clt', '05/03/1990', '800', 'não', '40 mil', 'não sei', 'sim', '15 mil', '3 anos', 'não', 'sim'];

describe('consentimento (LGPD)', () => {
  it('antes do aceite nada de pessoal é gravado; o aceite cria lead, consentimento versionado e conversa', async () => {
    const b = bot();
    const [greet] = await b.say('oi');
    expect(greet).toContain('Você concorda?');
    expect(await t.db.lead.count()).toBe(0);
    expect(await t.db.conversation.count()).toBe(0);
    const sess = await t.sql('select * from chat_sessions');
    expect(sess.rows).toHaveLength(1);
    expect(JSON.stringify(sess.rows)).not.toContain('981264295'); // só hash

    const out = await b.say('sim');
    expect(out.join('\n')).toContain('Qual é o seu nome completo');
    const lead = await t.db.lead.findFirstOrThrow({ include: { consents: true, conversations: true } });
    expect(lead).toMatchObject({ phone: PHONE, channelJid: JID, status: 'IN_PROGRESS', name: null });
    expect(lead.consents).toMatchObject([{ textVersion: 'ilustrativo-2', channel: 'WHATSAPP' }]);
    expect(lead.conversations[0]!.state).toBe('NAME');
    expect((await t.sql('select * from chat_sessions')).rows).toHaveLength(0);
  });

  it('recusa encerra sem coletar nada', async () => {
    const b = bot();
    await b.say('oi');
    const out = await b.say('não');
    expect(out.join()).toContain('Não guardei nenhum dado');
    for (const table of ['leads', 'consents', 'conversations', 'financial_profiles', 'chat_sessions']) {
      expect((await t.sql(`select count(*)::int c from ${table}`)).rows[0].c, table).toBe(0);
    }
  });

  it('resposta confusa repergunta; 3 vezes encerra sem dados', async () => {
    const b = bot();
    await b.say('oi');
    expect((await b.say('talvez'))[0]).toContain('concorda');
    await b.say('hmm');
    expect((await b.say('sei lá'))[0]).toContain('Não guardei');
    expect(await t.db.lead.count()).toBe(0);
  });

  it('pedido de parar antes de consentir é lembrado em silêncio; LGPD diz que não há dados', async () => {
    const b = bot();
    expect((await b.say('parar'))[0]).toContain('não vou mais te enviar');
    expect(await b.say('oi')).toEqual([]);
    expect(await t.db.lead.count()).toBe(0);
    const c = bot();
    expect((await c.say('quero apagar meus dados', 'x1', '5511999990000@s.whatsapp.net', '5511999990000'))[0]).toContain('não tem dados');
  });
});

describe('coleta', () => {
  it('conversa completa: persiste por etapa e grava o perfil financeiro', async () => {
    const b = bot();
    await b.say('oi');
    await b.say('sim');
    for (const m of FLOW.slice(0, 7)) await b.say(m);
    // persistência por etapa (RF-11): já está no banco antes de acabar
    let lead = await t.db.lead.findFirstOrThrow({ include: { conversations: true } });
    expect(lead).toMatchObject({ name: 'Maria da Silva', email: 'maria@gmail.com' });
    expect(lead.birthDate?.toISOString().slice(0, 10)).toBe('1990-03-05');
    expect(lead.conversations[0]!.state).toBe('DEBTS');

    for (const m of FLOW.slice(7)) await b.say(m);
    const last = await b.say('sim');
    expect(last.join()).toBeDefined();
    lead = await t.db.lead.findFirstOrThrow({ include: { conversations: true } });
    expect(lead.conversations[0]!.state).toBe('RESULT'); // calculou e apresentou (Fase 6)
    const prof = await t.db.financialProfile.findFirstOrThrow();
    expect(Number(prof.grossMonthlyIncome)).toBe(7000);
    expect(prof).toMatchObject({ incomeType: 'CLT', ownsResidentialProperty: false, firstFinancing: true, fgtsContributionMonths: 36 });
    expect(Number(prof.availableDownPayment)).toBe(40000);
  });
});

describe('retomada e idempotência', () => {
  it('reinício do serviço no meio da conversa: outro orquestrador continua de onde parou', async () => {
    const a = bot();
    await a.say('oi'); await a.say('sim');
    for (const m of ['Maria da Silva', 'sim', 'pular', '1']) await a.say(m);
    const b = bot(); // processo novo, mesmo banco
    const out = await b.say('7 mil');
    expect(out.join('\n')).toMatch(/, renda de R\$ 7\.000\/mês\./);
    expect(out.join('\n')).toContain('tipo de renda');
  });

  it('mesma mensagem entregue duas vezes: etapa aplicada uma vez, sem resposta duplicada', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim');
    const first = await b.say('Maria da Silva', 'dup-1');
    expect(first.length).toBeGreaterThan(0);
    const again = await b.say('Maria da Silva', 'dup-1');
    expect(again).toEqual([]);
    const conv = await t.db.conversation.findFirstOrThrow();
    expect(conv.state).toBe('PHONE_CONFIRM');
  });

  it('queda no envio: a etapa fica gravada e a reentrega só envia o que faltava', async () => {
    const ch = fakeChannel();
    const b = bot(ch);
    await b.say('oi'); await b.say('sim');
    ch.state.failNextSend = true;
    await expect(b.say('Maria da Silva', 'retry-1')).rejects.toThrow('boom');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('PHONE_CONFIRM'); // gravado antes de enviar
    const out = await b.say('Maria da Silva', 'retry-1');
    expect(out.join('\n')).toContain('Posso usar este número');
    expect(out.filter((x) => x.includes('Posso usar este número'))).toHaveLength(1);
  });

  it('parada por mais de 6 h: retoma com a pergunta atual', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim'); await b.say('Maria da Silva');
    clock = new Date(clock.getTime() + 7 * 60 * 60 * 1000);
    const out = await b.say('sim');
    expect(out.join('\n')).toContain('Que bom te ver de novo');
    expect(out.join('\n')).toContain('e-mail');
  });

  it('parada por mais de 7 dias: expira e pede o consentimento de novo (nova conversa)', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim'); await b.say('Maria da Silva');
    clock = new Date(clock.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect((await b.say('oi'))[0]).toContain('Você concorda?');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('EXPIRED');
    const out = await b.say('sim');
    expect(out.join('\n')).toContain('nome completo');
    expect(await t.db.lead.count()).toBe(1); // mesmo lead
    expect(await t.db.consent.count()).toBe(2);
    expect(await t.db.conversation.count()).toBe(2);
  });
});

describe('saídas', () => {
  it('opt-out: confirma, marca o lead e fica em silêncio', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim');
    expect((await b.say('parar de receber mensagens'))[0]).toContain('não vou mais te enviar');
    expect((await t.db.lead.findFirstOrThrow()).status).toBe('OPTED_OUT');
    expect(await b.say('oi?')).toEqual([]);
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain('optout');
  });

  it('corretor: handoff, status do lead e bot silencioso; histórico guardado', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim'); await b.say('Maria da Silva');
    expect((await b.say('quero falar com um corretor'))[0]).toContain('corretor falar com você');
    const conv = await t.db.conversation.findFirstOrThrow();
    expect(conv).toMatchObject({ state: 'HANDOFF', handoff: true });
    expect((conv.history as { role: string }[]).some((h) => h.role === 'lead')).toBe(true);
    expect((await t.db.lead.findFirstOrThrow()).status).toBe('HANDOFF');
    expect(await b.say('alô?')).toEqual([]);
  });

  it('áudio: pede texto e repete a pergunta sem avançar', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim');
    const sent: string[] = [];
    const before = b.ch.sent.length;
    await b.handle({ channel: 'WHATSAPP', sessionId: 's', externalId: 'aud1', chatId: JID, phone: PHONE, pushName: null, type: 'audio', text: null, receivedAt: clock.toISOString() });
    sent.push(...b.ch.sent.slice(before));
    expect(sent.join()).toContain('só consigo ler mensagens de texto');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('NAME');
  });

  it('pedido de exclusão de dados pede confirmação e não apaga nada antes do "sim"', async () => {
    const b = bot();
    await b.say('oi'); await b.say('sim');
    expect((await b.say('quero que apaguem meus dados'))[0]).toContain('Posso apagar tudo?');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('LGPD_CONFIRM');
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain('lgpd_request');
    expect(await t.db.lead.count()).toBe(1);
  });

  it('LID sem telefone: pede o telefone ao lead', async () => {
    const b = bot();
    const lid = '123456789@lid';
    await b.say('oi', 'l1', lid, null); await b.say('sim', 'l2', lid, null);
    const out = await b.say('Maria da Silva', 'l3', lid, null);
    expect(out.join('\n')).toContain('telefone com DDD');
    const lead = await t.db.lead.findFirstOrThrow();
    expect(lead.phone).toBeNull();
  });
});
