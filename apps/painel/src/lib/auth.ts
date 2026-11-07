import { changeOwnPassword, findSessionUser, login, logout, MIN_PASSWORD_LENGTH, recordAudit, type Db } from '@mvp/db/panel';
import { createRateLimiter } from './rate-limit';
import type { PanelUser, Role } from './permissions';

// Autenticação do painel sobre as funções do banco (argon2, sessão por token com hash, bloqueio).

export const SESSION_COOKIE = 'painel_session';

const ipLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });
/** Tentativas de troca de senha por usuário (quem tem a sessão não pode adivinhar a senha atual à vontade). */
const changeLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });

export type SignInOutcome =
  | { ok: true; token: string; expiresAt: Date; user: PanelUser }
  | { ok: false; message: string };

const MESSAGES = {
  INVALID: 'E-mail ou senha incorretos.',
  LOCKED: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  INACTIVE: 'Este acesso está desativado. Fale com o administrador.',
  RATE: 'Muitas tentativas deste endereço. Aguarde alguns minutos.',
} as const;

export function toPanelUser(u: { id: string; name: string; role: string; brokerId: string | null; passwordChangedAt?: Date | null }): PanelUser {
  return { id: u.id, name: u.name, role: u.role as Role, brokerId: u.brokerId, mustChangePassword: u.passwordChangedAt === null };
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

export type ChangePasswordOutcome = { ok: true } | { ok: false; fields: Record<string, string> };

/** O usuário logado troca a própria senha. As outras sessões dele são encerradas; a atual continua. */
export async function changePassword(
  db: Db,
  a: { user: PanelUser; current: string; next: string; confirm: string; token?: string; now?: Date },
): Promise<ChangePasswordOutcome> {
  if (a.next !== a.confirm) return { ok: false, fields: { confirm: 'A confirmação não bate com a nova senha.' } };
  if (!changeLimiter.hit(a.user.id)) return { ok: false, fields: { current: 'Muitas tentativas. Aguarde alguns minutos.' } };
  const res = await changeOwnPassword(db, { userId: a.user.id, current: a.current, next: a.next, now: a.now ?? new Date(), ...(a.token ? { keepToken: a.token } : {}) });
  if (!res.ok) {
    const messages: Record<typeof res.reason, Record<string, string>> = {
      WRONG_CURRENT: { current: 'Senha atual incorreta.' },
      TOO_SHORT: { next: `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` },
      SAME_AS_CURRENT: { next: 'A nova senha precisa ser diferente da atual.' },
      NOT_FOUND: { current: 'Acesso desativado.' },
    };
    return { ok: false, fields: messages[res.reason] };
  }
  await recordAudit(db, { actor: a.user.id, entity: 'User', entityId: a.user.id, action: 'USER_PASSWORD_CHANGED' });
  return { ok: true };
}
