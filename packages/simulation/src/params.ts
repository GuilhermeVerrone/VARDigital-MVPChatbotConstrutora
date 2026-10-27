import { z } from 'zod';
import { isIsoDate } from './dates';

// Parâmetros financeiros injetados no motor (spec §4, §7.5). Nada aqui tem valor padrão de
// negócio: tudo vem da tabela (seed ILUSTRATIVO no MVP; Postgres com vigência na Fase 2).

export const INCOME_TYPES = ['CLT', 'AUTONOMO', 'SERVIDOR', 'APOSENTADO', 'OUTROS'] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];

const isoDate = z.string().refine(isIsoDate, 'data ISO inválida (AAAA-MM-DD)');
const ratio = z.number().min(0).max(1);
const money = z.number().nonnegative();
const months = z.number().int().nonnegative();

const mipBandSchema = z.object({
  /** Faixa vale para idade (anos completos) ≤ este valor. */
  upToAgeYears: z.number().int().positive(),
  monthlyRate: ratio,
});

const subsidyBandSchema = z.object({
  /** Faixa vale para renda familiar ≤ este valor. */
  maxFamilyIncome: z.number().positive(),
  amount: money,
});

export const creditLineSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Menor = preferida no desempate entre linhas com o mesmo parecer. */
    priority: z.number().int(),
    eligibility: z.object({
      maxFamilyIncome: z.number().positive().nullable(),
      maxPropertyValue: z.number().positive().nullable(),
      requiresFirstFinancing: z.boolean(),
      requiresNoOwnedProperty: z.boolean(),
    }),
    /** Cota máxima de financiamento sobre o valor do imóvel. */
    maxLtv: z.number().gt(0).max(1),
    annualInterestRate: z.number().min(0).lt(1),
    rateConvention: z.enum(['NOMINAL', 'EFFECTIVE']),
    /** Percentual máximo de comprometimento da renda familiar (parcela + dívidas). */
    maxIncomeCommitment: z.number().gt(0).max(1),
    termMonths: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    /** Idade máxima ao fim do contrato, em meses (ex.: 80 anos e 6 meses = 966). */
    maxAgeAtEndMonths: z.number().int().positive(),
    /** Proponente cuja idade limita o prazo quando há co-proponente. */
    ageRule: z.enum(['OLDEST', 'YOUNGEST']),
    systems: z.array(z.enum(['SAC', 'PRICE'])).min(1),
    insurance: z.object({
      mipMonthlyRateByAge: z.array(mipBandSchema).min(1),
      /** Sobre o valor do imóvel, por mês. */
      dfiMonthlyRate: ratio,
    }),
    adminFeeMonthly: money,
    otherMonthlyFees: z.array(z.object({ name: z.string().min(1), amount: money })),
    subsidy: z
      .object({
        maxPropertyValue: z.number().positive().nullable(),
        bands: z.array(subsidyBandSchema).min(1),
      })
      .nullable(),
    fgts: z.object({
      allowed: z.boolean(),
      minContributionMonths: months,
      maxPropertyValue: z.number().positive().nullable(),
      requiresNoOwnedProperty: z.boolean(),
    }),
  })
  .refine((l) => l.termMonths.min <= l.termMonths.max, {
    message: 'termMonths.min > termMonths.max',
    path: ['termMonths'],
  })
  .refine(
    (l) => l.insurance.mipMonthlyRateByAge.every((b, i, a) => i === 0 || b.upToAgeYears > a[i - 1]!.upToAgeYears),
    { message: 'faixas de MIP devem estar em ordem crescente de idade', path: ['insurance', 'mipMonthlyRateByAge'] },
  )
  .refine(
    (l) => !l.subsidy || l.subsidy.bands.every((b, i, a) => i === 0 || b.maxFamilyIncome > a[i - 1]!.maxFamilyIncome),
    { message: 'faixas de subsídio devem estar em ordem crescente de renda', path: ['subsidy', 'bands'] },
  );

export const simulationParametersSchema = z
  .object({
    version: z.string().min(1),
    /** ILUSTRATIVO = não validado pelo financeiro; toda simulação sai com alerta. */
    status: z.enum(['ILUSTRATIVO', 'VALIDADO']),
    validFrom: isoDate,
    validTo: isoDate.nullable(),
    defaultSystem: z.enum(['SAC', 'PRICE']),
    /** Falta de entrada até esta fração da entrada necessária → "viável com ajustes". */
    adjustmentToleranceRatio: ratio,
    /** Alerta de comprometimento alto a partir desta fração do limite da linha. */
    highCommitmentAlertRatio: ratio,
    informalIncomeTypes: z.array(z.enum(INCOME_TYPES)),
    creditLines: z.array(creditLineSchema).min(1),
  })
  .refine((p) => p.validTo === null || p.validFrom <= p.validTo, {
    message: 'validFrom posterior a validTo',
    path: ['validTo'],
  })
  .refine((p) => new Set(p.creditLines.map((l) => l.id)).size === p.creditLines.length, {
    message: 'ids de linha de crédito repetidos',
    path: ['creditLines'],
  });

export type CreditLine = z.infer<typeof creditLineSchema>;
export type SimulationParameters = z.infer<typeof simulationParametersSchema>;

export class InvalidParametersError extends Error {
  constructor(readonly issues: string[]) {
    super(`parâmetros de simulação inválidos: ${issues.join('; ')}`);
    this.name = 'InvalidParametersError';
  }
}

export function parseSimulationParameters(raw: unknown): SimulationParameters {
  const parsed = simulationParametersSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidParametersError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
