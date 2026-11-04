import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Db } from '../client';
import {
  changeParameters,
  getParameterSetByVersion,
  getParametersInForce,
  listParameterAudit,
  listParameterSets,
  publishParameters,
  type PublishResult,
  type StoredParameterSet,
} from '../parameters/repository';

// CLI de parâmetros financeiros (no MVP substitui o painel do RF-47). Toda alteração cria uma
// nova versão com vigência e grava auditoria (RF-52). Ver packages/db/README.md.

export const PARAMS_USAGE = `uso: params <comando> [opções]

  show     [--date AAAA-MM-DD | --version V] [--json]
           Mostra a versão vigente na data (padrão: hoje). --json imprime no formato de import.
  history  Lista todas as versões e o log de auditoria.
  set      --set caminho=valor [--set ...] --from AAAA-MM-DD --by QUEM --reason MOTIVO
           [--version V] [--allow-retroactive] [--dry-run]
           Cria nova versão a partir da vigente em --from, alterando só os campos pedidos.
           caminho: campo global (ex.: adjustmentToleranceRatio, status) ou
                    lines.<id>.<campo> (ex.: lines.sbpe.annualInterestRate).
  import   <arquivo.json> --from AAAA-MM-DD --by QUEM --reason MOTIVO
           [--version V] [--allow-retroactive] [--dry-run]
           Publica um conjunto completo (ex.: tabela validada pelo financeiro).`;

export interface CliIo {
  db: Db;
  today: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Base para caminhos relativos de arquivo. */
  cwd?: string;
}

const brl = (n: number | null) =>
  n === null ? 'sem limite' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 6 })}%`;
const range = (s: { validFrom: string; validTo: string | null }) => `${s.validFrom} → ${s.validTo ?? 'sem fim'}`;

function describe(set: StoredParameterSet, out: CliIo['out']): void {
  const p = set.params;
  out(`versão ${set.version} [${p.status}]  vigência ${range(set)}${set.supersededById ? '  (SUBSTITUÍDA)' : ''}`);
  out(`  sistema padrão ${p.defaultSystem}; tolerância de ajuste ${pct(p.adjustmentToleranceRatio)}; folga da parcela desejada ${pct(p.desiredInstallmentToleranceRatio)}; alerta de comprometimento ${pct(p.highCommitmentAlertRatio)}`);
  out(`  renda informal: ${p.informalIncomeTypes.join(', ') || '(nenhuma)'}`);
  for (const l of p.creditLines) {
    out(`  - ${l.id} (${l.name}), prioridade ${l.priority}`);
    out(`      taxa ${pct(l.annualInterestRate)} a.a. ${l.rateConvention}; cota ${pct(l.maxLtv)}; comprometimento ${pct(l.maxIncomeCommitment)}`);
    out(`      renda máx. ${brl(l.eligibility.maxFamilyIncome)}; imóvel máx. ${brl(l.eligibility.maxPropertyValue)}; prazo ${l.termMonths.min}–${l.termMonths.max} meses; idade máx. ao fim ${l.maxAgeAtEndMonths} meses`);
    out(`      DFI ${pct(l.insurance.dfiMonthlyRate)} a.m.; taxa adm. ${brl(l.adminFeeMonthly)}; subsídio ${l.subsidy ? `${l.subsidy.bands.length} faixas` : 'não'}; FGTS ${l.fgts.allowed ? 'sim' : 'não'}`);
  }
}

function reportPublish(r: PublishResult, out: CliIo['out']): void {
  const prefix = r.dryRun ? '[dry-run, nada gravado] ' : '';
  out(`${prefix}nova versão ${r.created.version} [${r.created.params.status}] vigente ${range(r.created)}`);
  if (r.previous) {
    out(
      r.mode === 'SUPERSEDED'
        ? `${prefix}versão ${r.previous.version} substituída (mesma data de início)`
        : `${prefix}versão ${r.previous.version} agora vigente ${range(r.previous)}`,
    );
  }
  for (const c of r.changes.slice(0, 50)) out(`  ${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
  if (r.changes.length > 50) out(`  … e mais ${r.changes.length - 50} campos`);
}

export async function runParamsCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        date: { type: 'string' },
        version: { type: 'string' },
        json: { type: 'boolean' },
        set: { type: 'string', multiple: true },
        from: { type: 'string' },
        by: { type: 'string' },
        reason: { type: 'string' },
        'allow-retroactive': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
      },
    });
  } catch (e) {
    io.err((e as Error).message);
    io.err(PARAMS_USAGE);
    return 2;
  }
  const { values: o, positionals } = parsed;

  const requireOpts = (...names: ('from' | 'by' | 'reason')[]) => {
    const missing = names.filter((n) => !o[n]);
    if (missing.length > 0) throw new UsageError(`faltam opções: ${missing.map((n) => `--${n}`).join(', ')}`);
  };

  try {
    switch (command) {
      case 'show': {
        const set = o.version ? await getParameterSetByVersion(io.db, o.version) : await getParametersInForce(io.db, o.date ?? io.today);
        if (!set) throw new UsageError(`versão ${o.version} não encontrada`);
        if (o.json) io.out(JSON.stringify(set.params, null, 2));
        else describe(set, io.out);
        return 0;
      }
      case 'history': {
        const sets = await listParameterSets(io.db);
        io.out(`${sets.length} versão(ões):`);
        for (const s of sets) {
          io.out(`  ${s.version} [${s.params.status}] ${range(s)}${s.supersededById ? ' (SUBSTITUÍDA)' : ''}  por ${s.createdBy} em ${s.createdAt.toISOString()}: ${s.note ?? ''}`);
        }
        const audit = await listParameterAudit(io.db);
        io.out(`auditoria (${audit.length}):`);
        for (const a of audit) {
          io.out(`  ${a.at.toISOString()} ${a.action} por ${a.actor}: ${a.reason ?? ''}`);
          const before = a.before as { values?: Record<string, unknown> } | null;
          const after = a.after as { values?: Record<string, unknown>; version?: string; validTo?: string | null } | null;
          if (after?.values) {
            for (const [path, value] of Object.entries(after.values)) {
              io.out(`      ${path}: ${JSON.stringify(before?.values?.[path])} → ${JSON.stringify(value)}`);
            }
          } else if (after) {
            io.out(`      ${JSON.stringify(before)} → ${JSON.stringify(after).slice(0, 200)}`);
          }
        }
        return 0;
      }
      case 'set': {
        requireOpts('from', 'by', 'reason');
        const result = await changeParameters(io.db, {
          set: o.set ?? [],
          validFrom: o.from!,
          actor: o.by!,
          reason: o.reason!,
          today: io.today,
          ...(o.version ? { version: o.version } : {}),
          allowRetroactive: Boolean(o['allow-retroactive']),
          dryRun: Boolean(o['dry-run']),
        });
        reportPublish(result, io.out);
        return 0;
      }
      case 'import': {
        requireOpts('from', 'by', 'reason');
        const file = positionals[0];
        if (!file) throw new UsageError('informe o arquivo JSON');
        const raw = JSON.parse(readFileSync(resolve(io.cwd ?? process.cwd(), file), 'utf8')) as { version?: unknown };
        const version = o.version ?? (typeof raw.version === 'string' ? raw.version : undefined);
        if (!version) throw new UsageError('informe --version (o arquivo não tem "version")');
        const result = await publishParameters(io.db, {
          params: { ...raw, validTo: null },
          version,
          validFrom: o.from!,
          actor: o.by!,
          reason: o.reason!,
          today: io.today,
          allowRetroactive: Boolean(o['allow-retroactive']),
          dryRun: Boolean(o['dry-run']),
          action: 'PARAMETERS_IMPORTED',
        });
        reportPublish(result, io.out);
        return 0;
      }
      default:
        io.err(command ? `comando desconhecido: ${command}` : 'informe um comando');
        io.err(PARAMS_USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(e.message);
      io.err(PARAMS_USAGE);
      return 2;
    }
    io.err(`erro: ${(e as Error).message}`);
    return 1;
  }
}

class UsageError extends Error {}
