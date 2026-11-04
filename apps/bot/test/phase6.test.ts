import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelError, type ChannelAdapter, type InboundMessage } from '@mvp/channel';
import { CrmError, SimulatedCrm, type CrmAdapter } from '@mvp/crm';
import { seedDatabase } from '@mvp/db';
import type { LlmClient } from '@mvp/llm';
import { collectNumbers, unexplainedNumbers } from '@mvp/presentation';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createDeliveryHandler } from '../src/delivery';
import { createDeliveryWorker, type DeliveryWorkerOptions } from '../src/delivery-worker';
import { createOrchestrator } from '../src/orchestrator';

// Fase 6 de ponta a ponta contra Postgres real: conversa → motor → resultado → CRM e corretor.
// Só o canal de saída (WhatsApp) e, onde indicado, falhas injetadas são simulados.

const PHONE = '5513981264295';
const JID = `${PHONE}@s.whatsapp.net`;
const BROKER_JIDS = ['5500900000001@s.whatsapp.net', '5500900000002@s.whatsapp.net'];
let t: TestDb;
const clock = new Date('2026-10-29T12:00:00Z');
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-10-29' });
});
afterAll(() => t.drop());

interface Sent { to: string; kind: 'text' | 'list' | 'document'; text: string; fileName?: string; mimeType?: string; bytes?: Uint8Array }

function fakeChannel() {
  const sent: Sent[] = [];
  const fail = { sendText: 0, sendDocument: 0 };
  const channel: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendText: async (to, text) => {
      if (fail.sendText > 0) { fail.sendText--; throw new ChannelError('boom', true, 503); }
      sent.push({ to, kind: 'text', text });
      return { externalId: null };
    },
    sendList: async (to, a) => { sent.push({ to, kind: 'list', text: `${a.title}\n${a.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}` }); return { externalId: null }; },
    sendDocument: async (to, a) => {
      if (fail.sendDocument > 0) { fail.sendDocument--; throw new ChannelError('boom', true, 503); }
      sent.push({ to, kind: 'document', text: a.caption ?? '', fileName: a.fileName, mimeType: a.mimeType, bytes: a.data });
      return { externalId: null };
    },
  };
  const to = (jids: string[]) => sent.filter((s) => jids.includes(s.to));
  return { channel, sent, fail, toLead: (jid = JID) => to([jid]), toBrokers: () => to(BROKER_JIDS) };
}

let workers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
});
beforeEach(async () => {
  await t.sql('truncate delivery_jobs, crm_simulations, crm_contacts, chat_sessions, audit_logs, financial_profiles, consents, conversations, simulations, leads cascade');
  await t.sql('update brokers set last_assigned_at = null, active = true');
});

function setup(opts: { crm?: CrmAdapter; llm?: LlmClient; workerOverrides?: Partial<DeliveryWorkerOptions>; startWorker?: boolean } = {}) {
  const ch = fakeChannel();
  const crm = opts.crm ?? new SimulatedCrm(t.db);
  const worker = createDeliveryWorker({
    db: t.db,
    handle: createDeliveryHandler({ db: t.db, channel: ch.channel, crm }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    maxAttempts: 5, lockMs: 60_000, pollMs: 20, backoffMs: () => 10,
    ...opts.workerOverrides,
  });
  workers.push(worker);
  if (opts.startWorker !== false) worker.start();
  const handle = createOrchestrator({
    db: t.db, channel: ch.channel, hashSecret: 'segredo-de-teste-123456', now: () => clock, sleep: async () => undefined,
    ...(opts.llm ? { llm: { llm: opts.llm, prompt: { name: 'extraction', version: 1, text: 'x', hash: 'x' } } } : {}),
    onJobsEnqueued: () => worker.kick(),
  });
  const say = async (text: string, o: { id?: string; chat?: string; phone?: string | null } = {}) => {
    const before = ch.sent.length;
    const msg: InboundMessage = {
      channel: 'WHATSAPP', sessionId: 's', externalId: o.id ?? `m${++n}`, chatId: o.chat ?? JID, phone: o.phone === undefined ? PHONE : o.phone,
      pushName: null, type: 'text', text, receivedAt: clock.toISOString(),
    };
    await handle(msg);
    return ch.sent.slice(before).filter((s) => s.to === msg.chatId);
  };
  return { ...ch, say, worker, crm };
}

/** Respostas da coleta; `down` é a entrada disponível (70 mil → viável; 40 mil → falta entrada). */
const answers = (down: string) => ['Maria da Silva', 'sim', 'maria@gmail.com', '1', '7 mil', 'clt', '05/03/1990', '800', 'não', down, 'não sei', 'sim', '15 mil', '3 anos', 'não', 'sim'];

async function converse(b: ReturnType<typeof setup>, down = '70 mil', o: Parameters<ReturnType<typeof setup>['say']>[1] = {}) {
  await b.say('oi', o);
  await b.say('sim', o);
  for (const a of answers(down)) await b.say(a, o);
  return b.say('sim', o); // confirma os dados: calcula e apresenta
}

const texts = (s: Sent[]) => s.map((x) => x.text).join('\n---\n');

describe('resultado da simulação ao lead', () => {
  it('calcula com o motor, mostra resultado, aviso legal e menu, e grava simulação com a versão dos parâmetros', async () => {
    const b = setup({ startWorker: false });
    const out = await converse(b);
    const all = texts(out);
    expect(all).toContain('fazendo as contas');
    expect(all).toContain('✅');
    expect(all).toContain('Durante a obra');
    expect(all).toContain('indicativa');
    expect(all).toContain('Já passei o seu resumo para um corretor');
    expect(out.at(-1)!.text).toContain('Receber o PDF da simulação');

    const sim = await t.db.simulation.findFirstOrThrow({ include: { unit: true } });
    expect(sim).toMatchObject({ verdict: 'VIAVEL', parametersVersion: expect.stringContaining('ILUSTRATIVO'), unit: { code: 'A-101' } });
    const lead = await t.db.lead.findFirstOrThrow({ include: { conversations: true } });
    expect(lead).toMatchObject({ status: 'SIMULATED', scoreClass: 'HOT' });
    expect(lead.conversations[0]!.state).toBe('RESULT');
    expect(await t.db.deliveryJob.count({ where: { status: 'PENDING' } })).toBe(2);
  });

  it('nenhum número do resultado vem do LLM: cada valor está na simulação do motor, mesmo com um LLM que inventa', async () => {
    let calls = 0;
    const llm: LlmClient = {
      model: 'fake',
      completeJson: async () => { calls++; return { text: '{"intent":"answer","fields":{},"confidence":0.99,"preco":999999}', model: 'fake', latencyMs: 1 }; },
    };
    const b = setup({ llm, startWorker: false });
    const out = await converse(b);
    expect(calls).toBe(0); // respostas claras: nem o fallback foi consultado

    const sim = await t.db.simulation.findFirstOrThrow({ include: { unit: true } });
    const allowed = collectNumbers([sim.input, sim.result, { areaM2: Number(sim.unit!.areaM2) }]);
    for (const d of sim.unit!.code.match(/\d+/g) ?? []) allowed.add(Number(d));
    for (const d of PHONE.replace(/^55/, '').match(/^(\d{2})(\d{5})(\d{4})$/)!.slice(1)) allowed.add(Number(d));
    // As duas mensagens do resultado (resultado e aviso legal) e o aviso do corretor, sem o eco do que o lead digitou.
    const resultTexts = out.filter((s) => s.text.includes('*Importante:*') || s.text.includes('Como ficaria') || s.text.includes('fiz a simulação'));
    expect(resultTexts.length).toBe(2);
    expect(unexplainedNumbers(texts(resultTexts), allowed)).toEqual([]);
  });

  it('falta de entrada: parecer com ajustes ou inviável explica o que falta, sem prometer nada', async () => {
    const b = setup({ startWorker: false });
    const all = texts(await converse(b, '20 mil'));
    expect(all).toContain('faltam');
    expect(all).toContain('O que pode ajudar');
    expect(all).not.toMatch(/garantid|aprovad[oa] pelo/i);
    expect((await t.db.lead.findFirstOrThrow()).scoreClass).toBe('COLD');
  });
});

describe('ajuste de entrada e prazo (RF-27)', () => {
  it('recalcula com a nova entrada, grava nova simulação e avisa o corretor da atualização', async () => {
    const b = setup();
    await converse(b, '40 mil');
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(1);
    const before = await t.db.simulation.findFirstOrThrow();

    expect(texts(await b.say('1'))).toContain('Hoje considerei R$ 40.000');
    const out = await b.say('90 mil');
    expect(texts(out)).toContain('refiz a simulação');
    expect(texts(out)).toContain('entrada de R$ 90.000');
    expect(texts(out)).toContain('Atualizei o resumo do corretor');

    expect(await t.db.simulation.count()).toBe(2);
    const after = await t.db.simulation.findFirstOrThrow({ where: { id: { not: before.id } } });
    expect(after.verdict).toBe('VIAVEL');
    expect(Number((after.input as { availableDownPayment: number }).availableDownPayment)).toBe(90000);
    expect(Number((await t.db.financialProfile.findFirstOrThrow()).availableDownPayment)).toBe(40000); // o dado informado não muda

    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(2);
    const cards = b.toBrokers().filter((s) => s.kind === 'text');
    expect(cards[1]!.text).toContain('SIMULAÇÃO ATUALIZADA');
    expect(cards[1]!.text).toContain('Cenário do lead: entrada R$ 90.000');
    await expect.poll(() => t.db.crmSimulation.count()).toBe(2);
    expect(await t.db.crmContact.count()).toBe(1);
  });

  it('ajuste de prazo: aceita anos, acumula com a entrada e o prazo vai na mensagem', async () => {
    const b = setup({ startWorker: false });
    await converse(b);
    await b.say('2');
    const out = await b.say('25 anos');
    expect(texts(out)).toContain('prazo de 300 meses (25 anos)');
    const sim = await t.db.simulation.findFirstOrThrow({ orderBy: { generatedAt: 'desc' } });
    expect(sim.termMonths).toBe(300);
  });

  it('prazo fora do limite é recusado e repergunta', async () => {
    const b = setup({ startWorker: false });
    await converse(b);
    await b.say('prazo');
    expect(texts(await b.say('90 anos'))).toContain('entre 1 e 50 anos');
    expect(await t.db.simulation.count()).toBe(1);
  });

  it('corrigir um dado depois do resultado refaz a confirmação e recalcula do zero', async () => {
    const b = setup({ startWorker: false });
    await converse(b);
    await b.say('corrigir renda');
    expect(texts(await b.say('9 mil'))).toContain('Conferindo o que anotei');
    const out = await b.say('sim');
    expect(texts(out)).toContain('fazendo as contas');
    expect(await t.db.simulation.count()).toBe(2);
    expect(Number((await t.db.financialProfile.findFirstOrThrow()).grossMonthlyIncome)).toBe(9000);
  });
});

describe('PDF ao lead', () => {
  it('"receber o PDF" envia o documento da última simulação e mantém o menu', async () => {
    const b = setup({ startWorker: false });
    await converse(b);
    const out = await b.say('3');
    const doc = out.find((s) => s.kind === 'document')!;
    expect(doc).toMatchObject({ mimeType: 'application/pdf', fileName: expect.stringMatching(/^simulacao-maria-.*\.pdf$/) });
    expect(Buffer.from(doc.bytes!).subarray(0, 5).toString()).toBe('%PDF-');
    expect(doc.text).toContain('indicativa');
    expect(out.at(-1)!.text).toContain('Mudar o prazo');
  });
});

describe('entrega ao corretor (RF-33, RF-39)', () => {
  it('o corretor recebe card e PDF em até 1 minuto, e o lead vira DELIVERED', async () => {
    const b = setup();
    const started = Date.now();
    await converse(b);
    await expect.poll(() => b.toBrokers().length, { timeout: 60_000 }).toBe(2);
    expect(Date.now() - started).toBeLessThan(60_000);

    const [card, pdf] = b.toBrokers();
    expect(card!.kind).toBe('text');
    expect(card!.text).toContain('🔥 LEAD QUENTE');
    expect(card!.text).toContain('Maria da Silva');
    expect(card!.text).toContain('(13) 98126-4295');
    expect(card!.text).toContain('Fluxo de obra:');
    expect(card!.text).toContain('PRÓXIMO PASSO SUGERIDO');
    expect(pdf).toMatchObject({ kind: 'document', mimeType: 'application/pdf', to: card!.to });
    expect(Buffer.from(pdf!.bytes!).subarray(0, 5).toString()).toBe('%PDF-');

    await expect.poll(async () => (await t.db.lead.findFirstOrThrow()).status).toBe('DELIVERED');
    await expect.poll(() => t.db.deliveryJob.count({ where: { status: 'DONE' } })).toBe(2);
    expect(await t.db.auditLog.count({ where: { action: 'broker_notified' } })).toBe(1);
    const lead = await t.db.lead.findFirstOrThrow({ include: { broker: true } });
    expect(`${lead.broker!.phone}@s.whatsapp.net`).toBe(card!.to);
  });

  it('round-robin: leads diferentes vão para corretores diferentes; o mesmo lead fica com o mesmo', async () => {
    const b = setup();
    await converse(b);
    await converse(b, '70 mil', { chat: '5511999990000@s.whatsapp.net', phone: '5511999990000' });
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(2);
    const docTargets = b.toBrokers().filter((s) => s.kind === 'document').map((s) => s.to);
    expect(new Set(docTargets).size).toBe(2);

    await b.say('1'); await b.say('80 mil');
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(3);
    const third = b.toBrokers().filter((s) => s.kind === 'document')[2]!;
    expect(third.to).toBe(docTargets[0]); // atualização vai para o corretor do lead
  });

  it('falha no PDF não repete o card na nova tentativa', async () => {
    const b = setup({ startWorker: false });
    b.fail.sendDocument = 1;
    await converse(b);
    b.worker.start();
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'document').length).toBe(1);
    expect(b.toBrokers().filter((s) => s.kind === 'text')).toHaveLength(1);
    expect((await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'BROKER_NOTIFY' } })).attempts).toBe(2);
  });

  it('sem corretor ativo: o job espera e, quando há corretor, entrega', async () => {
    await t.sql('update brokers set active = false');
    const b = setup();
    await converse(b);
    await expect.poll(async () => (await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'BROKER_NOTIFY' } })).lastError).toContain('nenhum corretor ativo');
    await t.sql('update brokers set active = true');
    await expect.poll(() => b.toBrokers().length).toBe(2);
  });

  it('destino recusado pelo canal (não permitido) é permanente: DEAD com o erro, sem insistir', async () => {
    const b = setup();
    const original = b.channel.sendText.bind(b.channel);
    b.channel.sendText = async (to, text) => {
      if (BROKER_JIDS.includes(to)) throw new ChannelError('destino fora da lista de permitidos; envio bloqueado', false);
      return original(to, text);
    };
    await converse(b);
    await expect.poll(async () => (await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'BROKER_NOTIFY' } })).status).toBe('DEAD');
    expect((await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'BROKER_NOTIFY' } })).attempts).toBe(1);
  });
});

describe('CRM simulado (RF-41, spec §7.2)', () => {
  it('cria o contato com a simulação anexada e o responsável; o mesmo telefone não duplica', async () => {
    const b = setup();
    await converse(b);
    await expect.poll(() => t.db.crmSimulation.count()).toBe(1);
    const contact = await t.db.crmContact.findFirstOrThrow({ include: { simulations: true, owner: true } });
    expect(contact).toMatchObject({ phone: PHONE, name: 'Maria da Silva', email: 'maria@gmail.com', data: { scoreClass: 'HOT' } });
    expect(['SIMULATED', 'DELIVERED']).toContain((contact.data as { status: string }).status); // o status é o do momento da sincronização
    expect(contact.simulations[0]!.summary).toMatchObject({ verdict: 'VIAVEL', unit: 'A-101' });
    expect(contact.owner).not.toBeNull();

    await b.say('2'); await b.say('30 anos');
    await expect.poll(() => t.db.crmSimulation.count()).toBe(2);
    expect(await t.db.crmContact.count()).toBe(1);
  });

  it('a mesma pessoa chegando por outro endereço (LID) cai no mesmo contato e no mesmo corretor, e o corretor é avisado', async () => {
    const b = setup();
    await converse(b);
    await expect.poll(() => t.db.crmSimulation.count()).toBe(1);
    const owner = (await t.db.crmContact.findFirstOrThrow()).ownerBrokerId;

    // Mesmo telefone digitado, mas o canal só informou um LID: o lead novo não pode ficar com o número (único).
    const lid = { chat: '99999999999@lid', phone: null };
    await b.say('oi', lid); await b.say('sim', lid);
    await b.say('Maria da Silva', lid);
    await b.say(PHONE, lid); // telefone
    for (const a of answers('70 mil').slice(2)) await b.say(a, lid);
    await b.say('sim', lid);

    await expect.poll(() => t.db.crmSimulation.count()).toBe(2);
    expect(await t.db.crmContact.count()).toBe(1);
    expect(await t.db.lead.count()).toBe(2);
    const second = await t.db.lead.findFirstOrThrow({ where: { channelJid: '99999999999@lid' } });
    expect(second.phone).toBeNull();
    await expect.poll(async () => (await t.db.lead.findUniqueOrThrow({ where: { id: second.id } })).brokerId).toBe(owner);
    await expect.poll(() => b.toBrokers().filter((s) => s.kind === 'text').length).toBe(2);
    expect(b.toBrokers().filter((s) => s.kind === 'text')[1]!.text).toContain('Lead já existia no CRM');
  });

  it('falha forçada do CRM enfileira e reenvia; o corretor recebe sem esperar o CRM e o lead não é duplicado', async () => {
    let failures = 2;
    const inner = new SimulatedCrm(t.db);
    const flaky: CrmAdapter = {
      upsertContact: async (i) => { if (failures-- > 0) throw new CrmError('CRM indisponível', true); return inner.upsertContact(i); },
      attachSimulation: (c, s) => inner.attachSimulation(c, s),
    };
    const b = setup({ crm: flaky });
    await converse(b);

    // O corretor recebe mesmo com o CRM fora do ar.
    await expect.poll(() => b.toBrokers().length).toBe(2);
    // O job do CRM falhou, ficou na fila com o erro e foi reenviado até dar certo.
    await expect.poll(() => t.db.crmContact.count()).toBe(1);
    const job = await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'CRM_SYNC' } });
    expect(job.attempts).toBe(3);
    await expect.poll(async () => (await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'CRM_SYNC' } })).status).toBe('DONE');
    expect(await t.db.crmSimulation.count()).toBe(1);
    expect(await t.db.lead.count()).toBe(1);
  });

  it('CRM fora do ar por tempo demais: o job fica DEAD com o erro (para o administrador) e dá para reenfileirar', async () => {
    const broken: CrmAdapter = { upsertContact: async () => { throw new CrmError('CRM indisponível', true); }, attachSimulation: async () => true };
    const b = setup({ crm: broken, workerOverrides: { maxAttempts: 3 } });
    await converse(b);
    await expect.poll(async () => (await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'CRM_SYNC' } })).status).toBe('DEAD');
    expect((await t.db.deliveryJob.findFirstOrThrow({ where: { kind: 'CRM_SYNC' } })).lastError).toContain('CRM indisponível');
    expect(await t.db.crmContact.count()).toBe(0);
    expect((await t.db.lead.findFirstOrThrow()).status).not.toBe('CLOSED'); // o lead não se perde
  });
});

describe('queda no meio do cálculo', () => {
  it('a reentrega da mesma mensagem termina a simulação sem repetir a etapa nem duplicar entregas', async () => {
    const b = setup({ startWorker: false });
    await b.say('oi'); await b.say('sim');
    for (const a of answers('70 mil')) await b.say(a);
    // O envio de "estou fazendo as contas" falha: a etapa já foi gravada (SIMULATING).
    b.fail.sendText = 1;
    await expect(b.say('sim', { id: 'confirma' })).rejects.toThrow('boom');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('SIMULATING');

    const out = await b.say('sim', { id: 'confirma' }); // reentrega
    expect(texts(out)).toContain('fazendo as contas');
    expect(texts(out)).toContain('indicativa');
    expect((await t.db.conversation.findFirstOrThrow()).state).toBe('RESULT');
    expect(await t.db.simulation.count()).toBe(1);
    expect(await t.db.deliveryJob.count()).toBe(2);
  });

  it('mensagem nova com a simulação pendente: termina o cálculo e depois trata a mensagem', async () => {
    const b = setup({ startWorker: false });
    await b.say('oi'); await b.say('sim');
    for (const a of answers('70 mil')) await b.say(a);
    b.fail.sendText = 1;
    await expect(b.say('sim', { id: 'confirma' })).rejects.toThrow('boom');
    const out = await b.say('3'); // "receber o PDF" já no resultado
    expect(texts(out)).toContain('indicativa');
    expect(out.some((s) => s.kind === 'document')).toBe(true);
  });
});

describe('quando não dá para simular', () => {
  it('sem unidade disponível para a tipologia: oferece o corretor (handoff), sem números inventados e sem entregas de simulação', async () => {
    const b = setup({ startWorker: false });
    await b.say('oi'); await b.say('sim');
    for (const a of answers('70 mil')) await b.say(a);
    await t.sql(`update units set status = 'SOLD' where typology = '2 dormitórios'`);
    try {
      const out = await b.say('sim');
      expect(texts(out)).toContain('Não consegui fechar a simulação');
      expect(texts(out)).not.toMatch(/R\$/);
      const lead = await t.db.lead.findFirstOrThrow({ include: { conversations: true } });
      expect(lead.status).toBe('HANDOFF');
      expect(lead.conversations[0]).toMatchObject({ state: 'HANDOFF', handoff: true });
      // Só o aviso de handoff ao corretor: nenhuma entrega de simulação (CRM ou dossiê).
      expect((await t.db.deliveryJob.findMany()).map((j) => j.kind)).toEqual(['HANDOFF_NOTIFY']);
    } finally {
      await t.sql(`update units set status = 'AVAILABLE'`);
    }
  });
});
