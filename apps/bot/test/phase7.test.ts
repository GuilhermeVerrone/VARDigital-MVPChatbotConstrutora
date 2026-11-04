import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalPhone, type ChannelAdapter, type InboundMessage } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { listPendingErasures, seedDatabase } from '@mvp/db';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createDeliveryHandler } from '../src/delivery';
import { createDeliveryWorker } from '../src/delivery-worker';
import { createOrchestrator } from '../src/orchestrator';

// Fase 7 de ponta a ponta contra Postgres real: handoff humano e exclusão de dados (LGPD).
// Só o canal de saída (WhatsApp) é simulado.

const PHONE = '5513981264295';
const JID = `${PHONE}@s.whatsapp.net`;
let t: TestDb;
const clock = new Date('2026-10-29T12:00:00Z');
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());

let workers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
});
beforeEach(async () => {
  await t.sql('truncate erasure_tasks, processed_messages, delivery_jobs, crm_simulations, crm_contacts, chat_sessions, audit_logs, financial_profiles, consents, conversations, simulations, leads cascade');
  await t.sql('update brokers set last_assigned_at = null, active = true');
});

interface Sent { to: string; kind: 'text' | 'list' | 'document'; text: string }

function setup() {
  const sent: Sent[] = [];
  const channel: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendText: async (to, text) => { sent.push({ to, kind: 'text', text }); return { externalId: null }; },
    sendList: async (to, a) => { sent.push({ to, kind: 'list', text: `${a.title}\n${a.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}` }); return { externalId: null }; },
    sendDocument: async (to, a) => { sent.push({ to, kind: 'document', text: a.caption ?? '' }); return { externalId: null }; },
  };
  const worker = createDeliveryWorker({
    db: t.db,
    handle: createDeliveryHandler({ db: t.db, channel, crm: new SimulatedCrm(t.db) }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    maxAttempts: 5, lockMs: 60_000, pollMs: 20, backoffMs: () => 10,
  });
  workers.push(worker);
  worker.start();
  const warnings: object[] = [];
  const handle = createOrchestrator({
    db: t.db, channel, hashSecret: 'segredo-de-teste-123456', now: () => clock, sleep: async () => undefined,
    onJobsEnqueued: () => worker.kick(), log: { warn: (o) => warnings.push(o) },
  });
  const say = async (text: string, o: { id?: string; chat?: string; phone?: string | null } = {}) => {
    const before = sent.length;
    const chat = o.chat ?? JID;
    const msg: InboundMessage = {
      channel: 'WHATSAPP', sessionId: 's', externalId: o.id ?? `m${++n}`, chatId: chat, phone: o.phone === undefined ? PHONE : o.phone,
      pushName: null, type: 'text', text, receivedAt: clock.toISOString(),
    };
    await handle(msg);
    return sent.slice(before).filter((s) => s.to === chat);
  };
  const toBrokers = () => sent.filter((s) => s.to !== JID);
  return { sent, say, toBrokers, warnings, handle, worker };
}
type Bot = ReturnType<typeof setup>;

const texts = (s: Sent[]) => s.map((x) => x.text).join('\n---\n');
const answers = (down: string) => ['Maria da Silva', 'sim', 'maria@gmail.com', '1', '7 mil', 'clt', '05/03/1990', '800', 'não', down, 'não sei', 'sim', '15 mil', '3 anos', 'não', 'sim'];

async function consent(b: Bot) { await b.say('oi'); await b.say('sim'); }
async function toResult(b: Bot) {
  await consent(b);
  for (const a of answers('70 mil')) await b.say(a);
  await b.say('sim'); // confirma os dados: calcula e apresenta
}
const brokerJid = (b: Bot) => b.toBrokers()[0]!.to;
const brokerPhone = (jid: string) => jid.split('@')[0]!;

describe('handoff humano (RF-07)', () => {
  it('no meio da coleta: o lead é avisado, o corretor recebe o card com o histórico e o código, e o bot cala', async () => {
    const b = setup();
    await consent(b);
    for (const a of ['Maria da Silva', 'sim', 'maria@gmail.com', '1', '7 mil']) await b.say(a);
    const out = await b.say('quero falar com um corretor');
    expect(texts(out)).toContain('não vou mais enviar perguntas');

    await expect.poll(() => b.toBrokers().length).toBe(1);
    const card = b.toBrokers()[0]!.text;
    const conv = await t.db.conversation.findFirstOrThrow();
    expect(conv).toMatchObject({ state: 'HANDOFF', handoff: true, handoffCode: expect.stringMatching(/^[A-Z2-9]{6}$/) });
    expect(card).toContain(`Código: *${conv.handoffCode}*`);
    expect(card).toContain('Maria da Silva');
    expect(card).toContain('(13) 98126-4295');
    expect(card).toContain('Lead: 7 mil'); // o histórico repassado
    expect(card).toContain('Lead: quero falar com um corretor');
    expect(card).toContain('Bot:');
    expect(card).toContain(`assumir ${conv.handoffCode}`);
    expect((await t.db.lead.findFirstOrThrow()).status).toBe('HANDOFF');

    // O bot não responde mais, não importa o que o lead escreva.
    for (const msg of ['alô?', 'oi', '1', 'voltar']) expect(await b.say(msg)).toEqual([]);
    expect(b.toBrokers().length).toBe(1);
  });

  it('o corretor é o mesmo do round-robin do lead e o aviso sai em menos de 1 minuto', async () => {
    const b = setup();
    await consent(b);
    const start = Date.now();
    await b.say('Maria da Silva');
    await b.say('falar com atendente');
    await expect.poll(() => b.toBrokers().length, { timeout: 10_000 }).toBe(1);
    expect(Date.now() - start).toBeLessThan(60_000);
    const lead = await t.db.lead.findFirstOrThrow({ include: { broker: true } });
    expect(brokerPhone(brokerJid(b))).toBe(lead.broker!.phone);
  });

  it('depois do resultado e depois de finalizar o lead ainda chama o corretor', async () => {
    const b = setup();
    await toResult(b);
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(1);
    await b.say('4'); // está ótimo → DONE
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('DONE');
    expect(texts(await b.say('quero falar com um corretor'))).toContain('Combinado');
    await expect.poll(() => b.toBrokers().filter((s) => s.text.includes('Lead pediu para falar')).length).toBe(1);
    const card = b.toBrokers().find((s) => s.text.includes('Lead pediu para falar'))!;
    expect(card.text).toContain('você recebeu o dossiê');
  });

  it('antes do consentimento o bot pede o OK antes de guardar o contato, sem gravar nada', async () => {
    const b = setup();
    await b.say('oi');
    expect(texts(await b.say('quero falar com um corretor'))).toContain('antes preciso do seu OK');
    expect(await t.db.lead.count()).toBe(0);
    expect(await t.db.deliveryJob.count()).toBe(0);
  });

  it('a reentrega do mesmo pedido não manda um segundo aviso ao corretor', async () => {
    const b = setup();
    await consent(b);
    await b.say('Maria da Silva');
    await b.say('quero falar com um corretor', { id: 'dup' });
    await b.say('quero falar com um corretor', { id: 'dup' });
    await expect.poll(() => b.toBrokers().length).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(b.toBrokers().length).toBe(1);
    expect(await t.db.deliveryJob.count()).toBe(1);
  });

  it('se o WhatsApp do corretor falhar, o aviso é reenviado e o lead não se perde', async () => {
    const b = setup();
    let fails = 2;
    // Troca o envio ao corretor por um que falha 2 vezes: reconstrói o worker com um canal instável.
    await b.worker.stop();
    const flaky: ChannelAdapter = {
      markRead: async () => undefined, setPresence: async () => undefined,
      sendList: async () => ({ externalId: null }), sendDocument: async () => ({ externalId: null }),
      sendText: async (to, text) => {
        if (to !== JID && fails-- > 0) throw new Error('boom');
        b.sent.push({ to, kind: 'text', text });
        return { externalId: null };
      },
    };
    const retry = createDeliveryWorker({
      db: t.db, handle: createDeliveryHandler({ db: t.db, channel: flaky, crm: new SimulatedCrm(t.db) }),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined }, maxAttempts: 5, lockMs: 60_000, pollMs: 20, backoffMs: () => 10,
    });
    workers.push(retry);
    await consent(b);
    await b.say('Maria da Silva');
    await b.say('quero falar com um corretor');
    retry.start();
    await expect.poll(() => b.toBrokers().length, { timeout: 10_000 }).toBe(1);
    expect((await t.db.deliveryJob.findFirstOrThrow()).attempts).toBe(3);
  });
});

describe('o corretor assume e devolve (comandos pelo WhatsApp)', () => {
  async function waiting(b: Bot) {
    await consent(b);
    for (const a of ['Maria da Silva', 'sim', 'maria@gmail.com', '1', '7 mil']) await b.say(a);
    await b.say('quero falar com um corretor');
    await expect.poll(() => b.toBrokers().length).toBe(1);
    const code = (await t.db.conversation.findFirstOrThrow()).handoffCode!;
    const jid = brokerJid(b);
    return { code, jid, phone: brokerPhone(jid) };
  }

  it('"assumir <código>" registra o corretor e confirma com o telefone do lead', async () => {
    const b = setup();
    const { code, jid, phone } = await waiting(b);
    const out = await b.say(`assumir ${code.toLowerCase()}`, { chat: jid, phone });
    expect(texts(out)).toContain(`assumiu o atendimento *${code}* de *Maria da Silva*`);
    expect(texts(out)).toContain('(13) 98126-4295');
    expect(await t.db.conversation.findFirstOrThrow()).toMatchObject({ takenByBrokerId: expect.any(String), takenAt: expect.any(Date) });
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain('handoff_taken');
    expect(await b.say('oi')).toEqual([]); // o bot segue calado com o lead
  });

  it('outro corretor não consegue assumir o que já foi assumido; código errado é recusado', async () => {
    const b = setup();
    const { code, jid, phone } = await waiting(b);
    await b.say(`assumir ${code}`, { chat: jid, phone });
    const other = (await t.db.broker.findMany()).find((x) => canonicalPhone(x.phone) !== canonicalPhone(phone))!;
    const otherJid = `${other.phone}@s.whatsapp.net`;
    expect(texts(await b.say(`assumir ${code}`, { chat: otherJid, phone: other.phone }))).toContain('já foi assumido por');
    expect(texts(await b.say('assumir ABCDEF', { chat: otherJid, phone: other.phone }))).toContain('Não encontrei');
  });

  it('quem não é corretor não executa o comando: a mensagem segue como conversa de lead', async () => {
    const b = setup();
    const { code } = await waiting(b);
    expect(await b.say(`assumir ${code}`)).toEqual([]); // o lead em HANDOFF: o bot calado, nenhum efeito
    expect((await t.db.conversation.findFirstOrThrow()).takenByBrokerId).toBeNull();
  });

  it('mensagem de corretor que não é comando segue o fluxo normal (o número de teste ainda conversa como lead)', async () => {
    const b = setup();
    const broker = (await t.db.broker.findFirstOrThrow()).phone;
    const out = await b.say('oi', { chat: `${broker}@s.whatsapp.net`, phone: broker });
    expect(texts(out)).toContain('Você concorda?');
  });

  it('"devolver <código>" volta o lead para a pergunta em que estava, e um novo pedido gera outro código', async () => {
    const b = setup();
    const { code, jid, phone } = await waiting(b);
    await b.say(`assumir ${code}`, { chat: jid, phone });
    const before = b.sent.length;
    const out = await b.say(`devolver ${code}`, { chat: jid, phone });
    expect(texts(out)).toContain('Devolvi o atendimento');
    const toLead = b.sent.slice(before).filter((s) => s.to === JID);
    expect(texts(toLead)).toContain('me devolveu a conversa');
    expect(texts(toLead)).toContain('tipo de renda'); // estava na pergunta do tipo de renda
    expect(await t.db.conversation.findFirstOrThrow()).toMatchObject({ state: 'INCOME_TYPE', handoff: false, handoffCode: null, takenByBrokerId: null });
    expect((await t.db.lead.findFirstOrThrow()).status).toBe('IN_PROGRESS');

    // O lead responde e o fluxo continua de onde parou.
    expect(texts(await b.say('clt'))).toContain('data de nascimento');
    await b.say('quero falar com um corretor');
    expect((await t.db.conversation.findFirstOrThrow()).handoffCode).not.toBe(code);
  });

  it('só quem assumiu devolve', async () => {
    const b = setup();
    const { code, jid, phone } = await waiting(b);
    expect(texts(await b.say(`devolver ${code}`, { chat: jid, phone }))).toContain('não assumiu');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('HANDOFF');
  });

  it('"pendentes" lista os atendimentos em aberto do corretor', async () => {
    const b = setup();
    const { code, jid, phone } = await waiting(b);
    expect(texts(await b.say('pendentes', { chat: jid, phone }))).toMatch(new RegExp(`\\*${code}\\* — Maria da Silva \\(aguardando você`));
    await b.say(`assumir ${code}`, { chat: jid, phone });
    expect(texts(await b.say('pendentes', { chat: jid, phone }))).toContain('assumido por você');
    await b.say(`devolver ${code}`, { chat: jid, phone });
    expect(texts(await b.say('pendentes', { chat: jid, phone }))).toContain('não tem atendimentos em aberto');
  });
});

describe('exclusão do titular (RF-10)', () => {
  it('confirma antes, depois apaga tudo (inclusive CRM) e deixa só o registro mínimo e a pendência do WA-AKG', async () => {
    const b = setup();
    await toResult(b);
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(1);
    await expect.poll(async () => t.db.crmContact.count()).toBe(1);
    await expect.poll(async () => t.db.deliveryJob.count({ where: { status: 'DONE' } })).toBe(2);
    const leadId = (await t.db.lead.findFirstOrThrow()).id;

    expect(texts(await b.say('quero que apaguem meus dados'))).toContain('Posso apagar tudo?');
    expect(await t.db.lead.count()).toBe(1);
    const out = await b.say('sim');
    expect(texts(out)).toContain('apaguei os seus dados');

    for (const table of ['leads', 'consents', 'conversations', 'financial_profiles', 'simulations', 'delivery_jobs', 'crm_contacts', 'crm_simulations', 'chat_sessions']) {
      expect(Number((await t.sql(`select count(*)::int as n from ${table}`)).rows[0].n), table).toBe(0);
    }
    const audit = (await t.sql("select * from audit_logs where entity_id = $1 and action = 'erased_by_request'", [leadId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ counts: { conversations: 1, simulations: 1, crmContacts: 1 }, channelCleanup: 'pending' });
    expect(await listPendingErasures(t.db)).toMatchObject([{ chatId: JID }]);

    // O corretor que recebeu o resumo é avisado para apagar a cópia dele.
    const notice = b.toBrokers().find((s) => s.text.includes('Pedido de exclusão de dados'))!;
    expect(notice.text).toContain('Maria da Silva');
    expect(notice.to).toBe(brokerJid(b));

    // Voltando a falar, começa do zero (precisa consentir de novo): nada ficou para trás.
    expect(texts(await b.say('oi'))).toContain('Você concorda?');
  });

  it('desistir na confirmação mantém tudo e volta para a pergunta', async () => {
    const b = setup();
    await consent(b);
    await b.say('Maria da Silva');
    await b.say('apagar meus dados');
    const out = await b.say('não');
    expect(texts(out)).toContain('não apaguei nada');
    expect(texts(out)).toContain('Posso usar este número');
    expect(await t.db.lead.count()).toBe(1);
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('PHONE_CONFIRM');
  });

  it('a reentrega da própria confirmação não recomeça a conversa', async () => {
    const b = setup();
    await consent(b);
    await b.say('apagar meus dados');
    await b.say('sim', { id: 'confirma' });
    expect(await t.db.lead.count()).toBe(0);
  });

  it('vale em handoff: o lead que está com um corretor consegue se apagar; o corretor é avisado', async () => {
    const b = setup();
    await consent(b);
    await b.say('Maria da Silva');
    await b.say('quero falar com um corretor');
    await expect.poll(() => b.toBrokers().length).toBe(1);
    await expect.poll(() => t.db.deliveryJob.count({ where: { status: 'DONE' } })).toBe(1);
    await b.say('apagar meus dados');
    await b.say('sim');
    expect(await t.db.lead.count()).toBe(0);
    expect(b.toBrokers().some((s) => s.text.includes('Pedido de exclusão'))).toBe(true);
  });

  it('antes do consentimento não há nada guardado para apagar', async () => {
    const b = setup();
    await b.say('oi');
    expect(texts(await b.say('apagar meus dados'))).toContain('não tem dados guardados');
  });
});

describe('consentimento versionado', () => {
  it('o aceite grava a versão, o texto exato mostrado e o canal; parar de receber revoga sem apagar', async () => {
    const b = setup();
    const [greeting] = await b.say('oi');
    await b.say('sim');
    const c = await t.db.consent.findFirstOrThrow();
    expect(c).toMatchObject({ textVersion: 'ilustrativo-2', channel: 'WHATSAPP', revokedAt: null });
    expect(c.textSnapshot).toBe(greeting!.text);
    expect(c.textSnapshot).toContain('Você concorda?');

    await b.say('parar de receber mensagens');
    expect((await t.db.consent.findFirstOrThrow()).revokedAt).toEqual(clock);
    expect((await t.db.lead.findFirstOrThrow()).status).toBe('OPTED_OUT');
  });
});
