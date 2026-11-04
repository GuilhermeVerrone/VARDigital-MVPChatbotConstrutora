import { afterEach, describe, expect, it } from 'vitest';
import { createPhoneAllowlist, signWaAkgPayload, type InboundMessage } from '@mvp/channel';
import type { DependencyChecks } from '../src/deps';
import { createRateLimiter } from '../src/lib/rate-limit';
import { WA_AKG_WEBHOOK_PATH } from '../src/routes/wa-akg-webhook';
import { buildServer } from '../src/server';

const secret = 'a-very-long-test-secret';
const deps: DependencyChecks = {
  postgres: async () => ({ ok: true, latencyMs: 1 }),
  ollama: async () => ({ ok: true, latencyMs: 1 }),
};

describe('createRateLimiter', () => {
  it('libera até o máximo na janela, bloqueia o excesso e volta depois da janela', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([1, 2, 3, 4].map(() => rl.allow('a'))).toEqual([true, true, true, false]);
    expect(rl.allow('b')).toBe(true); // outra conversa não é afetada
    t = 1001;
    expect(rl.allow('a')).toBe(true);
  });

  it('mensagem barrada não estende o bloqueio', () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
    rl.allow('a');
    t = 900;
    expect(rl.allow('a')).toBe(false);
    t = 1001;
    expect(rl.allow('a')).toBe(true);
  });

  it('max 0 desliga o limite', () => {
    const rl = createRateLimiter({ max: 0, windowMs: 1000 });
    expect(Array.from({ length: 100 }, () => rl.allow('a')).every(Boolean)).toBe(true);
  });
});

describe('limites no webhook', () => {
  let app: ReturnType<typeof buildServer> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const body = (id: string, content: string) =>
    JSON.stringify({
      event: 'message.received', sessionId: 'piloto', timestamp: '2026-10-29T12:00:00.000Z',
      data: { key: { id, fromMe: false, remoteJid: '5511987654321@s.whatsapp.net' }, from: '5511987654321@s.whatsapp.net', isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content },
    });

  function setup(extra: { max?: number; maxTextChars?: number }) {
    const queued: InboundMessage[] = [];
    app = buildServer({
      webhookSecret: secret, sessionId: 'piloto', allowlist: createPhoneAllowlist(['5511987654321']), deps,
      inbox: { enqueue: async (m) => { queued.push(m); return true; } },
      rateLimiter: createRateLimiter({ max: extra.max ?? 0, windowMs: 60_000 }),
      maxTextChars: extra.maxTextChars,
    });
    const post = (b: string) =>
      app!.inject({ method: 'POST', url: WA_AKG_WEBHOOK_PATH, headers: { 'content-type': 'application/json', 'x-webhook-signature': signWaAkgPayload(b, secret) }, payload: b });
    return { queued, post };
  }

  it('descarta a rajada acima do limite sem gravar na fila', async () => {
    const { queued, post } = setup({ max: 2 });
    const res = [await post(body('1', 'a')), await post(body('2', 'b')), await post(body('3', 'c'))];
    expect(res.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(res[2]!.json()).toMatchObject({ ignored: 'rate_limited' });
    expect(queued.map((m) => m.externalId)).toEqual(['1', '2']);
  });

  it('corta texto gigante antes de entrar na fila', async () => {
    const { queued, post } = setup({ maxTextChars: 50 });
    await post(body('1', 'x'.repeat(10_000)));
    expect(queued[0]!.text).toHaveLength(50);
  });
});
