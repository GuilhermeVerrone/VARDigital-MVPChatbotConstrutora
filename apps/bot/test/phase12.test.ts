import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelAdapter, InboundMessage } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { createFlowDraft, publishFlowConfig, seedElevare, assignContactCode } from '@mvp/db';
import { collectNumbers, unexplainedNumbers } from '@mvp/presentation';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createDeliveryHandler } from '../src/delivery';
import { createDeliveryWorker } from '../src/delivery-worker';
import { createOrchestrator } from '../src/orchestrator';
import { createRetention } from '../src/retention';

// Fase 12 de ponta a ponta contra Postgres real: conversa v2 (3 formas de pagamento, início pelo
// formulário, textos do FlowConfig) com os 3 empreendimentos Elevare. Só o canal de saída é falso.

const PHONE = '5511912345678';
const JID = `${PHONE}@s.whatsapp.net`;
const BROKER_JIDS = ['5500900000011@s.whatsapp.net', '5500900000012@s.whatsapp.net', '5500900000013@s.whatsapp.net'];
const clock = new Date('2026-11-06T12:00:00Z');
let t: TestDb;
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await seedElevare(t.db, { today: '2026-11-06' });
});
afterAll(() => t.drop());

interface Sent { to: string; kind: 'text' | 'list' | 'document'; text: string; bytes?: Uint8Array }

function fakeChannel() {
  const sent: Sent[] = [];
  const channel: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendText: async (to, text) => { sent.push({ to, kind: 'text', text }); return { externalId: null }; },
    sendList: async (to, a) => { sent.push({ to, kind: 'list', text: `${a.title}\n${a.options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')}${a.footer ? `\n${a.footer}` : ''}` }); return { externalId: null }; },
    sendDocument: async (to, a) => { sent.push({ to, kind: 'document', text: a.caption ?? '', bytes: a.data }); return { externalId: null }; },
  };
  return { channel, sent };
}

let workers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
});
beforeEach(async () => {
  await t.sql('truncate delivery_jobs, crm_simulations, crm_contacts, chat_sessions, audit_logs, financial_profiles, consents, conversations, simulations, leads cascade');
  // Versão publicada é histórico (imutável): aposenta a vigente e apaga rascunhos para cada teste começar sem fluxo publicado.
  await t.sql("delete from flow_configs where status = 'DRAFT'");
  await t.sql("update flow_configs set status = 'RETIRED' where status = 'PUBLISHED'");
  await t.sql('update brokers set last_assigned_at = null, active = true');
});

function setup(opts: { startWorker?: boolean } = {}) {
  const ch = fakeChannel();
  const worker = createDeliveryWorker({
    db: t.db,
    handle: createDeliveryHandler({ db: t.db, channel: ch.channel, crm: new SimulatedCrm(t.db) }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    maxAttempts: 5, lockMs: 60_000, pollMs: 20, backoffMs: () => 10,
  });
  workers.push(worker);
  if (opts.startWorker) worker.start();
  const handle = createOrchestrator({
    db: t.db, channel: ch.channel, hashSecret: 'segredo-de-teste-123456', now: () => clock, sleep: async () => undefined,
    onJobsEnqueued: () => worker.kick(),
  });
  const say = async (text: string, o: { chat?: string; phone?: string | null } = {}) => {
    const before = ch.sent.length;
    const chatId = o.chat ?? JID;
    const msg: InboundMessage = {
      channel: 'WHATSAPP', sessionId: 's', externalId: `m${++n}`, chatId, phone: o.phone === undefined ? PHONE : o.phone,
      pushName: null, type: 'text', text, receivedAt: clock.toISOString(),
    };
    await handle(msg);
    return ch.sent.slice(before).filter((s) => s.to === chatId);
  };
  const seq = async (answers: string[], o: Parameters<typeof say>[1] = {}) => {
    let out: Sent[] = [];
    for (const a of answers) out = await say(a, o);
    return out;
  };
  return { ...ch, say, seq, worker, handle };
}

const texts = (s: Sent[]) => s.map((x) => x.text).join('\n---\n');
const lastText = (s: Sent[]) => s.at(-1)!.text;

/** Consentimento, identificação e escolha de Lumen Urban / Studio, até a pergunta da forma de pagamento. */
const START = ['oi', 'sim', 'Maria da Silva', 'sim', 'pular', '1', '1'];
/** Perfil com estimativa do banco ligada (condição ILUSTRATIVO do seed): renda, tipo, nascimento, dívidas, co-proponente. */
const PROFILE = ['9 mil', 'clt', '05/03/1990', 'não', 'não'];
/** FGTS, imóvel e primeiro financiamento (estimativa do banco). */
const ELIGIBILITY = ['não', 'não', 'sim'];

const unitNumbers = (sim: { input: unknown; result: unknown }, unit: { code: string; typology: string; areaM2: unknown }) => {
  const set = collectNumbers([sim.input, sim.result, { areaM2: Number(unit.areaM2) }]);
  for (const d of `${unit.code} ${unit.typology}`.match(/\d+/g) ?? []) set.add(Number(d));
  for (const d of PHONE.replace(/^55/, '').match(/^(\d{2})(\d{5})(\d{4})$/)!.slice(1)) set.add(Number(d));
  return set;
};

describe('início pelo WhatsApp: empreendimento e forma de pagamento', () => {
  it('pergunta o empreendimento entre os três e a forma de pagamento com as opções da condição', async () => {
    const b = setup();
    await b.seq(['oi', 'sim', 'Maria da Silva', 'sim', 'pular']);
    const dev = await b.say('oi de novo');
    expect(lastText(dev)).toContain('Lumen Urban');
    expect(lastText(dev)).toContain('Parc Verde');
    expect(lastText(dev)).toContain('Altomare');
    const typology = await b.say('parc verde');
    expect(lastText(typology)).toContain('Parc Verde');
    expect(lastText(typology)).toContain('2 dormitórios');
    expect(lastText(typology)).not.toContain('Studio');
    const mode = await b.say('1');
    expect(lastText(mode)).toContain('Como você pensa em pagar o imóvel?');
    expect(lastText(mode)).toContain('Pagar à vista');
    expect(lastText(mode)).toContain('Parcelar a entrada com a construtora');
    const lead = await t.db.lead.findFirstOrThrow({ include: { development: true } });
    expect(lead.development?.slug).toBe('parc-verde');
  });
});

describe('modo 3: entrada parcelada, ponta a ponta', () => {
  it('calcula com a condição vigente, mostra o plano e grava modo, versão e plano; o corretor recebe o dossiê com o plano', async () => {
    const b = setup({ startWorker: true });
    const out = await b.seq([...START, '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim']);
    const all = texts(out);
    expect(all).toContain('fazendo as contas');
    expect(all).toContain('Como fica a entrada');
    expect(all).toContain('Ato, hoje: R$ 30.000');
    expect(all).toContain('Saldo para financiar nas chaves');
    expect(all).toContain('ILUSTRATIVA');
    expect(all).toContain('Já passei o seu resumo para um corretor');
    expect(lastText(out)).toContain('Mudar o valor do ato');
    expect(lastText(out)).toContain('Aceitar ou recusar reforços');
    expect(lastText(out)).toContain('Falar com um corretor');

    const sim = await t.db.simulation.findFirstOrThrow({ include: { unit: true, salesCondition: true } });
    expect(sim.paymentMode).toBe('ENTRADA_PARCELADA');
    expect(sim.salesCondition?.version).toContain('lumen-urban');
    expect(sim.downPaymentPlan).toMatchObject({ act: 30000 });
    expect(sim.unit?.code).toMatch(/^LU-/);
    const lead = await t.db.lead.findFirstOrThrow({ include: { financialProfile: true, development: true } });
    expect(lead).toMatchObject({ paymentMode: 'ENTRADA_PARCELADA', status: 'SIMULATED' });
    expect(lead.development?.slug).toBe('lumen-urban');
    expect(Number(lead.financialProfile?.cashNow)).toBe(30000);
    expect(lead.financialProfile?.acceptsBalloons).toBe(true);

    // Todo número do resultado vem do motor.
    const result = out.filter((s) => s.text.includes('Como fica a entrada') || s.text.includes('*Importante:*'));
    expect(result).toHaveLength(2);
    expect(unexplainedNumbers(texts(result), unitNumbers(sim, sim.unit!))).toEqual([]);

    // Corretor: dossiê com o modo e o plano, e PDF (a fila entrega sozinha).
    await expect.poll(async () => await t.db.deliveryJob.count({ where: { status: 'DONE' } }), { timeout: 5000 }).toBe(2);
    const toBroker = b.sent.filter((s) => BROKER_JIDS.includes(s.to));
    expect(toBroker.some((s) => s.kind === 'text' && s.text.includes('Forma de pagamento: Entrada parcelada com a construtora') && s.text.includes('Plano da entrada: ato R$ 30.000'))).toBe(true);
    expect(toBroker.some((s) => s.kind === 'document' && Buffer.from(s.bytes!).subarray(0, 4).toString() === '%PDF')).toBe(true);
    const crm = await t.db.crmSimulation.findFirstOrThrow();
    expect(crm.summary).toMatchObject({ paymentMode: 'ENTRADA_PARCELADA', cashNow: 30000, conditionVersion: sim.salesCondition?.version });
  });

  it('"mudar o ato" recalcula com o novo valor e atualiza o corretor, sem mexer no perfil', async () => {
    const b = setup({ startWorker: false });
    await b.seq([...START, '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim']);
    const ask = await b.say('1');
    expect(lastText(ask)).toContain('Hoje considerei R$ 30.000');
    const out = await b.say('50 mil');
    const all = texts(out);
    expect(all).toContain('refiz a simulação');
    expect(all).toContain('R$ 50.000 disponíveis agora');
    expect(all).toContain('Atualizei o resumo do corretor');
    expect(await t.db.simulation.count()).toBe(2);
    const profile = await t.db.financialProfile.findFirstOrThrow();
    expect(Number(profile.cashNow)).toBe(30000);
    const jobs = await t.db.deliveryJob.findMany({ where: { kind: 'BROKER_NOTIFY' }, orderBy: { createdAt: 'asc' } });
    expect(jobs.at(-1)?.payload).toMatchObject({ update: true });
  });

  it('reforços: recusar recalcula; outra unidade troca a tipologia', async () => {
    const b = setup({ startWorker: false });
    await b.seq([...START, '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim']);
    await b.say('reforços');
    const noBalloons = await b.say('não');
    expect(texts(noBalloons)).toContain('sem reforços');
    const sims = await t.db.simulation.findMany({ orderBy: { generatedAt: 'asc' } });
    expect((sims.at(-1)!.input as { acceptsBalloons: boolean }).acceptsBalloons).toBe(false);

    await b.say('outra unidade');
    const other = await b.say('1 dormitório');
    expect(texts(other)).toContain('1 dormitório');
    const unit = await t.db.simulation.findFirstOrThrow({ orderBy: { generatedAt: 'desc' }, include: { unit: true } });
    expect(unit.unit?.typology).toBe('1 dormitório');
  });

  it('mudar a forma de pagamento no resultado refaz só o que a nova forma pede', async () => {
    const b = setup({ startWorker: false });
    await b.seq([...START, '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim']);
    await b.say('outra forma de pagamento');
    const confirm = await b.say('1'); // à vista
    expect(texts(confirm)).toContain('Forma de pagamento: à vista');
    const out = await b.say('sim');
    expect(texts(out)).toContain('Pagamento à vista');
    expect(lastText(out)).toContain('Quer que um corretor entre em contato agora');
    expect((await t.db.simulation.findFirstOrThrow({ orderBy: { generatedAt: 'desc' } })).paymentMode).toBe('A_VISTA');
  });
});

describe('modo 1: à vista', () => {
  it('não pergunta renda, mostra desconto e total do motor, oferece o corretor e, no "sim", passa o atendimento', async () => {
    const b = setup({ startWorker: false });
    const out = await b.seq([...START, '1', 'sim']);
    const all = texts(out);
    expect(all).not.toContain('renda');
    expect(all).toContain('Desconto à vista');
    expect(all).toContain('Total a pagar');
    expect(lastText(out)).toContain('Quer que um corretor entre em contato agora');
    const sim = await t.db.simulation.findFirstOrThrow({ include: { unit: true } });
    expect(sim.paymentMode).toBe('A_VISTA');
    expect(await t.db.financialProfile.count()).toBe(0);
    expect(unexplainedNumbers(texts(out.filter((s) => s.text.includes('Desconto à vista'))), unitNumbers(sim, sim.unit!))).toEqual([]);

    const handoff = await b.say('sim');
    expect(lastText(handoff)).toContain('corretor falar com você');
    const conv = await t.db.conversation.findFirstOrThrow();
    expect(conv).toMatchObject({ state: 'HANDOFF', handoff: true });
  });
});

describe('modo 2: entrada de uma vez e financiamento do saldo', () => {
  it('com a estimativa do banco ligada, pergunta o perfil e mostra a estimativa do saldo', async () => {
    const b = setup({ startWorker: false });
    const out = await b.seq([...START, '2', '120 mil', ...PROFILE, ...ELIGIBILITY, 'sim']);
    const all = texts(out);
    expect(all).toContain('Entrada');
    expect(all).toContain('Estimativa do financiamento do saldo nas chaves');
    expect(lastText(out)).toContain('Mudar o valor da entrada');
    const sim = await t.db.simulation.findFirstOrThrow();
    expect(sim.paymentMode).toBe('ENTRADA_A_VISTA');
    expect(sim.bankEstimate).not.toBeNull();
    expect(sim.parametersVersion).toContain('ILUSTRATIVO');
  });

  it('com a data de nascimento desligada no painel, calcula sem a estimativa do banco', async () => {
    const draft = await createFlowDraft(t.db, { actor: 'teste', content: { optionalSteps: { BIRTH: false } } });
    await publishFlowConfig(t.db, draft.id, { actor: 'teste', reason: 'teste', now: clock });
    const b = setup({ startWorker: false });
    const out = await b.seq([...START, '2', '120 mil', 'sim']);
    expect(texts(out)).not.toContain('Estimativa do financiamento');
    const sim = await t.db.simulation.findFirstOrThrow();
    expect(sim.bankEstimate).toBeNull();
  });
});

describe('textos e etapas do FlowConfig publicado', () => {
  it('usa o texto da chave publicada e o padrão do código nas demais; etapa desligada é pulada', async () => {
    const draft = await createFlowDraft(t.db, {
      actor: 'teste',
      content: { texts: { ASK_NAME: 'Como posso te chamar?' }, optionalSteps: { EMAIL: false } },
    });
    await publishFlowConfig(t.db, draft.id, { actor: 'teste', reason: 'teste', now: clock });
    const b = setup();
    const name = await b.seq(['oi', 'sim']);
    expect(lastText(name)).toContain('Como posso te chamar?');
    await b.say('Maria da Silva');
    const afterPhone = await b.say('sim');
    // E-mail desligado: a próxima pergunta já é o empreendimento.
    expect(lastText(afterPhone)).toContain('Qual empreendimento da Elevare você quer conhecer?');
    expect(texts(afterPhone)).not.toContain('e-mail');
  });
});

describe('início pelo formulário do site (double opt-in)', () => {
  async function formLead(over: { phone?: string | null } = {}) {
    const dev = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' } });
    const lead = await t.db.lead.create({
      data: { name: 'Ana Souza', phone: over.phone === undefined ? PHONE : over.phone, email: null, source: 'SITE_FORM', status: 'NEW', developmentId: dev.id, formSubmittedAt: clock },
    });
    await t.db.consent.create({ data: { leadId: lead.id, textVersion: 'web-1', channel: 'WEB', acceptedAt: clock } });
    return lead;
  }

  it('o "sim" ao 1º contato segue direto às perguntas: sem consentimento, nome, telefone nem empreendimento', async () => {
    const lead = await formLead();
    const b = setup();
    const out = await b.say('sim');
    const all = texts(out);
    expect(all).toContain('Perfeito, Ana');
    expect(all).toContain('Qual tipo de unidade do Lumen Urban você procura?');
    expect(all).not.toMatch(/concorda|nome completo|telefone|Qual empreendimento/i);
    const after = await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ status: 'IN_PROGRESS', channelJid: JID });
    expect(after.contactConfirmedAt).not.toBeNull();
    expect(await t.db.consent.count({ where: { leadId: lead.id } })).toBe(1); // só o do formulário
    expect(await t.db.chatSession.count()).toBe(0);

    // A conversa segue normalmente: a tipologia leva à forma de pagamento.
    const next = await b.say('1');
    expect(lastText(next)).toContain('Como você pensa em pagar');
  });

  it('"não" encerra, marca o lead como encerrado e não manda mais nada', async () => {
    const lead = await formLead();
    const b = setup();
    const no = await b.say('não, não pedi nada');
    expect(lastText(no)).toContain('Não vou mais te escrever');
    const after = await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.status).toBe('CLOSED');
    expect(after.contactConfirmedAt).toBeNull();
    expect(await b.say('oi')).toEqual([]);
    expect(await b.say('quero simular')).toEqual([]);
    expect(await t.db.auditLog.count({ where: { entityId: lead.id, action: 'contact_declined' } })).toBe(1);
  });

  it('a resposta vinda de um @lid casa pelo código ELV-xxxx e já confirma o pedido', async () => {
    const lead = await formLead();
    const code = await assignContactCode(t.db, lead.id);
    const b = setup();
    const out = await b.say(`Oi! Quero minha simulação (${code})`, { chat: '99887766@lid', phone: null });
    expect(texts(out)).toContain('Perfeito, Ana');
    expect(texts(out)).toContain('Qual tipo de unidade do Lumen Urban você procura?');
    const after = await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ channelJid: '99887766@lid', status: 'IN_PROGRESS' });
    expect(after.contactConfirmedAt).not.toBeNull();
    // As mensagens seguintes do mesmo @lid continuam a conversa.
    const next = await b.say('1', { chat: '99887766@lid', phone: null });
    expect(lastText(next)).toContain('Como você pensa em pagar');
  });

  it('quem não veio do formulário continua pelo consentimento do chat', async () => {
    const b = setup();
    const out = await b.say('oi');
    expect(lastText(out)).toContain('Você concorda?');
  });

  it('silêncio por 48 h encerra o lead, sem mensagem', async () => {
    const lead = await formLead();
    await t.db.lead.update({ where: { id: lead.id }, data: { createdAt: new Date('2026-11-03T12:00:00Z') } });
    const retention = createRetention({ db: t.db, days: 180, intervalMs: 1000, log: { info: () => undefined, error: () => undefined }, now: () => clock });
    expect((await retention.sweep()).unconfirmed).toBe(1);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('CLOSED');
  });
});

describe('handoff e exclusão valem nos estados novos', () => {
  it('"quero falar com um corretor" no meio do ramo da entrada parcelada passa o atendimento', async () => {
    const b = setup({ startWorker: false });
    await b.seq([...START, '3', ...PROFILE]);
    const out = await b.say('quero falar com um corretor');
    expect(lastText(out)).toContain('corretor falar com você');
    expect(await t.db.conversation.count({ where: { state: 'HANDOFF' } })).toBe(1);
    expect(await t.db.deliveryJob.count({ where: { kind: 'HANDOFF_NOTIFY' } })).toBe(1);
  });

  it('o pedido de apagar os dados, depois de escolher a forma de pagamento, apaga o lead e a simulação', async () => {
    const b = setup({ startWorker: false });
    await b.seq([...START, '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim']);
    await b.say('quero que apaguem meus dados');
    const out = await b.say('sim');
    expect(lastText(out)).toContain('apaguei os seus dados');
    expect(await t.db.lead.count()).toBe(0);
    expect(await t.db.simulation.count()).toBe(0);
  });
});
