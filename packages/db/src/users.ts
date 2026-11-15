import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './client';
import type { User, UserRole } from './generated/prisma/client';

// Usuários e sessões do painel (V2, D8): senha com argon2id, sessão por token aleatório de que só o
// hash é guardado, bloqueio após tentativas erradas. O painel (Fase 14) só chama estas funções.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_HOURS = 12;

// O módulo nativo só é carregado quando alguém hasheia ou confere uma senha (painel e seed). O bot importa
// este pacote mas nunca chama estas funções, e o bundle dele (esbuild) deixa o argon2 de fora.
const argon2 = () => import('@node-rs/argon2');

/** Parâmetros recomendados pela OWASP para argon2id (19 MiB, 2 passes). */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export class InvalidPasswordError extends Error {
  constructor() {
    super(`a senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
    this.name = 'InvalidPasswordError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new InvalidPasswordError();
  return (await argon2()).hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await (await argon2()).verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateUserArgs {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  brokerId?: string;
}

export async function createUser(db: Db, a: CreateUserArgs): Promise<User> {
  if (a.role === 'CORRETOR' && !a.brokerId) throw new Error('usuário CORRETOR precisa de brokerId');
  return db.user.create({
    data: {
      name: a.name,
      email: a.email.trim().toLowerCase(),
      passwordHash: await hashPassword(a.password),
      role: a.role,
      brokerId: a.brokerId ?? null,
    },
  });
}

export type LoginResult =
  | { ok: true; user: User; token: string; expiresAt: Date }
  | { ok: false; reason: 'INVALID' | 'LOCKED' | 'INACTIVE' };

export interface LoginArgs {
  email: string;
  password: string;
  now: Date;
  ip?: string;
  userAgent?: string;
}

/**
 * Autentica e abre a sessão. Resposta única para e-mail inexistente e senha errada (INVALID), para não
 * revelar quais e-mails existem. Após MAX_FAILED_LOGINS erros seguidos a conta fica bloqueada.
 */
export async function login(db: Db, a: LoginArgs): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { email: a.email.trim().toLowerCase() } });
  if (!user) {
    // gasta o mesmo tempo de um hash real, para não distinguir e-mail inexistente pelo tempo
    await verifyPassword(DUMMY_HASH ??= await (await argon2()).hash('dummy-password', ARGON2), a.password);
    return { ok: false, reason: 'INVALID' };
  }
  if (user.lockedUntil && user.lockedUntil > a.now) return { ok: false, reason: 'LOCKED' };
  if (!(await verifyPassword(user.passwordHash, a.password))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(a.now.getTime() + LOCK_MINUTES * 60_000) : null },
    });
    return { ok: false, reason: lock ? 'LOCKED' : 'INVALID' };
  }
  if (!user.active) return { ok: false, reason: 'INACTIVE' };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(a.now.getTime() + SESSION_HOURS * 3_600_000);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } }),
    db.userSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt, ip: a.ip ?? null, userAgent: a.userAgent ?? null, lastSeenAt: a.now },
    }),
  ]);
  return { ok: true, user, token, expiresAt };
}

let DUMMY_HASH: string | undefined;

/** Usuário da sessão, ou null se o token não existe, expirou ou o usuário foi desativado. */
export async function findSessionUser(db: Db, token: string, now: Date): Promise<User | null> {
  const session = await db.userSession.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  if (!session || session.expiresAt <= now || !session.user.active) return null;
  return session.user;
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.userSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'WRONG_CURRENT' | 'TOO_SHORT' | 'SAME_AS_CURRENT' | 'NOT_FOUND' };

/**
 * O próprio usuário troca a senha: confere a atual, grava a nova, marca a data da troca e encerra as
 * outras sessões (a do token informado continua aberta).
 */
export async function changeOwnPassword(
  db: Db,
  a: { userId: string; current: string; next: string; now: Date; keepToken?: string },
): Promise<ChangePasswordResult> {
  const user = await db.user.findUnique({ where: { id: a.userId } });
  if (!user || !user.active) return { ok: false, reason: 'NOT_FOUND' };
  if (!(await verifyPassword(user.passwordHash, a.current))) return { ok: false, reason: 'WRONG_CURRENT' };
  if (a.next.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (a.next === a.current) return { ok: false, reason: 'SAME_AS_CURRENT' };
  const passwordHash = await hashPassword(a.next);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: a.now, failedLogins: 0, lockedUntil: null } }),
    db.userSession.deleteMany({ where: { userId: user.id, ...(a.keepToken ? { tokenHash: { not: hashSessionToken(a.keepToken) } } : {}) } }),
  ]);
  return { ok: true };
}

/** Apaga as sessões vencidas. Retorna quantas. */
export async function purgeExpiredSessions(db: Db, now: Date): Promise<number> {
  return (await db.userSession.deleteMany({ where: { expiresAt: { lte: now } } })).count;
}
