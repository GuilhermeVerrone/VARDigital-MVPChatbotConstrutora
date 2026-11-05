import { isDeepStrictEqual } from 'node:util';
import { parseSalesCondition, type SalesCondition } from '@mvp/simulation';
import type { Db, DbTx } from '../client';
import { addDays, dateFromIso, isoFromDate } from '../convert';
import type { Prisma } from '../generated/prisma/client';
import type { ParameterChange } from '../parameters/changes';

// Repositório de condições comerciais com vigência (V2, discovery §2). Mesmo desenho dos parâmetros
// financeiros (parameters/repository.ts), com uma linha do tempo POR empreendimento:
//   - cada versão vale em [validFrom, validTo] (datas inclusivas, validTo nulo = sem fim);
//   - publicar a partir de F encerra a vigente em F − 1 (ou a marca como substituída, se começava em F);
//   - versão nunca é editada nem apagada (trigger no banco) e toda publicação grava auditoria;
//   - a simulação grava o id da versão que usou.

export const SALES_CONDITION_ENTITY = 'SalesCondition';

type Row = Prisma.SalesConditionGetPayload<object>;
type Reader = Db | DbTx;

export interface StoredSalesCondition {
  id: string;
  developmentId: string;
  version: string;
  validFrom: string;
  validTo: string | null;
  supersededById: string | null;
  basedOnId: string | null;
  createdBy: string;
  createdAt: Date;
  note: string | null;
  /** Condição no formato do motor, já validada pelo schema do motor. */
  condition: SalesCondition;
}

export class NoSalesConditionInForceError extends Error {
  constructor(readonly developmentId: string, readonly date: string) {
    super(`nenhuma condição comercial vigente em ${date} para o empreendimento ${developmentId}`);
    this.name = 'NoSalesConditionInForceError';
  }
}

export class IllustrativeSalesConditionRejectedError extends Error {
  constructor(readonly version: string) {
    super(`condição ${version} é ILUSTRATIVO e não pode ser usada com lead real (valide com a construtora)`);
    this.name = 'IllustrativeSalesConditionRejectedError';
  }
}

export class SalesConditionTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesConditionTimelineError';
  }
}

// ---------------------------------------------------------------------------
// Banco ⇄ motor
// ---------------------------------------------------------------------------

/** Parte da condição que vai para a coluna `rules` (o resto tem coluna própria). */
function rulesOf(condition: SalesCondition): Prisma.InputJsonValue {
  const rules: Record<string, unknown> = { ...condition };
  for (const column of ['version', 'status', 'validFrom', 'validTo']) delete rules[column];
  return rules as Prisma.InputJsonValue;
}

function fromRow(row: Row): StoredSalesCondition {
  const condition = parseSalesCondition({
    ...(row.rules as Record<string, unknown>),
    version: row.version,
    status: row.status,
    validFrom: isoFromDate(row.validFrom),
    validTo: row.validTo ? isoFromDate(row.validTo) : null,
  });
  return {
    id: row.id,
    developmentId: row.developmentId,
    version: row.version,
    validFrom: condition.validFrom,
    validTo: condition.validTo,
    supersededById: row.supersededById,
    basedOnId: row.basedOnId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    note: row.note,
    condition,
  };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isObj(value)) for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, value);
}

/** Diferenças campo a campo entre duas condições (ignora versão e vigência; inclui o status). */
export function diffSalesConditions(before: SalesCondition | null, after: SalesCondition): ParameterChange[] {
  const leaves = (c: SalesCondition | null) => {
    const out = new Map<string, unknown>();
    if (c) flatten({ status: c.status, ...(rulesOf(c) as Record<string, unknown>) }, '', out);
    return out;
  };
  const a = leaves(before);
  const b = leaves(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .filter((p) => !isDeepStrictEqual(a.get(p), b.get(p)))
    .map((p) => ({ path: p, before: a.has(p) ? a.get(p) : null, after: b.has(p) ? b.get(p) : null }));
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Condição vigente do empreendimento na data (ignora as substituídas), ou null. */
export async function findSalesConditionInForce(db: Reader, developmentId: string, date: string): Promise<StoredSalesCondition | null> {
  const day = dateFromIso(date);
  const rows = await db.salesCondition.findMany({
    where: { developmentId, supersededById: null, validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gte: day } }] },
  });
  if (rows.length > 1) throw new SalesConditionTimelineError(`mais de uma condição vigente em ${date}: ${rows.map((r) => r.version).join(', ')}`);
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface LoadSalesConditionOptions {
  /** true em produção: recusa condições ILUSTRATIVO (não validadas pela construtora). */
  rejectIllustrative?: boolean;
}

/** Condição vigente na data, já validada; erro se não houver (o motor nunca roda sem condição). */
export async function getSalesConditionInForce(
  db: Reader,
  developmentId: string,
  date: string,
  opts: LoadSalesConditionOptions = {},
): Promise<StoredSalesCondition> {
  const found = await findSalesConditionInForce(db, developmentId, date);
  if (!found) throw new NoSalesConditionInForceError(developmentId, date);
  if (opts.rejectIllustrative && found.condition.status === 'ILUSTRATIVO') throw new IllustrativeSalesConditionRejectedError(found.version);
  return found;
}

export async function getSalesConditionByVersion(db: Reader, version: string): Promise<StoredSalesCondition | null> {
  const row = await db.salesCondition.findUnique({ where: { version } });
  return row ? fromRow(row) : null;
}

/** Versões (inclusive substituídas), da mais antiga para a mais nova; de um empreendimento ou de todos. */
export async function listSalesConditions(db: Reader, developmentId?: string): Promise<StoredSalesCondition[]> {
  const rows = await db.salesCondition.findMany({
    ...(developmentId ? { where: { developmentId } } : {}),
    orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(fromRow);
}

export async function listSalesConditionAudit(db: Reader, developmentId?: string) {
  const ids = developmentId ? (await db.salesCondition.findMany({ where: { developmentId }, select: { id: true } })).map((r) => r.id) : null;
  return db.auditLog.findMany({
    where: { entity: SALES_CONDITION_ENTITY, ...(ids ? { entityId: { in: ids } } : {}) },
    orderBy: { id: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// Publicação (única forma de alterar condições)
// ---------------------------------------------------------------------------

export interface PublishSalesConditionOptions {
  developmentId: string;
  /** Condição completa no formato do motor (version e validFrom são sobrescritos aqui). */
  condition: unknown;
  version: string;
  validFrom: string;
  /** Quem alterou (id do usuário do painel, ou nome na CLI/seed): obrigatório para auditoria. */
  actor: string;
  /** Motivo da alteração: obrigatório para auditoria. */
  reason: string;
  /** Data de hoje ('AAAA-MM-DD'), injetada para teste; vigência no passado exige allowRetroactive. */
  today: string;
  allowRetroactive?: boolean;
  /** Ação gravada na auditoria. */
  action?: string;
  /** Só valida e calcula o que mudaria; não grava nada. */
  dryRun?: boolean;
  /** Falha se a condição vigente em validFrom não for esta (alteração concorrente). */
  expectedPreviousVersion?: string;
}

export interface PublishSalesConditionResult {
  created: StoredSalesCondition;
  previous: StoredSalesCondition | null;
  /** FIRST: primeira versão; CLOSED_PREVIOUS: anterior termina na véspera; SUPERSEDED: anterior (mesma data) substituída. */
  mode: 'FIRST' | 'CLOSED_PREVIOUS' | 'SUPERSEDED';
  changes: ParameterChange[];
  dryRun: boolean;
}

class DryRunRollback extends Error {
  constructor(readonly result: PublishSalesConditionResult) {
    super('dry-run');
  }
}

/**
 * Publica uma nova versão da condição comercial do empreendimento a partir de `validFrom`, ajusta a
 * vigência da anterior e grava auditoria (antes/depois), tudo numa transação serializada por lock.
 */
export async function publishSalesCondition(db: Db, opts: PublishSalesConditionOptions): Promise<PublishSalesConditionResult> {
  if (!opts.actor.trim()) throw new SalesConditionTimelineError('informe quem está alterando');
  if (!opts.reason.trim()) throw new SalesConditionTimelineError('informe o motivo da alteração');
  dateFromIso(opts.validFrom);
  dateFromIso(opts.today);
  if (opts.validFrom < opts.today && !opts.allowRetroactive) {
    throw new SalesConditionTimelineError(
      `vigência retroativa (${opts.validFrom} < hoje ${opts.today}) muda o resultado de datas passadas; só com allowRetroactive`,
    );
  }
  const raw = opts.condition as Record<string, unknown>;
  if (raw && typeof raw === 'object' && raw.validTo !== undefined && raw.validTo !== null) {
    throw new SalesConditionTimelineError('validTo é controlado pela linha do tempo (a próxima versão encerra esta); deixe null');
  }

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'sales_conditions:' + opts.developmentId}))`;
      await tx.development.findUniqueOrThrow({ where: { id: opts.developmentId }, select: { id: true } });

      const future = await tx.salesCondition.findFirst({
        where: { developmentId: opts.developmentId, supersededById: null, validFrom: { gt: dateFromIso(opts.validFrom) } },
        orderBy: { validFrom: 'asc' },
      });
      if (future) {
        throw new SalesConditionTimelineError(
          `já existe a versão ${future.version} a partir de ${isoFromDate(future.validFrom)}; publique a partir dessa data ou depois`,
        );
      }
      if (await tx.salesCondition.findUnique({ where: { version: opts.version } })) {
        throw new SalesConditionTimelineError(`versão "${opts.version}" já existe`);
      }

      const previous = await findSalesConditionInForce(tx, opts.developmentId, opts.validFrom);
      if (opts.expectedPreviousVersion !== undefined && previous?.version !== opts.expectedPreviousVersion) {
        throw new SalesConditionTimelineError(
          `a condição vigente mudou durante a alteração (esperada ${opts.expectedPreviousVersion}, encontrada ${previous?.version ?? 'nenhuma'}); repita a operação`,
        );
      }
      const mode: PublishSalesConditionResult['mode'] = !previous ? 'FIRST' : previous.validFrom === opts.validFrom ? 'SUPERSEDED' : 'CLOSED_PREVIOUS';
      const validTo = previous?.validTo ?? null;
      const condition = parseSalesCondition({ ...raw, version: opts.version, validFrom: opts.validFrom, validTo });
      const changes = diffSalesConditions(previous?.condition ?? null, condition);
      if (previous && changes.length === 0) {
        throw new SalesConditionTimelineError(`nada mudou em relação à condição vigente ${previous.version}`);
      }

      if (mode === 'CLOSED_PREVIOUS') {
        await tx.salesCondition.update({ where: { id: previous!.id }, data: { validTo: dateFromIso(addDays(opts.validFrom, -1)) } });
      }
      const created = await tx.salesCondition.create({
        data: {
          developmentId: opts.developmentId,
          version: condition.version,
          status: condition.status,
          validFrom: dateFromIso(condition.validFrom),
          validTo: condition.validTo ? dateFromIso(condition.validTo) : null,
          rules: rulesOf(condition),
          basedOnId: previous?.id ?? null,
          createdBy: opts.actor,
          note: opts.reason,
        },
      });
      if (mode === 'SUPERSEDED') {
        await tx.salesCondition.update({ where: { id: previous!.id }, data: { supersededById: created.id } });
      }

      // O que foi gravado tem de ser exatamente o que foi pedido.
      const stored = fromRow(created);
      if (!isDeepStrictEqual(stored.condition, condition)) {
        throw new SalesConditionTimelineError('a condição gravada difere da pedida (perda de precisão no JSON)');
      }

      const values = (side: 'before' | 'after') => Object.fromEntries(changes.map((c) => [c.path, c[side]]));
      await tx.auditLog.create({
        data: {
          actor: opts.actor,
          entity: SALES_CONDITION_ENTITY,
          entityId: created.id,
          action: opts.action ?? 'SALES_CONDITION_PUBLISHED',
          reason: opts.reason,
          before: previous ? ({ version: previous.version, values: values('before') } as Prisma.InputJsonValue) : undefined,
          after: {
            developmentId: opts.developmentId,
            version: condition.version,
            status: condition.status,
            validFrom: condition.validFrom,
            validTo: condition.validTo,
            ...(previous ? { values: values('after') } : { rules: rulesOf(condition) }),
          } as Prisma.InputJsonValue,
        },
      });
      if (previous) {
        await tx.auditLog.create({
          data: {
            actor: opts.actor,
            entity: SALES_CONDITION_ENTITY,
            entityId: previous.id,
            action: mode === 'SUPERSEDED' ? 'SALES_CONDITION_SUPERSEDED' : 'SALES_CONDITION_CLOSED',
            reason: opts.reason,
            before: { version: previous.version, validTo: previous.validTo },
            after:
              mode === 'SUPERSEDED'
                ? { version: previous.version, supersededBy: condition.version }
                : { version: previous.version, validTo: addDays(opts.validFrom, -1) },
          },
        });
      }

      const result: PublishSalesConditionResult = {
        created: stored,
        previous: previous ? (await getSalesConditionByVersion(tx, previous.version))! : null,
        mode,
        changes,
        dryRun: Boolean(opts.dryRun),
      };
      if (opts.dryRun) throw new DryRunRollback(result);
      return result;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.result;
    throw err;
  }
}
