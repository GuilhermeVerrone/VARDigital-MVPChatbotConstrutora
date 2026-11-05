import { isDeepStrictEqual } from 'node:util';
import type { Db, DbTx } from '../client';
import type { Prisma } from '../generated/prisma/client';

// Auditoria do painel (RF-52): quem (id do usuário), o quê, antes e depois. Só inserção.

type Writer = Db | DbTx;

/** Campos que mudaram entre dois objetos planos (só estes vão para o antes/depois). */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (before === null || !isDeepStrictEqual(before[key], after[key])) {
      if (before !== null) b[key] = before[key] ?? null;
      a[key] = after[key];
    }
  }
  return { before: before === null ? null : b, after: a, changed: Object.keys(a).length > 0 };
}

export async function recordAudit(
  tx: Writer,
  e: { actor: string; entity: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string | null },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actor: e.actor,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: e.reason ?? null,
    },
  });
}

export interface AuditFilter {
  entity?: string;
  action?: string;
  /** id do usuário (ou "system", "seed"...). */
  actor?: string;
  /** Datas inclusivas 'AAAA-MM-DD' (fuso de São Paulo). */
  from?: string;
  to?: string;
  /** Busca por id da entidade. */
  entityId?: string;
  /** Cursor: devolve só eventos com id menor que este. */
  before?: bigint;
  take?: number;
}

export interface AuditRow {
  id: bigint;
  at: Date;
  actor: string;
  actorName: string;
  entity: string;
  entityId: string | null;
  action: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// America/Sao_Paulo é UTC−3 o ano todo desde 2019.
const startOfDay = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999-03:00`);

/** Nome dos usuários por id (ids que não são de usuário, como "seed" e "bot", voltam como estão). */
export async function resolveActorNames(db: Db, actors: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(actors.filter((a) => UUID.test(a)))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(actors.map((a) => [a, a] as const));
  for (const u of users) names.set(u.id, u.name);
  return names;
}

/** Eventos mais novos primeiro, filtráveis; resolve o id do usuário para o nome. */
export async function listAuditLogs(db: Db, f: AuditFilter = {}): Promise<{ rows: AuditRow[]; next: bigint | null }> {
  const take = Math.min(f.take ?? 50, 200);
  const where: Prisma.AuditLogWhereInput = {
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.actor ? { actor: f.actor } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.before ? { id: { lt: f.before } } : {}),
    ...(f.from || f.to ? { at: { ...(f.from ? { gte: startOfDay(f.from) } : {}), ...(f.to ? { lte: endOfDay(f.to) } : {}) } } : {}),
  };
  const found = await db.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: take + 1 });
  const page = found.slice(0, take);
  const names = await resolveActorNames(db, page.map((r) => r.actor));
  return {
    rows: page.map((r) => ({
      id: r.id, at: r.at, actor: r.actor, actorName: names.get(r.actor) ?? r.actor, entity: r.entity, entityId: r.entityId,
      action: r.action, reason: r.reason, before: r.before, after: r.after,
    })),
    next: found.length > take ? page[page.length - 1]!.id : null,
  };
}

/** Valores distintos para os filtros da tela. */
export async function auditFilterOptions(db: Db): Promise<{ entities: string[]; actions: string[]; actors: { id: string; name: string }[] }> {
  const [entities, actions, actorIds] = await Promise.all([
    db.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    db.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    db.auditLog.findMany({ distinct: ['actor'], select: { actor: true }, orderBy: { actor: 'asc' } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: actorIds.map((a) => a.actor).filter((a) => UUID.test(a)) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    entities: entities.map((e) => e.entity),
    actions: actions.map((a) => a.action),
    actors: actorIds.map((a) => ({ id: a.actor, name: names.get(a.actor) ?? a.actor })),
  };
}
