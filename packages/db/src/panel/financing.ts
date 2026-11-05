import type { CreditLine, SimulationParameters } from '@mvp/simulation';
import { z } from 'zod';
import type { Db } from '../client';
import { getParametersInForce, publishParameters, type PublishResult } from '../parameters/repository';
import { applyChange } from '../parameters/changes';
import { PanelValidationError, requireActor } from './errors';

// Financiamento simulado (Fase 14): edita a linha usada na estimativa do saldo (taxa, prazo, sistema e
// comprometimento). Por baixo, publica uma nova versão de ParameterSet (imutável, com auditoria).

export const financingLineSchema = z
  .object({
    lineId: z.string().min(1),
    annualInterestRate: z.number({ error: 'Informe a taxa' }).min(0, 'A taxa não pode ser negativa').lt(1, 'A taxa deve ser menor que 100%'),
    termMin: z.number({ error: 'Informe o prazo mínimo' }).int('Use meses inteiros').positive('O prazo mínimo deve ser maior que zero'),
    termMax: z.number({ error: 'Informe o prazo máximo' }).int('Use meses inteiros').positive('O prazo máximo deve ser maior que zero'),
    systems: z.array(z.enum(['SAC', 'PRICE'])).min(1, 'Escolha pelo menos um sistema'),
    defaultSystem: z.enum(['SAC', 'PRICE']),
    maxIncomeCommitment: z.number({ error: 'Informe o comprometimento' }).gt(0, 'Deve ser maior que zero').max(1, 'Deve ser no máximo 100%'),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data AAAA-MM-DD'),
    reason: z.string().trim().min(3, 'Informe o motivo da alteração'),
  })
  .refine((v) => v.termMin <= v.termMax, { path: ['termMin'], message: 'O prazo mínimo passa do máximo' })
  .refine((v) => v.systems.includes(v.defaultSystem), { path: ['defaultSystem'], message: 'O sistema padrão precisa estar entre os permitidos' });
export type FinancingLineForm = z.infer<typeof financingLineSchema>;

export interface FinancingView {
  version: string;
  validFrom: string;
  status: SimulationParameters['status'];
  defaultSystem: SimulationParameters['defaultSystem'];
  lines: Pick<CreditLine, 'id' | 'name' | 'priority' | 'annualInterestRate' | 'termMonths' | 'systems' | 'maxIncomeCommitment'>[];
}

/** Linhas de crédito da versão vigente na data (a estimativa do saldo avalia todas e escolhe a melhor). */
export async function getFinancingView(db: Db, date: string): Promise<FinancingView> {
  const set = await getParametersInForce(db, date);
  return {
    version: set.version,
    validFrom: set.validFrom,
    status: set.params.status,
    defaultSystem: set.params.defaultSystem,
    lines: set.params.creditLines
      .map((l) => ({ id: l.id, name: l.name, priority: l.priority, annualInterestRate: l.annualInterestRate, termMonths: l.termMonths, systems: l.systems, maxIncomeCommitment: l.maxIncomeCommitment }))
      .sort((a, b) => a.priority - b.priority),
  };
}

export async function publishFinancingLine(db: Db, args: { actor: string; today: string; data: unknown }): Promise<PublishResult> {
  requireActor(args.actor);
  const parsed = financingLineSchema.safeParse(args.data);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? '_')] ??= issue.message;
    throw new PanelValidationError(fields);
  }
  const f = parsed.data;
  const base = await getParametersInForce(db, f.validFrom);
  let params = base.params;
  const set = (path: string, value: unknown) => {
    params = applyChange(params, path, value);
  };
  set(`lines.${f.lineId}.annualInterestRate`, f.annualInterestRate);
  set(`lines.${f.lineId}.termMonths.min`, f.termMin);
  set(`lines.${f.lineId}.termMonths.max`, f.termMax);
  set(`lines.${f.lineId}.systems`, f.systems);
  set(`lines.${f.lineId}.maxIncomeCommitment`, f.maxIncomeCommitment);
  set('defaultSystem', f.defaultSystem);
  return publishParameters(db, {
    params: { ...params, validTo: null },
    version: `v${(await db.parameterSet.count()) + 1}-${f.validFrom}`,
    validFrom: f.validFrom,
    actor: args.actor,
    reason: f.reason,
    today: args.today,
    action: 'PARAMETERS_CHANGED',
    expectedPreviousVersion: base.version,
  });
}
