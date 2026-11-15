import { z } from 'zod';
import type { Db } from '../client';
import { Prisma } from '../generated/prisma/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../users';
import { changedFields, recordAudit } from './audit';
import { PanelNotFoundError, PanelValidationError, requireActor } from './errors';

// Gestão dos usuários do painel (só o admin): criar, mudar papel e vínculo com o corretor, desativar e
// redefinir a senha. A senha nunca vai para a auditoria; redefinir desbloqueia a conta e derruba as sessões.

export const USER_ENTITY = 'User';

const ROLES = ['ADMIN', 'GERENTE', 'CORRETOR'] as const;

export const panelUserFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  email: z.string().trim().toLowerCase().pipe(z.string().email('E-mail inválido')),
  role: z.enum(ROLES, { message: 'Escolha o papel' }),
  brokerId: z.string().trim().transform((v) => v || null),
  active: z.boolean(),
  /** Vazio na edição = manter a senha atual. */
  password: z.string().transform((v) => v || null)
    .pipe(z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`).nullable()),
});
export type PanelUserForm = z.infer<typeof panelUserFormSchema>;

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: (typeof ROLES)[number];
  brokerId: string | null;
  brokerName: string | null;
  active: boolean;
  lockedUntil: Date | null;
}

export async function listAdminUsers(db: Db): Promise<AdminUserRow[]> {
  const rows = await db.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { broker: { select: { name: true } } } });
  return rows.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, brokerId: u.brokerId, brokerName: u.broker?.name ?? null, active: u.active, lockedUntil: u.lockedUntil,
  }));
}

const snapshot = (u: { name: string; email: string; role: string; brokerId: string | null; active: boolean }) => ({
  name: u.name, email: u.email, role: u.role, brokerId: u.brokerId, active: u.active,
});

function parse(raw: unknown): PanelUserForm {
  const r = panelUserFormSchema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[String(issue.path[0] ?? '_')] ??= issue.message;
    throw new PanelValidationError(fields);
  }
  const data = r.data;
  if (data.role === 'CORRETOR' && !data.brokerId) throw new PanelValidationError({ brokerId: 'Usuário corretor precisa de um corretor vinculado' });
  // Só o corretor tem vínculo: gestão e admin veem todos os leads.
  return data.role === 'CORRETOR' ? data : { ...data, brokerId: null };
}

/**
 * Cria (sem `id`) ou altera um usuário do painel. A senha é obrigatória na criação; na edição, se vier,
 * redefine (desbloqueia e encerra as sessões). Quem altera não muda o próprio papel nem se desativa, e o
 * painel sempre fica com ao menos um admin ativo.
 */
export async function savePanelUser(db: Db, args: { actor: string; id?: string; data: unknown }) {
  requireActor(args.actor);
  const data = parse(args.data);
  if (!args.id && !data.password) throw new PanelValidationError({ password: 'Defina a senha inicial' });
  // argon2 é lento (≈ 19 MiB, 2 passes): fora da transação.
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  const fields = { name: data.name, email: data.email, role: data.role, brokerId: data.brokerId, active: data.active };

  try {
    return await db.$transaction(async (tx) => {
      if (await tx.user.findFirst({ where: { email: data.email, ...(args.id ? { id: { not: args.id } } : {}) }, select: { id: true } })) {
        throw new PanelValidationError({ email: 'Já existe um usuário com este e-mail' });
      }
      if (data.brokerId) {
        if (!(await tx.broker.findUnique({ where: { id: data.brokerId }, select: { id: true } }))) throw new PanelValidationError({ brokerId: 'Corretor não encontrado' });
        if (await tx.user.findFirst({ where: { brokerId: data.brokerId, ...(args.id ? { id: { not: args.id } } : {}) }, select: { id: true } })) {
          throw new PanelValidationError({ brokerId: 'Este corretor já tem um usuário' });
        }
      }

      if (!args.id) {
        const created = await tx.user.create({ data: { ...fields, passwordHash: passwordHash! } });
        await recordAudit(tx, { actor: args.actor, entity: USER_ENTITY, entityId: created.id, action: 'USER_CREATED', after: snapshot(created) });
        return created;
      }

      const current = await tx.user.findUnique({ where: { id: args.id } });
      if (!current) throw new PanelNotFoundError('usuário');
      if (current.id === args.actor) {
        if (data.role !== current.role) throw new PanelValidationError({ role: 'Você não pode mudar o seu próprio papel' });
        if (!data.active) throw new PanelValidationError({ active: 'Você não pode desativar o seu próprio acesso' });
        if (passwordHash) throw new PanelValidationError({ password: 'Troque a sua senha em Minha conta' });
      }
      const losesAdmin = current.role === 'ADMIN' && current.active && (data.role !== 'ADMIN' || !data.active);
      if (losesAdmin && (await tx.user.count({ where: { role: 'ADMIN', active: true, id: { not: current.id } } })) === 0) {
        throw new PanelValidationError({ _: 'O painel precisa de pelo menos um administrador ativo' });
      }

      const diff = changedFields(snapshot(current), snapshot(fields));
      const updated = await tx.user.update({
        where: { id: current.id },
        // Senha redefinida pelo admin volta a ser provisória: o painel pede a troca ao usuário.
        data: { ...fields, ...(passwordHash ? { passwordHash, passwordChangedAt: null, failedLogins: 0, lockedUntil: null } : {}) },
      });
      if (diff.changed) {
        const onlyActive = Object.keys(diff.after).length === 1 && 'active' in diff.after;
        await recordAudit(tx, {
          actor: args.actor, entity: USER_ENTITY, entityId: current.id,
          action: onlyActive ? (data.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED') : 'USER_UPDATED',
          before: diff.before, after: diff.after,
        });
      }
      if (passwordHash) await recordAudit(tx, { actor: args.actor, entity: USER_ENTITY, entityId: current.id, action: 'USER_PASSWORD_RESET' });
      // Desativar, mudar papel ou redefinir a senha vale já: encerra as sessões abertas do usuário.
      if (passwordHash || !data.active || data.role !== current.role || data.brokerId !== current.brokerId) {
        await tx.userSession.deleteMany({ where: { userId: current.id } });
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new PanelValidationError({ email: 'Já existe um usuário com este e-mail ou corretor' });
    throw err;
  }
}
