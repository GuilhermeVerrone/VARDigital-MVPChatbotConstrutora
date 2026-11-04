import { afterEach, describe, expect, it, vi } from 'vitest';
import { signWaAkgPayload, type InboundMessage } from '@mvp/channel';
import type { DependencyChecks } from '../src/deps';
import type { InboxWriter } from '../src/inbox';
import { WA_AKG_WEBHOOK_PATH } from '../src/routes/wa-akg-webhook';
import { buildServer } from '../src/server';

import { createPhoneAllowlist } from '@mvp/channel';
const allowlist = createPhoneAllowlist(['5511987654321']);
const secret = 'a-very-long-test-secret';
const deps: DependencyChecks = {
  postgres: async () => ({ ok: true, latencyMs: 1 }),
  llm: async () => ({ ok: true, latencyMs: 1 }),
};

function received(over: Record<string, unknown> = {}, sessionId = 'piloto', event = 'message.received') {
  return JSON.stringify({
    event,
    sessionId,
    timestamp: '2026-10-29T12:00:00.000Z',
    data: {
      key: { id: 'MSG1', fromMe: false, remoteJid: '5511987654321@s.whatsapp.net' },
      from: '5511987654321@s.whatsapp.net',
      isGroup: false,
      chatType: 'PERSONAL',
      type: 'TEXT',
      content: 'oi',
      ...over,
    },
  });
}

let app: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function setup(enqueue: InboxWriter['enqueue'] = async () => true) {
  const enqueued: InboundMessage[] = [];
  const onEnqueued = vi.fn();
  app = buildServer({
    webhookSecret: secret,
    sessionId: 'piloto',
    allowlist,
    deps,
    onEnqueued,
    inbox: {
      enqueue: async (m) => {
        enqueued.push(m);
        return enqueue(m);
      },
    },
  });
  const post = (body: string) =>
    app!.inject({
      method: 'POST',
      url: WA_AKG_WEBHOOK_PATH,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signWaAkgPayload(body, secret) },
      payload: body,
    });
  return { post, enqueued, onEnqueued };
}

describe('ingress: filtro e fila', () => {
  it('mensagem individual é gravada na fila e acorda o worker', async () => {
    const { post, enqueued, onEnqueued } = setup();
    const res = await post(received());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, queued: true, duplicate: false });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ externalId: 'MSG1', chatId: '5511987654321@s.whatsapp.net', text: 'oi' });
    expect(onEnqueued).toHaveBeenCalledTimes(1);
  });

  it('reentrega: 200, marcada como duplicada, sem acordar o worker', async () => {
    const { post, onEnqueued } = setup(async () => false);
    const res = await post(received());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, queued: false, duplicate: true });
    expect(onEnqueued).not.toHaveBeenCalled();
  });

  it.each([
    ['fromMe', received({ key: { id: 'X', fromMe: true, remoteJid: '5511987654321@s.whatsapp.net' } }), 'from_me'],
    ['grupo', received({ isGroup: true, chatType: 'GROUP', key: { id: 'X', fromMe: false, remoteJid: '1203@g.us' } }), 'group'],
    ['outro evento', received({}, 'piloto', 'message.sent'), 'not_message_event'],
    ['connection.update', received({}, 'piloto', 'connection.update'), 'not_message_event'],
    ['outra sessão', received({}, 'outra'), 'other_session'],
    ['remetente fora da lista', received({ key: { id: 'X', fromMe: false, remoteJid: '5513900000000@s.whatsapp.net' } }), 'not_allowed'],
  ])('não enfileira: %s', async (_name, body, reason) => {
    const { post, enqueued } = setup();
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, ignored: reason });
    expect(enqueued).toHaveLength(0);
  });

  it('falha ao gravar na fila devolve 500 (visível no log, não finge sucesso)', async () => {
    const { post, onEnqueued } = setup(async () => {
      throw new Error('db down');
    });
    const res = await post(received());
    expect(res.statusCode).toBe(500);
    expect(onEnqueued).not.toHaveBeenCalled();
  });
});
