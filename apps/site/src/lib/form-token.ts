import { createHmac, timingSafeEqual } from 'node:crypto';

// Marca de quando o formulário foi aberto, assinada: o servidor mede o tempo de preenchimento sem
// confiar no cliente (um robô que forja o horário não tem a chave).

const sign = (ts: string, secret: string) => createHmac('sha256', secret).update(`form:${ts}`).digest('hex').slice(0, 32);

export function issueFormToken(secret: string, now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts, secret)}`;
}

export type TokenCheck = 'ok' | 'too-fast' | 'expired' | 'invalid';

export function checkFormToken(token: string, secret: string, opts: { minMs: number; maxMs: number; now?: number }): TokenCheck {
  const [ts, sig] = token.split('.');
  if (!ts || !sig || !/^\d{10,16}$/.test(ts)) return 'invalid';
  const expected = Buffer.from(sign(ts, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return 'invalid';
  const age = (opts.now ?? Date.now()) - Number(ts);
  if (age < opts.minMs) return 'too-fast';
  if (age > opts.maxMs) return 'expired';
  return 'ok';
}
