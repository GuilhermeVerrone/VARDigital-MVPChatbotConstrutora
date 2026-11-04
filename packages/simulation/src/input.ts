import { z } from 'zod';
import { ageInMonths, compareIsoDates, isIsoDate } from './dates';
import { INCOME_TYPES } from './params';

const isoDate = z.string().refine(isIsoDate, 'data ISO inválida (AAAA-MM-DD)');
const money = z.number().finite().nonnegative();

const MIN_AGE_MONTHS = 18 * 12;

export const proponentSchema = z.object({
  birthDate: isoDate,
  grossMonthlyIncome: z.number().finite().positive(),
  incomeType: z.enum(INCOME_TYPES),
  /** Parcelas mensais já comprometidas (financiamentos, empréstimos, cartão parcelado). */
  monthlyDebts: money,
  fgts: z.object({ balance: money, contributionMonths: z.number().int().nonnegative() }).nullable(),
});

/** Fluxo de pagamento da obra do empreendimento (RF-23, versão simples). */
export const constructionPlanSchema = z
  .object({
    deliveryDate: isoDate,
    /** Fração da entrada paga no ato (sinal). */
    signalRatio: z.number().min(0).max(1),
    /** Fração da entrada paga em reforços (intermediárias). */
    balloonRatio: z.number().min(0).max(1),
    /** Intervalo entre reforços, em meses (6 = semestral, 12 = anual). */
    balloonIntervalMonths: z.number().int().positive(),
  })
  .refine((p) => p.signalRatio + p.balloonRatio <= 1, {
    message: 'signalRatio + balloonRatio > 1',
    path: ['balloonRatio'],
  });

export const simulationInputSchema = z
  .object({
    /** Data da simulação (idade, vigência, meses até a entrega). Nunca o relógio do motor. */
    referenceDate: isoDate,
    propertyValue: z.number().finite().positive(),
    applicant: proponentSchema,
    coApplicant: proponentSchema.nullable(),
    /** Dinheiro disponível para a entrada (sem FGTS). */
    availableDownPayment: money,
    ownsResidentialProperty: z.boolean(),
    firstFinancing: z.boolean(),
    system: z.enum(['SAC', 'PRICE']).optional(),
    desiredTermMonths: z.number().int().positive().optional(),
    /** Parcela mensal que o lead quer pagar (teto, com folga pequena). Vazio = sem preferência. */
    desiredInstallment: z.number().finite().positive().optional(),
    /**
     * false (padrão): financia o máximo possível e mostra a entrada mínima.
     * true: usa toda a entrada disponível e financia só o restante.
     */
    useFullDownPayment: z.boolean().optional(),
    construction: constructionPlanSchema.nullable().optional(),
  })
  .superRefine((input, ctx) => {
    const proponents = [['applicant', input.applicant], ['coApplicant', input.coApplicant]] as const;
    for (const [key, p] of proponents) {
      if (!p || !isIsoDate(p.birthDate) || !isIsoDate(input.referenceDate)) continue;
      if (ageInMonths(p.birthDate, input.referenceDate) < MIN_AGE_MONTHS) {
        ctx.addIssue({ code: 'custom', message: 'proponente menor de 18 anos', path: [key, 'birthDate'] });
      }
    }
    const plan = input.construction;
    if (plan && isIsoDate(plan.deliveryDate) && isIsoDate(input.referenceDate)) {
      if (compareIsoDates(plan.deliveryDate, input.referenceDate) < 0) {
        ctx.addIssue({ code: 'custom', message: 'entrega anterior à data da simulação', path: ['construction', 'deliveryDate'] });
      }
    }
  });

export type Proponent = z.infer<typeof proponentSchema>;
export type ConstructionPlan = z.infer<typeof constructionPlanSchema>;
export type SimulationInput = z.infer<typeof simulationInputSchema>;

export class InvalidSimulationInputError extends Error {
  constructor(readonly issues: string[]) {
    super(`entrada de simulação inválida: ${issues.join('; ')}`);
    this.name = 'InvalidSimulationInputError';
  }
}

export function parseSimulationInput(raw: unknown): SimulationInput {
  const parsed = simulationInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidSimulationInputError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
