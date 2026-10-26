import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/**
 * Assinatura que o WA-AKG envia em `X-Webhook-Signature`:
 * `sha256=<hex do HMAC-SHA256 do corpo bruto com o secret do webhook>`.
 */
export function signWaAkgPayload(rawBody: string | Buffer, secret: string): string {
  return PREFIX + createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Valida a assinatura sobre o corpo BRUTO (antes de qualquer JSON.parse).
 * Comparação em tempo constante; header ausente/malformado retorna false.
 */
export function verifyWaAkgSignature(
  rawBody: string | Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string,
): boolean {
  if (!secret) throw new Error('webhook secret is empty');
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith(PREFIX)) return false;

  const received = signatureHeader.slice(PREFIX.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;

  const expected = signWaAkgPayload(rawBody, secret).slice(PREFIX.length);
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}
