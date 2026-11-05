import { findSessionUser, login, logout, recordAudit, type Db } from '@mvp/db/panel';
import { createRateLimiter } from './rate-limit';
import type { PanelUser, Role } from './permissions';

// Autenticação do painel sobre as funções do banco (argon2, sessão por token com hash, bloqueio).

export const SESSION_COOKIE = 'painel_session';

const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });

export type SignInOutcome =
  | { ok: true; token: string; expiresAt: Date; user: PanelUser }
  | { ok: false; message: string };

const MESSAGES = {
  INVALID: 'E-mail ou senha incorretos.',
  LOCKED: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  INACTIVE: 'Este acesso está desativado. Fale com o administrador.',
  RATE: 'Muitas tentativas deste endereço. Aguarde alguns minutos.',
} as const;

export function toPanelUser(u: { id: string; name: string; role: string; brokerId: string | null }): PanelUser {
  return { id: u.id, name: u.name, role: u.role as Role, brokerId: u.brokerId };
}

export async function signIn(db: Db, a: { email: string; password: string; ip?: string; userAgent?: string; now?: Date }): Promise<SignInOutcome> {
  if (a.ip && !ipLimiter.hit(a.ip)) return { ok: false, message: MESSAGES.RATE };
  const now = a.now ?? new Date();
  const res = await login(db, { email: a.email, password: a.password, now, ...(a.ip ? { ip: a.ip } : {}), ...(a.userAgent ? { userAgent: a.userAgent } : {}) });
  if (!res.ok) return { ok: false, message: MESSAGES[res.reason] };
  await recordAudit(db, { actor: res.user.id, entity: 'User', entityId: res.user.id, action: 'USER_LOGIN' });
  return { ok: true, token: res.token, expiresAt: res.expiresAt, user: toPanelUser(res.user) };
}

export async function userForToken(db: Db, token: string | undefined, now = new Date()): Promise<PanelUser | null> {
  if (!token) return null;
  const user = await findSessionUser(db, token, now);
  return user ? toPanelUser(user) : null;
}

export async function signOut(db: Db, token: string | undefined, userId?: string): Promise<void> {
  if (!token) return;
  await logout(db, token);
  if (userId) await recordAudit(db, { actor: userId, entity: 'User', entityId: userId, action: 'USER_LOGOUT' });
}
