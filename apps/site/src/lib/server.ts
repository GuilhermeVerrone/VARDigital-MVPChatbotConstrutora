import 'server-only';
import { randomBytes } from 'node:crypto';
import { createDb, type Db } from '@mvp/db/site';
import { createRateLimiter } from './rate-limit';

// Estado do processo do servidor: conexão com o banco, chave do formulário e limitadores.
// Variáveis (nenhuma tem prefixo NEXT_PUBLIC_, então nada disso chega ao navegador):
//   SITE_DATABASE_URL      conexão com o Postgres do bot
//   SITE_FORM_SECRET       chave que assina o tempo de preenchimento (obrigatória em produção)
//   SITE_WHATSAPP_NUMBER   número do bot em E.164 só com dígitos, para o botão wa.me
//   SITE_TRUST_PROXY       "true" quando há proxy reverso confiável (usa X-Forwarded-For)

const g = globalThis as unknown as { __siteDb?: Db; __siteSecret?: string };

export function getDb(): Db {
  const url = process.env.SITE_DATABASE_URL;
  if (!url) throw new Error('SITE_DATABASE_URL não definida');
  return (g.__siteDb ??= createDb(url));
}

export function formSecret(): string {
  const env = process.env.SITE_FORM_SECRET;
  if (env && env.length >= 16) return env;
  if (process.env.NODE_ENV === 'production') throw new Error('SITE_FORM_SECRET (mín. 16 caracteres) é obrigatória em produção');
  // Desenvolvimento: chave aleatória por processo (formulários abertos antes de um reinício expiram).
  return (g.__siteSecret ??= randomBytes(24).toString('hex'));
}

export function whatsappNumber(): string | null {
  const n = (process.env.SITE_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  return n.length >= 12 ? n : null;
}

export const limiters = ((globalThis as unknown as { __siteLimiters?: { ip: ReturnType<typeof createRateLimiter>; phone: ReturnType<typeof createRateLimiter> } }).__siteLimiters ??= {
  ip: createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 }),
  phone: createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 }),
});

export function clientIp(headers: Headers): string {
  if (process.env.SITE_TRUST_PROXY === 'true') {
    const fwd = headers.get('x-forwarded-for');
    // O último item é o que o nosso proxy anexou; os anteriores o cliente pode forjar.
    if (fwd) return fwd.split(',').at(-1)!.trim();
    const real = headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'unknown';
}
