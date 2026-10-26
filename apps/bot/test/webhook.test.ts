import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signWaAkgPayload } from '@mvp/channel';
import type { DependencyChecks } from '../src/deps';
import { buildServer } from '../src/server';
import { WA_AKG_WEBHOOK_PATH } from '../src/routes/wa-akg-webhook';

const secret = 'a-very-long-test-secret';
const okDeps: DependencyChecks = {
  postgres: async () => ({ ok: true, latencyMs: 1 }),
  ollama: async () => ({ ok: true, latencyMs: 1 }),
};

const testPayload = JSON.stringify({
  event: 'test',
  sessionId: 'test',
  timestamp: '2026-10-26T12:00:00.000Z',
  data: { message: 'This is a test webhook from WA-AKG', timestamp: '2026-10-26T12:00:00.000Z' },
});

let app: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function post(body: string, signature?: string) {
  app ??= buildServer({ webhookSecret: secret, deps: okDeps });
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
    expect(res.json()).toEqual({ received: true });
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
    app = buildServer({ webhookSecret: secret, deps: okDeps, captureDir: dir });
    const body = JSON.stringify({
      event: 'message.received',
      sessionId: 'piloto',
      timestamp: '2026-10-26T12:00:00.000Z',
      data: { key: { id: 'ABC', fromMe: false, remoteJid: '5511987654321@s.whatsapp.net' }, from: '5511987654321@s.whatsapp.net', type: 'text', content: 'oi', isGroup: false },
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
    app = buildServer({ webhookSecret: secret, deps: okDeps });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/deps retorna 503 se alguma dependência falhar', async () => {
    app = buildServer({
      webhookSecret: secret,
      deps: { ...okDeps, ollama: async () => ({ ok: false, latencyMs: 3000, detail: 'timeout' }) },
    });
    const res = await app.inject({ method: 'GET', url: '/health/deps' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', postgres: { ok: true }, ollama: { ok: false } });
  });

  it('outras rotas continuam aceitando JSON normal (parser bruto é só do webhook)', async () => {
    app = buildServer({ webhookSecret: secret, deps: okDeps });
    app.post('/echo', async (req) => req.body);
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } });
    expect(res.json()).toEqual({ a: 1 });
  });
});
