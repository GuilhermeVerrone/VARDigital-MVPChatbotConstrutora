import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelError, createPhoneAllowlist, restrictChannel, type ChannelAdapter } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { submitSiteLead, type SiteLeadInput } from '@mvp/db';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createDeliveryHandler } from '../src/delivery';
import { createDeliveryWorker } from '../src/delivery-worker';
import type { FirstContactOptions } from '../src/first-contact';
import { parseClock, parseDays } from '../src/lib/business-hours';

// Fase 13: o formulário vira lead + job FIRST_CONTACT, e o worker manda a 1ª mensagem com janela de
// horário, limite por hora e lista de permitidos. Postgres real; só o canal do WhatsApp é falso.

let t: TestDb;
let clock = new Date('2026-11-05T14:00:00Z'); // quinta 11:00 em São Paulo
let devId: string;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());

let workers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
});
beforeEach(async () => {
  clock = new Date('2026-11-05T14:00:00Z');
  await t.sql('truncate delivery_jobs, audit_logs, consents, conversations, leads, units, developments cascade');
  const d = await t.db.development.create({
    data: { slug: 'lumen-urban', name: 'Lumen Urban', city: 'Curitiba - PR', description: 'x', deliveryDate: new Date('2029-12-15'), published: true },
  });
  devId = d.id;
});

const form = (over: Partial<SiteLeadInput> = {}): SiteLeadInput => ({
  name: 'Ana Souza', phone: '5513981264295', email: null, developmentSlug: 'lumen-urban', typology: null, utm: null,
  consentText: 'privacidade', optInText: 'contato', now: clock, ...over,
});

function setup(over: { fail?: { n: number }; allowed?: string[]; first?: Partial<FirstContactOptions> } = {}) {
  const sent: { to: string; text: string }[] = [];
  const fail = over.fail ?? { n: 0 };
  const raw: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendList: async () => ({ externalId: null }),
    sendDocument: async () => ({ externalId: null }),
    sendText: async (to, text) => {
      if (fail.n > 0) { fail.n--; throw new ChannelError('WA-AKG fora', true, 503); }
      sent.push({ to, text });
      return { externalId: null };
    },
  };
  const allowlist = createPhoneAllowlist(over.allowed ?? ['5513981264295', '5513981264296', '5513981264297']);
  const channel = restrictChannel(raw, allowlist);
  const worker = createDeliveryWorker({
    db: t.db,
    handle: createDeliveryHandler({
      db: t.db, channel, crm: new SimulatedCrm(t.db),
      firstContact: {
        window: { startMin: parseClock('08:00'), endMin: parseClock('20:00'), days: parseDays('1-6'), timeZone: 'America/Sao_Paulo' },
        maxPerHour: 30, isAllowed: (p) => allowlist.isAllowed(p), retryMs: 1000, now: () => clock,
        ...over.first,
      },
    }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    maxAttempts: 3, lockMs: 60_000, pollMs: 15, backoffMs: () => 5, now: () => clock,
  });
  workers.push(worker);
  return { sent, fail, worker };
}

async function until(cond: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('condição não atingida a tempo');
}
const job = (leadId: string) => t.db.deliveryJob.findFirstOrThrow({ where: { leadId, kind: 'FIRST_CONTACT' } });

describe('1º contato do formulário', () => {
  it('formulário → mensagem no WhatsApp em até 1 min, com o nome e o empreendimento', async () => {
    const { sent, worker } = setup();
    const { leadId } = await submitSiteLead(t.db, form());
    const t0 = Date.now();
    worker.start();
    await until(async () => sent.length === 1);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(sent[0]!.to).toBe('5513981264295@s.whatsapp.net');
    expect(sent[0]!.text).toContain('Ana');
    expect(sent[0]!.text).toContain('Lumen Urban');
    await until(async () => (await job(leadId)).status === 'DONE');
    expect(await t.db.auditLog.count({ where: { action: 'first_contact_sent', entityId: leadId } })).toBe(1);
  });

  it('reenviar o formulário não duplica o lead nem a mensagem', async () => {
    const { sent, worker } = setup();
    const a = await submitSiteLead(t.db, form());
    worker.start();
    await until(async () => sent.length === 1);
    await until(async () => (await job(a.leadId)).status === 'DONE');
    const b = await submitSiteLead(t.db, form({ email: 'ana@exemplo.com' }));
    expect(b.leadId).toBe(a.leadId);
    worker.kick();
    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(1);
    expect(await t.db.lead.count()).toBe(1);
    expect(await t.db.deliveryJob.count()).toBe(1);
  });

  it('usa o texto do FlowConfig publicado quando existe', async () => {
    await t.db.flowConfig.create({
      data: { version: 1, status: 'PUBLISHED', publishedAt: clock, publishedBy: 'teste', createdBy: 'teste', content: { firstContact: 'Olá {nome}, é a Elevare sobre o {empreendimento}.' } },
    });
    const { sent, worker } = setup();
    await submitSiteLead(t.db, form());
    worker.start();
    await until(async () => sent.length === 1);
    expect(sent[0]!.text).toBe('Olá Ana, é a Elevare sobre o Lumen Urban.');
  });

  it('fora do horário comercial espera a abertura e depois envia', async () => {
    clock = new Date('2026-11-06T01:00:00Z'); // quinta 22:00 em SP
    const { sent, worker } = setup();
    const { leadId } = await submitSiteLead(t.db, form({ now: clock }));
    worker.start();
    await until(async () => (await job(leadId)).availableAt.toISOString() === '2026-11-06T11:00:00.000Z');
    expect(sent).toHaveLength(0);
    expect(await job(leadId)).toMatchObject({ status: 'PENDING', attempts: 0 });

    clock = new Date('2026-11-06T11:00:05Z'); // sexta 08:00 em SP
    worker.kick();
    await until(async () => sent.length === 1);
    await until(async () => (await job(leadId)).status === 'DONE');
  });

  it('WA-AKG fora: o job reenvia quando volta, sem mensagem duplicada e sem morrer', async () => {
    const { sent, fail, worker } = setup();
    fail.n = 6; // mais falhas do que as tentativas do job (3)
    const { leadId } = await submitSiteLead(t.db, form());
    worker.start();
    await until(async () => (await t.db.deliveryJob.findFirstOrThrow({ where: { leadId } })).lastError === 'canal indisponível');
    expect(sent).toHaveLength(0);
    expect((await job(leadId)).status).toBe('PENDING');
    for (let i = 0; i < 6; i++) {
      await until(async () => fail.n <= 5 - i || sent.length > 0);
      clock = new Date(clock.getTime() + 2000);
      worker.kick();
    }
    await until(async () => sent.length === 1);
    await until(async () => (await job(leadId)).status === 'DONE');
    expect(sent).toHaveLength(1);
  });

  it('limite por hora: o excedente espera a vaga abrir', async () => {
    const { sent, worker } = setup({ first: { maxPerHour: 2 } });
    const ids: string[] = [];
    for (const phone of ['5513981264295', '5513981264296', '5513981264297']) ids.push((await submitSiteLead(t.db, form({ phone }))).leadId);
    worker.start();
    await until(async () => sent.length === 2);
    const third = ids[2]!;
    await until(async () => (await job(third)).availableAt > clock);
    expect(sent).toHaveLength(2);
    expect(await job(third)).toMatchObject({ status: 'PENDING', attempts: 0 });

    clock = new Date(clock.getTime() + 61 * 60_000); // 15:01 em diante
    worker.kick();
    await until(async () => sent.length === 3);
  });

  it('número fora da lista de permitidos do piloto nunca recebe: job DEAD com o motivo', async () => {
    const { sent, worker } = setup({ allowed: ['5500000000000'] });
    const { leadId } = await submitSiteLead(t.db, form());
    worker.start();
    await until(async () => (await job(leadId)).status === 'DEAD');
    expect(sent).toHaveLength(0);
    expect((await job(leadId)).lastError).toContain('lista de permitidos');
  });

  it('quem já conversou, parou ou revogou o consentimento não recebe o 1º contato', async () => {
    const { sent, worker } = setup();
    const a = await submitSiteLead(t.db, form({ phone: '5513981264295' }));
    const b = await submitSiteLead(t.db, form({ phone: '5513981264296' }));
    const c = await submitSiteLead(t.db, form({ phone: '5513981264297' }));
    await t.db.conversation.create({ data: { leadId: a.leadId, channel: 'WHATSAPP', state: 'CONTACT_CONFIRM' } });
    await t.db.lead.update({ where: { id: b.leadId }, data: { status: 'OPTED_OUT' } });
    await t.db.consent.updateMany({ where: { leadId: c.leadId }, data: { revokedAt: clock } });
    worker.start();
    for (const id of [a.leadId, b.leadId, c.leadId]) await until(async () => (await job(id)).status === 'DONE');
    expect(sent).toHaveLength(0);
    expect(await t.db.auditLog.count({ where: { action: 'first_contact_skipped' } })).toBe(3);
  });

  it('pedido com mais de 24 h sem envio é descartado', async () => {
    const { sent, worker } = setup();
    const { leadId } = await submitSiteLead(t.db, form());
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    worker.start();
    await until(async () => (await job(leadId)).status === 'DEAD');
    expect(sent).toHaveLength(0);
    expect(devId).toBeTruthy();
  });
});
