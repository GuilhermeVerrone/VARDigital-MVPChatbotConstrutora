import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signWaAkgPayload } from '@mvp/channel';
import type { DependencyChecks } from '../src/deps';
import type { InboxWriter } from '../src/inbox';
import { buildServer } from '../src/server';
import { WA_AKG_WEBHOOK_PATH } from '../src/routes/wa-akg-webhook';

import { createPhoneAllowlist } from '@mvp/channel';
const allowlist = createPhoneAllowlist(['5511987654321']);
const secret = 'a-very-long-test-secret';
const okDeps: DependencyChecks = {
  postgres: async () => ({ ok: true, latencyMs: 1 }),
  llm: async () => ({ ok: true, latencyMs: 1 }),
};

const testPayload = JSON.stringify({
  event: 'test',
  sessionId: 'test',
  timestamp: '2026-10-26T12:00:00.000Z',
  data: { message: 'This is a test webhook from WA-AKG', timestamp: '2026-10-26T12:00:00.000Z' },
});

const inbox: InboxWriter = { enqueue: async () => true };
const base = { webhookSecret: secret, inbox, sessionId: 'piloto', allowlist, deps: okDeps };

let app: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function post(body: string, signature?: string) {
  app ??= buildServer(base);
  return app.inject({
    method: 'POST',
    url: WA_AKG_WEBHOOK_PATH,
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-webhook-signature': signature } : {}) },
    payload: body,
  });
}

describe('POST /webhooks/wa-akg', () => {
  it('aceita o webhook de teste do WA-AKG com assinatura válida', async () => {
    const res = await post(testPayload, signWaAkgPayload(testPayload, secret));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true, ignored: 'not_message_event' });
  });

  it('rejeita sem assinatura', async () => {
    expect((await post(testPayload)).statusCode).toBe(401);
  });

  it('rejeita assinatura com outro secret', async () => {
    expect((await post(testPayload, signWaAkgPayload(testPayload, 'wrong-secret-xxxxxx'))).statusCode).toBe(401);
  });

  it('rejeita corpo adulterado', async () => {
    const sig = signWaAkgPayload(testPayload, secret);
    expect((await post(testPayload.replace('"test"', '"message.received"'), sig)).statusCode).toBe(401);
  });

  it('valida assinatura antes de interpretar o JSON (corpo inválido sem assinatura → 401)', async () => {
    expect((await post('{not json', 'sha256=' + '0'.repeat(64))).statusCode).toBe(401);
  });

  it('retorna 400 para JSON inválido com assinatura válida', async () => {
    const body = '{not json';
    expect((await post(body, signWaAkgPayload(body, secret))).statusCode).toBe(400);
  });

  it('retorna 400 para envelope sem campo event', async () => {
    const body = JSON.stringify({ sessionId: 's', timestamp: 't', data: {} });
    expect((await post(body, signWaAkgPayload(body, secret))).statusCode).toBe(400);
  });

  it('aceita message.received e grava captura bruta quando habilitada', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'capture-'));
    app = buildServer({ ...base, captureDir: dir });
    const body = JSON.stringify({
      event: 'message.received',
      sessionId: 'piloto',
      timestamp: '2026-10-26T12:00:00.000Z',
      data: { key: { id: 'ABC', fromMe: false, remoteJid: '5511987654321@s.whatsapp.net' }, from: '5511987654321@s.whatsapp.net', type: 'TEXT', content: 'oi', isGroup: false },
    });
    const res = await post(body, signWaAkgPayload(body, secret));
    expect(res.statusCode).toBe(200);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(await readFile(path.join(dir, files[0]!), 'utf8')).toBe(body);
  });
});

describe('health', () => {
  it('GET /health', async () => {
    app = buildServer(base);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/deps: banco fora é 503; LLM fora é 200 degradado (o bot segue só com os parsers)', async () => {
    app = buildServer({
      ...base,
      deps: { ...okDeps, postgres: async () => ({ ok: false, latencyMs: 3000, detail: 'timeout' }) },
    });
    const down = await app.inject({ method: 'GET', url: '/health/deps' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ status: 'degraded', postgres: { ok: false }, llm: { ok: true } });
    await app.close();

    app = buildServer({
      ...base,
      deps: { ...okDeps, llm: async () => ({ ok: false, latencyMs: 0, detail: 'ANTHROPIC_API_KEY ausente: só parsers' }) },
    });
    const degraded = await app.inject({ method: 'GET', url: '/health/deps' });
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json()).toMatchObject({ status: 'degraded', postgres: { ok: true }, llm: { ok: false, detail: expect.stringContaining('só parsers') } });
  });

  it('outras rotas continuam aceitando JSON normal (parser bruto é só do webhook)', async () => {
    app = buildServer(base);
    app.post('/echo', async (req) => req.body);
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } });
    expect(res.json()).toEqual({ a: 1 });
  });
});
