import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelError, signWaAkgPayload, type ChannelAdapter } from '@mvp/channel';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { createEchoHandler } from '../src/handlers/echo';
import { createDbInbox } from '../src/inbox';
import { WA_AKG_WEBHOOK_PATH } from '../src/routes/wa-akg-webhook';
import { buildServer } from '../src/server';
import { createWorker, type Worker } from '../src/worker';

// Ponta a ponta sem o WhatsApp: webhook assinado → fila no Postgres → worker → eco no canal.
// Só o canal de saída é simulado (registra o que seria enviado).

import { createPhoneAllowlist } from '@mvp/channel';
const allowlist = createPhoneAllowlist(['5511987654321']);
const secret = 'a-very-long-test-secret';
const JID = '5511987654321@s.whatsapp.net';
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());
beforeEach(() => t.sql('delete from processed_messages'));

function webhookBody(id: string, text = `texto ${id}`, chat = JID) {
  return JSON.stringify({
    event: 'message.received',
    sessionId: 'piloto',
    allowlist,
    timestamp: '2026-10-29T12:00:00.000Z',
    data: { key: { id, fromMe: false, remoteJid: chat }, from: chat, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: text },
  });
}

function fakeChannel(opts: { failSends?: number } = {}) {
  const events: string[] = [];
  let failures = opts.failSends ?? 0;
  const channel = {
    markRead: async (_c: string, ids: string[]) => void events.push(`read:${ids.join(',')}`),
    setPresence: async (_c: string, p: string) => void events.push(`presence:${p}`),
    sendText: async (_c: string, text: string) => {
      if (failures > 0) {
        failures--;
        throw new ChannelError('WA-AKG 503', true, 503);
      }
      events.push(`send:${text}`);
      return { externalId: 'OUT' };
    },
  } as unknown as ChannelAdapter;
  return { channel, events, sends: () => events.filter((e) => e.startsWith('send:')) };
}

const inbox = () => createDbInbox(t.db, { lockMs: 150, maxAttempts: 4 });

function stack(channel: ChannelAdapter) {
  const box = inbox();
  const worker = createWorker({
    inbox: box,
    handle: createEchoHandler(channel, { sleep: async () => undefined }),
    log: silent,
    maxAttempts: 4,
    pollMs: 10,
    backoffMs: () => 20,
  });
  const app = buildServer({
    webhookSecret: secret,
    sessionId: 'piloto',
    allowlist,
    deps: { postgres: async () => ({ ok: true, latencyMs: 1 }), llm: async () => ({ ok: true, latencyMs: 1 }) },
    inbox: box,
    onEnqueued: () => worker.kick(),
  });
  const post = (body: string) =>
    app.inject({
      method: 'POST',
      url: WA_AKG_WEBHOOK_PATH,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signWaAkgPayload(body, secret) },
      payload: body,
    });
  return { app, worker, box, post };
}

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
function track<T extends { app: { close(): Promise<unknown> }; worker: Worker }>(s: T): T {
  cleanup.push(() => s.worker.stop(), () => s.app.close());
  return s;
}
const rows = () => t.db.processedMessage.findMany({ orderBy: { receivedAt: 'asc' } });

describe('pipeline: webhook → fila → worker → canal', () => {
  it('mensagem chega, é gravada e respondida com "digitando…" antes do texto', async () => {
    const ch = fakeChannel();
    const s = track(stack(ch.channel));
    s.worker.start();

    expect((await s.post(webhookBody('M1', 'quero simular'))).json()).toMatchObject({ queued: true });
    await expect.poll(() => ch.sends()).toEqual(['send:Eco: quero simular']);
    await expect.poll(async () => (await rows())[0]?.status).toBe('DONE');

    expect(ch.events).toEqual(['read:M1', 'presence:composing', 'send:Eco: quero simular', 'presence:paused']);
    const [row] = await rows();
    expect(row).toMatchObject({ externalId: 'M1', status: 'DONE', payload: null, attempts: 1 });
  });

  it('reentrega do mesmo key.id (inclusive simultânea) é processada uma única vez', async () => {
    const ch = fakeChannel();
    const s = track(stack(ch.channel));
    s.worker.start();

    const body = webhookBody('DUP', 'só uma vez');
    const results = await Promise.all([s.post(body), s.post(body), s.post(body), s.post(body)]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.filter((r) => r.json().queued)).toHaveLength(1);

    await expect.poll(async () => (await rows())[0]?.status).toBe('DONE');
    await s.post(body); // reentrega tardia, depois de concluída
    await new Promise((r) => setTimeout(r, 100));

    expect(await rows()).toHaveLength(1);
    expect(ch.sends()).toEqual(['send:Eco: só uma vez']);
  });

  it('worker parado: o webhook continua gravando; ao subir, nada se perdeu e a ordem se mantém', async () => {
    const ch = fakeChannel();
    const s = track(stack(ch.channel)); // worker NÃO iniciado
    for (const id of ['A', 'B', 'C']) await s.post(webhookBody(id));
    expect((await rows()).map((r) => r.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(ch.sends()).toEqual([]);

    s.worker.start();
    await expect.poll(() => ch.sends().length).toBe(3);
    expect(ch.sends()).toEqual(['send:Eco: texto A', 'send:Eco: texto B', 'send:Eco: texto C']);
  });

  it('worker que cai no meio do processamento: outro worker retoma a mensagem', async () => {
    const ch = fakeChannel();
    const s = track(stack(ch.channel));
    await s.post(webhookBody('CRASH'));

    // "Worker 1" reserva a mensagem e morre sem concluir nem falhar.
    const taken = await s.box.claim();
    expect(taken?.message.externalId).toBe('CRASH');
    expect((await rows())[0]).toMatchObject({ status: 'PROCESSING', attempts: 1 });

    // "Worker 2" sobe; depois que a reserva (150 ms) vence, processa.
    s.worker.start();
    await expect.poll(() => ch.sends(), { timeout: 5000 }).toEqual(['send:Eco: texto CRASH']);
    await expect.poll(async () => (await rows())[0]?.status).toBe('DONE');
    expect((await rows())[0]!.attempts).toBe(2);
  });

  it('canal fora do ar: reagenda com backoff e entrega uma vez quando volta', async () => {
    const ch = fakeChannel({ failSends: 2 });
    const s = track(stack(ch.channel));
    s.worker.start();
    await s.post(webhookBody('RETRY'));

    await expect.poll(() => ch.sends(), { timeout: 5000 }).toEqual(['send:Eco: texto RETRY']);
    await expect.poll(async () => (await rows())[0]?.status).toBe('DONE');
    expect((await rows())[0]!.attempts).toBe(3);
  });

  it('canal fora do ar para sempre: vira DEAD depois das tentativas, sem travar a conversa', async () => {
    const ch = fakeChannel({ failSends: 4 });
    const s = track(stack(ch.channel));
    s.worker.start();
    await s.post(webhookBody('LOST'));
    await expect.poll(async () => (await rows())[0]?.status, { timeout: 5000 }).toBe('DEAD');
    expect((await rows())[0]).toMatchObject({ attempts: 4, lastError: 'WA-AKG 503' });

    await s.post(webhookBody('NEXT'));
    await expect.poll(() => ch.sends(), { timeout: 5000 }).toEqual(['send:Eco: texto NEXT']);
  });
});
