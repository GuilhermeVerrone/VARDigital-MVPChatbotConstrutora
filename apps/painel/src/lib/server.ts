import 'server-only';
import { createDb, type Db } from '@mvp/db/panel';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, userForToken } from './auth';
import type { FormState } from './form-state';
import { can, ForbiddenError, type PanelUser, type Permission } from './permissions';
import type { ServiceCtx } from './services';
import { PanelValidationError } from '@mvp/db/panel';

// Cola do servidor: banco, sessão por cookie e guardas de página e de ação.

const globalForDb = globalThis as unknown as { __painelDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__painelDb) {
    const url = process.env.PANEL_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('defina PANEL_DATABASE_URL');
    globalForDb.__painelDb = createDb(url);
  }
  return globalForDb.__painelDb;
}

export const secureCookies = () => process.env.NODE_ENV === 'production' && process.env.PANEL_INSECURE_COOKIES !== 'true';

export async function getUser(): Promise<PanelUser | null> {
  return userForToken(getDb(), (await cookies()).get(SESSION_COOKIE)?.value);
}

/** Guarda de página: sem sessão → login; sem permissão → tela de acesso negado. */
export async function requirePage(permission: Permission): Promise<{ user: PanelUser; ctx: ServiceCtx }> {
  const user = await getUser();
  if (!user) redirect('/login');
  if (!can(user.role, permission)) redirect('/acesso-negado');
  return { user, ctx: { db: getDb(), user } };
}

/** Guarda de Server Action. A permissão fina é conferida de novo pelo serviço. */
export async function requireAction(): Promise<{ user: PanelUser; ctx: ServiceCtx }> {
  const user = await getUser();
  if (!user) redirect('/login');
  return { user, ctx: { db: getDb(), user } };
}

/** Converte erros esperados em estado de formulário; o resto sobe (500). */
export function toFormState(err: unknown): FormState {
  if (err instanceof PanelValidationError) {
    const { _: general, ...fields } = err.fields;
    return { fields, error: general ?? 'Corrija os campos destacados.' };
  }
  if (err instanceof ForbiddenError) return { error: 'Você não tem permissão para esta ação.' };
  throw err;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  // Só confia no cabeçalho do proxy quando a implantação diz que há um (como no site).
  if (process.env.PANEL_TRUST_PROXY === 'true') return h.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  return 'direct';
}
