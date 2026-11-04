import { isDeepStrictEqual } from 'node:util';
import { parseSimulationParameters, type CreditLine, type SimulationParameters } from '@mvp/simulation';
import type { Db, DbTx } from '../client';
import { addDays, dateFromIso, isoFromDate, jsonOrDbNull, num } from '../convert';
import type { Prisma } from '../generated/prisma/client';
import { applyChange, diffParameters, parseCliValue, type ParameterChange } from './changes';

// Repositório de parâmetros financeiros com vigência (spec §7.5, RF-47, RF-52).
//
// Linha do tempo: cada versão vale em [validFrom, validTo] (datas inclusivas). Publicar uma
// versão a partir da data F:
//   - a versão vigente em F passa a terminar em F − 1 (ou é marcada como substituída, se
//     começava exatamente em F);
//   - a nova herda o fim da anterior (normalmente "sem fim").
// Versões nunca são editadas nem apagadas (triggers no banco); o histórico fica completo e
// cada simulação aponta para a versão que usou.

export const PARAMETER_SET_ENTITY = 'ParameterSet';

const withLines = { creditLines: true } as const;
type ParameterSetRow = Prisma.ParameterSetGetPayload<{ include: typeof withLines }>;
type CreditLineRow = ParameterSetRow['creditLines'][number];

export interface StoredParameterSet {
  id: string;
  version: string;
  validFrom: string;
  validTo: string | null;
  supersededById: string | null;
  basedOnId: string | null;
  createdBy: string;
  createdAt: Date;
  note: string | null;
  /** Parâmetros no formato do motor, já validados pelo schema do motor. */
  params: SimulationParameters;
}

export class NoParametersInForceError extends Error {
  constructor(readonly date: string) {
    super(`nenhuma versão de parâmetros vigente em ${date}`);
    this.name = 'NoParametersInForceError';
  }
}

export class IllustrativeParametersRejectedError extends Error {
  constructor(readonly version: string) {
    super(`parâmetros ${version} são ILUSTRATIVO e não podem ser usados com lead real (valide com o financeiro)`);
    this.name = 'IllustrativeParametersRejectedError';
  }
}

export class ParameterTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParameterTimelineError';
  }
}

// ---------------------------------------------------------------------------
// Banco ⇄ motor
// ---------------------------------------------------------------------------

function lineFromRow(row: CreditLineRow): CreditLine {
  return {
    id: row.code,
    name: row.name,
    priority: row.priority,
    eligibility: {
      maxFamilyIncome: num(row.maxFamilyIncome),
      maxPropertyValue: num(row.maxPropertyValue),
      requiresFirstFinancing: row.requiresFirstFinancing,
      requiresNoOwnedProperty: row.requiresNoOwnedProperty,
    },
    maxLtv: num(row.maxLtv),
    annualInterestRate: num(row.annualInterestRate),
    rateConvention: row.rateConvention,
    maxIncomeCommitment: num(row.maxIncomeCommitment),
    termMonths: { min: row.termMinMonths, max: row.termMaxMonths },
    maxAgeAtEndMonths: row.maxAgeAtEndMonths,
    ageRule: row.ageRule,
    systems: row.systems,
    insurance: {
      mipMonthlyRateByAge: row.mipMonthlyRateByAge as CreditLine['insurance']['mipMonthlyRateByAge'],
      dfiMonthlyRate: num(row.dfiMonthlyRate),
    },
    adminFeeMonthly: num(row.adminFeeMonthly),
    otherMonthlyFees: row.otherMonthlyFees as CreditLine['otherMonthlyFees'],
    subsidy: (row.subsidy ?? null) as CreditLine['subsidy'],
    fgts: row.fgts as CreditLine['fgts'],
  };
}

function lineToRow(line: CreditLine): Prisma.CreditLineCreateWithoutParameterSetInput {
  return {
    code: line.id,
    name: line.name,
    priority: line.priority,
    maxFamilyIncome: line.eligibility.maxFamilyIncome,
    maxPropertyValue: line.eligibility.maxPropertyValue,
    requiresFirstFinancing: line.eligibility.requiresFirstFinancing,
    requiresNoOwnedProperty: line.eligibility.requiresNoOwnedProperty,
    maxLtv: line.maxLtv,
    annualInterestRate: line.annualInterestRate,
    rateConvention: line.rateConvention,
    maxIncomeCommitment: line.maxIncomeCommitment,
    termMinMonths: line.termMonths.min,
    termMaxMonths: line.termMonths.max,
    maxAgeAtEndMonths: line.maxAgeAtEndMonths,
    ageRule: line.ageRule,
    systems: line.systems,
    mipMonthlyRateByAge: line.insurance.mipMonthlyRateByAge,
    dfiMonthlyRate: line.insurance.dfiMonthlyRate,
    adminFeeMonthly: line.adminFeeMonthly,
    otherMonthlyFees: line.otherMonthlyFees,
    subsidy: jsonOrDbNull(line.subsidy),
    fgts: line.fgts,
  };
}

function fromRow(row: ParameterSetRow): StoredParameterSet {
  const lines = [...row.creditLines].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  const params = parseSimulationParameters({
    version: row.version,
    status: row.status,
    validFrom: isoFromDate(row.validFrom),
    validTo: row.validTo ? isoFromDate(row.validTo) : null,
    defaultSystem: row.defaultSystem,
    adjustmentToleranceRatio: num(row.adjustmentToleranceRatio),
    desiredInstallmentToleranceRatio: num(row.desiredInstallmentToleranceRatio),
    highCommitmentAlertRatio: num(row.highCommitmentAlertRatio),
    informalIncomeTypes: row.informalIncomeTypes,
    creditLines: lines.map(lineFromRow),
  });
  return {
    id: row.id,
    version: row.version,
    validFrom: params.validFrom,
    validTo: params.validTo,
    supersededById: row.supersededById,
    basedOnId: row.basedOnId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    note: row.note,
    params,
  };
}

/** Ordem canônica para comparar parâmetros (a ordem das linhas não tem significado). */
function canonical(params: SimulationParameters): SimulationParameters {
  return {
    ...params,
    informalIncomeTypes: [...params.informalIncomeTypes].sort(),
    creditLines: [...params.creditLines].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)),
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type Reader = Db | DbTx;

/** Versão vigente na data (ignora versões substituídas), ou null. */
export async function findParametersInForce(db: Reader, date: string): Promise<StoredParameterSet | null> {
  const day = dateFromIso(date);
  const rows = await db.parameterSet.findMany({
    where: {
      supersededById: null,
      validFrom: { lte: day },
      OR: [{ validTo: null }, { validTo: { gte: day } }],
    },
    include: withLines,
  });
  // A restrição de exclusão no banco garante no máximo uma.
  if (rows.length > 1) throw new ParameterTimelineError(`mais de uma versão vigente em ${date}: ${rows.map((r) => r.version).join(', ')}`);
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface LoadParametersOptions {
  /** true em produção: recusa versões ILUSTRATIVO (não validadas pelo financeiro). */
  rejectIllustrative?: boolean;
}

/** Versão vigente na data, já validada; erro se não houver (o motor nunca roda sem tabela vigente). */
export async function getParametersInForce(db: Reader, date: string, opts: LoadParametersOptions = {}): Promise<StoredParameterSet> {
  const found = await findParametersInForce(db, date);
  if (!found) throw new NoParametersInForceError(date);
  if (opts.rejectIllustrative && found.params.status === 'ILUSTRATIVO') {
    throw new IllustrativeParametersRejectedError(found.version);
  }
  return found;
}

export async function getParameterSetByVersion(db: Reader, version: string): Promise<StoredParameterSet | null> {
  const row = await db.parameterSet.findUnique({ where: { version }, include: withLines });
  return row ? fromRow(row) : null;
}

/** Todas as versões (inclusive substituídas), da mais antiga para a mais nova. */
export async function listParameterSets(db: Reader): Promise<StoredParameterSet[]> {
  const rows = await db.parameterSet.findMany({ include: withLines, orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(fromRow);
}

export async function listParameterAudit(db: Reader) {
  return db.auditLog.findMany({ where: { entity: PARAMETER_SET_ENTITY }, orderBy: { id: 'asc' } });
}

// ---------------------------------------------------------------------------
// Publicação de versões (única forma de alterar parâmetros)
// ---------------------------------------------------------------------------

export interface PublishOptions {
  /** Parâmetros completos no formato do motor (version e validFrom são sobrescritos aqui). */
  params: unknown;
  version: string;
  validFrom: string;
  /** Quem alterou (obrigatório para auditoria). */
  actor: string;
  /** Motivo da alteração (obrigatório para auditoria). */
  reason: string;
  /** Data de hoje ('AAAA-MM-DD'), injetada para teste; vigência no passado exige allowRetroactive. */
  today: string;
  allowRetroactive?: boolean;
  /** Ação gravada na auditoria. */
  action?: string;
  /** Só valida e calcula o que mudaria; não grava nada. */
  dryRun?: boolean;
  /** Falha se a versão vigente em validFrom não for esta (alteração concorrente). */
  expectedPreviousVersion?: string;
}

export interface PublishResult {
  created: StoredParameterSet;
  previous: StoredParameterSet | null;
  /** FIRST: primeira versão; CLOSED_PREVIOUS: anterior termina na véspera; SUPERSEDED: anterior (mesma data) substituída. */
  mode: 'FIRST' | 'CLOSED_PREVIOUS' | 'SUPERSEDED';
  changes: ParameterChange[];
  dryRun: boolean;
}

class DryRunRollback extends Error {
  constructor(readonly result: PublishResult) {
    super('dry-run');
  }
}

/**
 * Publica uma nova versão de parâmetros vigente a partir de `validFrom`, ajusta a vigência da
 * versão anterior e grava auditoria (antes/depois), tudo numa transação serializada por lock.
 */
export async function publishParameters(db: Db, opts: PublishOptions): Promise<PublishResult> {
  if (!opts.actor.trim()) throw new ParameterTimelineError('informe quem está alterando (--by)');
  if (!opts.reason.trim()) throw new ParameterTimelineError('informe o motivo da alteração (--reason)');
  dateFromIso(opts.validFrom);
  dateFromIso(opts.today);
  if (opts.validFrom < opts.today && !opts.allowRetroactive) {
    throw new ParameterTimelineError(
      `vigência retroativa (${opts.validFrom} < hoje ${opts.today}) muda o resultado de datas passadas; use --allow-retroactive se for intencional`,
    );
  }
  const raw = opts.params as Record<string, unknown>;
  if (raw && typeof raw === 'object' && raw.validTo !== undefined && raw.validTo !== null) {
    throw new ParameterTimelineError('validTo é controlado pela linha do tempo (a próxima versão encerra esta); deixe null');
  }

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('parameter_sets'))`;

      const future = await tx.parameterSet.findFirst({
        where: { supersededById: null, validFrom: { gt: dateFromIso(opts.validFrom) } },
        orderBy: { validFrom: 'asc' },
      });
      if (future) {
        throw new ParameterTimelineError(
          `já existe a versão ${future.version} a partir de ${isoFromDate(future.validFrom)}; publique a partir dessa data ou depois`,
        );
      }
      if (await tx.parameterSet.findUnique({ where: { version: opts.version } })) {
        throw new ParameterTimelineError(`versão "${opts.version}" já existe`);
      }

      const previous = await findParametersInForce(tx, opts.validFrom);
      if (opts.expectedPreviousVersion !== undefined && previous?.version !== opts.expectedPreviousVersion) {
        throw new ParameterTimelineError(
          `a versão vigente mudou durante a alteração (esperada ${opts.expectedPreviousVersion}, encontrada ${previous?.version ?? 'nenhuma'}); repita o comando`,
        );
      }
      const mode: PublishResult['mode'] = !previous ? 'FIRST' : previous.validFrom === opts.validFrom ? 'SUPERSEDED' : 'CLOSED_PREVIOUS';
      const validTo = previous?.validTo ?? null;
      const params = parseSimulationParameters({ ...raw, version: opts.version, validFrom: opts.validFrom, validTo });
      const changes = diffParameters(previous?.params ?? null, params);
      if (previous && changes.length === 0) {
        throw new ParameterTimelineError(`nada mudou em relação à versão vigente ${previous.version}`);
      }

      if (mode === 'CLOSED_PREVIOUS') {
        await tx.parameterSet.update({ where: { id: previous!.id }, data: { validTo: dateFromIso(addDays(opts.validFrom, -1)) } });
      }
      const created = await tx.parameterSet.create({
        data: {
          version: params.version,
          status: params.status,
          validFrom: dateFromIso(params.validFrom),
          validTo: params.validTo ? dateFromIso(params.validTo) : null,
          defaultSystem: params.defaultSystem,
          adjustmentToleranceRatio: params.adjustmentToleranceRatio,
          desiredInstallmentToleranceRatio: params.desiredInstallmentToleranceRatio,
          highCommitmentAlertRatio: params.highCommitmentAlertRatio,
          informalIncomeTypes: params.informalIncomeTypes,
          basedOnId: previous?.id ?? null,
          createdBy: opts.actor,
          note: opts.reason,
          creditLines: { create: params.creditLines.map(lineToRow) },
        },
        include: withLines,
      });
      if (mode === 'SUPERSEDED') {
        await tx.parameterSet.update({ where: { id: previous!.id }, data: { supersededById: created.id } });
      }

      // O que foi gravado tem de ser exatamente o que foi pedido (pega perda de precisão nas colunas decimais).
      const stored = fromRow(created);
      if (!isDeepStrictEqual(canonical(stored.params), canonical(params))) {
        const lost = diffParameters(params, stored.params).map((c) => `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
        throw new ParameterTimelineError(`valor não cabe na precisão da coluna: ${lost.join('; ')}`);
      }

      const values = (side: 'before' | 'after') => Object.fromEntries(changes.map((c) => [c.path, c[side]]));
      await tx.auditLog.create({
        data: {
          actor: opts.actor,
          entity: PARAMETER_SET_ENTITY,
          entityId: created.id,
          action: opts.action ?? 'PARAMETERS_PUBLISHED',
          reason: opts.reason,
          before: previous ? ({ version: previous.version, values: values('before') } as Prisma.InputJsonValue) : jsonOrDbNull(null),
          after: {
            version: params.version,
            status: params.status,
            validFrom: params.validFrom,
            validTo: params.validTo,
            ...(previous ? { values: values('after') } : { params }),
          } as Prisma.InputJsonValue,
        },
      });
      if (previous) {
        await tx.auditLog.create({
          data: {
            actor: opts.actor,
            entity: PARAMETER_SET_ENTITY,
            entityId: previous.id,
            action: mode === 'SUPERSEDED' ? 'PARAMETERS_SUPERSEDED' : 'PARAMETERS_CLOSED',
            reason: opts.reason,
            before: { version: previous.version, validTo: previous.validTo },
            after:
              mode === 'SUPERSEDED'
                ? { version: previous.version, supersededBy: params.version }
                : { version: previous.version, validTo: addDays(opts.validFrom, -1) },
          },
        });
      }

      const result: PublishResult = {
        created: stored,
        previous: previous ? (await getParameterSetByVersion(tx, previous.version))! : null,
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

export interface ChangeOptions extends Omit<PublishOptions, 'params' | 'version' | 'expectedPreviousVersion'> {
  /** Alterações `caminho=valor` (ver changes.ts). */
  set: string[];
  /** Nome da nova versão; padrão: v<n>-<validFrom>. */
  version?: string;
}

/** Deriva uma nova versão da vigente em `validFrom`, alterando só os campos pedidos. */
export async function changeParameters(db: Db, opts: ChangeOptions): Promise<PublishResult> {
  if (opts.set.length === 0) throw new ParameterTimelineError('nenhuma alteração informada (--set caminho=valor)');
  const base = await getParametersInForce(db, opts.validFrom);
  let params = base.params;
  for (const assignment of opts.set) {
    const eq = assignment.indexOf('=');
    if (eq <= 0) throw new ParameterTimelineError(`alteração inválida "${assignment}" (use caminho=valor)`);
    params = applyChange(params, assignment.slice(0, eq).trim(), parseCliValue(assignment.slice(eq + 1).trim()));
  }
  const version = opts.version ?? `v${(await db.parameterSet.count()) + 1}-${opts.validFrom}`;
  return publishParameters(db, {
    ...opts,
    params: { ...params, validTo: null },
    version,
    action: opts.action ?? 'PARAMETERS_CHANGED',
    expectedPreviousVersion: base.version,
  });
}
