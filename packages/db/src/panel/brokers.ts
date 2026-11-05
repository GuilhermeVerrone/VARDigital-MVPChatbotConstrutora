import { z } from 'zod';
import type { Db } from '../client';
import { Prisma } from '../generated/prisma/client';
import { changedFields, recordAudit } from './audit';
import { PanelNotFoundError, PanelValidationError, requireActor } from './errors';

export const BROKER_ENTITY = 'Broker';

export const brokerFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  /** Aceita máscara; guarda só os dígitos (E.164 sem "+"): 55 + DDD + número. */
  phone: z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^55\d{10,11}$/, 'Informe o WhatsApp com DDD (ex.: 5541999990000)')),
  email: z.string().trim().transform((v) => v || null).pipe(z.string().email('E-mail inválido').nullable()),
  team: z.string().trim().transform((v) => v || null),
  active: z.boolean(),
});
export type BrokerForm = z.infer<typeof brokerFormSchema>;

export async function listAdminBrokers(db: Db) {
  const rows = await db.broker.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { leads: true } } } });
  return rows.map((b) => ({ id: b.id, name: b.name, phone: b.phone, email: b.email, team: b.team, active: b.active, leads: b._count.leads }));
}

const snapshot = (b: { name: string; phone: string; email: string | null; team: string | null; active: boolean }) => ({
  name: b.name, phone: b.phone, email: b.email, team: b.team, active: b.active,
});

function parse(raw: unknown): BrokerForm {
  const r = brokerFormSchema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[String(issue.path[0] ?? '_')] ??= issue.message;
  throw new PanelValidationError(fields);
}

export async function saveBroker(db: Db, args: { actor: string; id?: string; data: unknown }) {
  requireActor(args.actor);
  const data = parse(args.data);
  try {
    return await db.$transaction(async (tx) => {
      if (!args.id) {
        const created = await tx.broker.create({ data });
        await recordAudit(tx, { actor: args.actor, entity: BROKER_ENTITY, entityId: created.id, action: 'BROKER_CREATED', after: snapshot(created) });
        return created;
      }
      const current = await tx.broker.findUnique({ where: { id: args.id } });
      if (!current) throw new PanelNotFoundError('corretor');
      const diff = changedFields(snapshot(current), snapshot(data));
      if (!diff.changed) return current;
      const updated = await tx.broker.update({ where: { id: args.id }, data });
      const onlyActive = Object.keys(diff.after).length === 1 && 'active' in diff.after;
      await recordAudit(tx, {
        actor: args.actor, entity: BROKER_ENTITY, entityId: args.id,
        action: onlyActive ? (data.active ? 'BROKER_ACTIVATED' : 'BROKER_DEACTIVATED') : 'BROKER_UPDATED',
        before: diff.before, after: diff.after,
      });
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new PanelValidationError({ phone: 'Já existe um corretor com este telefone' });
    throw err;
  }
}
