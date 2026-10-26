import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWaAkgPayload, verifyWaAkgSignature } from '../src';

const secret = 'test-secret';
// Mesmo formato do payload de teste do WA-AKG (src/lib/webhook.ts → testWebhook).
const body = JSON.stringify({
  event: 'test',
  sessionId: 'test',
  timestamp: '2026-10-26T12:00:00.000Z',
  data: { message: 'This is a test webhook from WA-AKG', timestamp: '2026-10-26T12:00:00.000Z' },
});

describe('verifyWaAkgSignature', () => {
  it('aceita assinatura calculada como o WA-AKG calcula', () => {
    const header = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWaAkgSignature(body, header, secret)).toBe(true);
    expect(verifyWaAkgSignature(Buffer.from(body), header, secret)).toBe(true);
  });

  it('aceita hex em maiúsculas', () => {
    const header = 'sha256=' + signWaAkgPayload(body, secret).slice('sha256='.length).toUpperCase();
    expect(verifyWaAkgSignature(body, header, secret)).toBe(true);
  });

  it('rejeita corpo alterado', () => {
    const header = signWaAkgPayload(body, secret);
    expect(verifyWaAkgSignature(body.replace('test', 'tesT'), header, secret)).toBe(false);
  });

  it('rejeita secret errado', () => {
    expect(verifyWaAkgSignature(body, signWaAkgPayload(body, 'other'), secret)).toBe(false);
  });

  it('rejeita corpo re-serializado (assinatura vale só para o corpo bruto)', () => {
    const header = signWaAkgPayload(body, secret);
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWaAkgSignature(reserialized, header, secret)).toBe(false);
  });

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['sem prefixo', createHmac('sha256', secret).update(body).digest('hex')],
    ['prefixo errado', 'sha1=abc'],
    ['hex curto', 'sha256=abcd'],
    ['não-hex', 'sha256=' + 'z'.repeat(64)],
    ['array', ['sha256=' + 'a'.repeat(64)]],
  ])('rejeita header %s', (_label, header) => {
    expect(verifyWaAkgSignature(body, header as string | string[] | undefined, secret)).toBe(false);
  });

  it('falha alto se o secret estiver vazio (erro de configuração)', () => {
    expect(() => verifyWaAkgSignature(body, signWaAkgPayload(body, 'x'), '')).toThrow();
  });
});
