import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ChannelAdapter } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { initialSnapshot, resumeAfterHandoff, type FlowEnv, type Snapshot } from '@mvp/conversation';
import { saveTurn, seedDatabase } from '@mvp/db';
import { releaseLeadHandoff } from '@mvp/db/panel';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createDeliveryHandler } from '../src/delivery';
import { createDeliveryWorker } from '../src/delivery-worker';
import { createOrchestrator } from '../src/orchestrator';

// Fase 15: o painel devolve o handoff ao bot e pede o envio da próxima pergunta (job OUTBOX_FLUSH).
// O estado já foi gravado pelo painel; o bot só precisa enviar o que ficou pendente, uma única vez.

let t: TestDb;
const clock = new Date('2026-11-05T12:00:00Z');
const env: FlowEnv = { today: '2026-11-05', developmentName: 'Lumen Urban', typologies: [], channelPhone: null };

beforeAll(async () => {
  t = await createTestDb();
  await seedDatabase(t.db, { today: '2026-11-05' });
});
afterAll(() => t.drop());

let workers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
});

function setup(withFlush = true) {
  const sent: { to: string; text: string }[] = [];
  const channel: ChannelAdapter = {
    markRead: async () => undefined,
    setPresence: async () => undefined,
    sendText: async (to, text) => { sent.push({ to, text }); return { externalId: null }; },
    sendList: async (to, a) => { sent.push({ to, text: a.title }); return { externalId: null }; },
    sendDocument: async () => ({ externalId: null }),
  };
  const handle = createOrchestrator({ db: t.db, channel, hashSecret: 'segredo-de-teste-123456', now: () => clock, sleep: async () => undefined });
  const worker = createDeliveryWorker({
    db: t.db,
    handle: createDeliveryHandler({ db: t.db, channel, crm: new SimulatedCrm(t.db), ...(withFlush ? { flushOutbox: handle.flushLead } : {}) }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    maxAttempts: 3, lockMs: 60_000, pollMs: 15, backoffMs: () => 5,
  });
  workers.push(worker);
  worker.start();
  return { sent, worker };
}

async function until(cond: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timeout');
}

let n = 0;
async function handedOffLead() {
  const phone = `551398126${String(5000 + ++n)}`;
  const lead = await t.db.lead.create({ data: { name: 'Maria', phone, channelJid: `${phone}@s.whatsapp.net`, status: 'HANDOFF' } });
  const conv = await t.db.conversation.create({ data: { leadId: lead.id, channel: 'WHATSAPP', state: 'NAME' } });
  const snap: Snapshot = { ...initialSnapshot(), state: 'HANDOFF', data: { name: 'Maria' }, handoffFrom: 'INCOME' };
  const { history, ...context } = snap;
  await saveTurn(t.db, { conversationId: conv.id, leadId: lead.id, state: 'HANDOFF', context: context as object, history: history as object[], writes: { handoff: true, status: 'HANDOFF' } });
  return { lead, conv, jid: `${phone}@s.whatsapp.net`, snap };
}

/** O que o serviço do painel faz: retoma pela máquina e grava o estado com o job de envio. */
async function releaseLikePanel(leadId: string, snap: Snapshot) {
  const { snapshot } = resumeAfterHandoff(snap, env, clock.toISOString());
  const { history, ...context } = snapshot;
  const r = await releaseLeadHandoff(t.db, {
    actor: 'painel-user', leadId, brokerId: null, force: true, now: clock, flush: true,
    next: { state: snapshot.state, context: context as object as never, history: history as object[] as never, leadStatus: 'IN_PROGRESS' },
  });
  expect(r).toEqual({ ok: true });
}

describe('devolução do handoff pelo painel', () => {
  it('o bot envia a pergunta em que o lead estava, uma vez só, e limpa o que estava pendente', async () => {
    const { sent } = setup();
    const { lead, conv, jid, snap } = await handedOffLead();
    await releaseLikePanel(lead.id, snap);

    await until(async () => sent.length > 0);
    expect(sent.every((s) => s.to === jid)).toBe(true);
    expect(sent.map((s) => s.text).join('\n')).toMatch(/renda/i);
    await until(async () => (await t.db.deliveryJob.count({ where: { leadId: lead.id, status: 'DONE' } })) === 1);

    const persisted = await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect((persisted.context as { outbox: unknown[] }).outbox).toEqual([]);
    expect(persisted.state).toBe('INCOME');
    const count = sent.length;
    // um segundo pedido não reenvia nada: o que estava pendente já saiu
    await t.db.deliveryJob.create({ data: { kind: 'OUTBOX_FLUSH', leadId: lead.id, dedupeKey: `again-${lead.id}`, payload: {} } });
    await until(async () => (await t.db.deliveryJob.count({ where: { leadId: lead.id, kind: 'OUTBOX_FLUSH', status: 'DONE' } })) === 2);
    expect(sent.length).toBe(count);
  });

  it('worker sem a função de envio recusa o job em vez de perdê-lo em silêncio', async () => {
    const { sent } = setup(false);
    const { lead, snap } = await handedOffLead();
    await releaseLikePanel(lead.id, snap);
    await until(async () => (await t.db.deliveryJob.count({ where: { leadId: lead.id, status: 'DEAD' } })) === 1);
    expect(sent).toEqual([]);
  });
});
