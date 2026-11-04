import { z } from 'zod';
import { isIsoDate } from './dates';

// Condição comercial de um empreendimento (V2, discovery §2): as regras da construtora para as três
// formas de pagamento. Como os parâmetros financeiros, nada aqui tem valor padrão de negócio: tudo
// vem da tabela versionada com vigência (seed ILUSTRATIVO até o financeiro validar).

const isoDate = z.string().refine(isIsoDate, 'data ISO inválida (AAAA-MM-DD)');
const ratio = z.number().min(0).max(1);
const money = z.number().finite().nonnegative();

export const PAYMENT_MODES = ['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const CORRECTION_INDEXES = ['INCC', 'IPCA', 'IGPM', 'NENHUM'] as const;
export type CorrectionIndex = (typeof CORRECTION_INDEXES)[number];

export const salesConditionSchema = z
  .object({
    version: z.string().min(1),
    /** ILUSTRATIVO = não validado pela construtora; toda simulação sai com alerta. */
    status: z.enum(['ILUSTRATIVO', 'VALIDADO']),
    validFrom: isoDate,
    validTo: isoDate.nullable(),
    /** Falta de dinheiro (ato ou entrada) até esta fração da entrada → "viável com ajustes". */
    adjustmentToleranceRatio: ratio,
    /** Modo 1: pagamento à vista. */
    cash: z.object({ enabled: z.boolean(), discountRatio: z.number().min(0).lt(1) }),
    /** Entrada dos modos 2 e 3, em fração do preço da unidade. */
    downPayment: z.object({ minRatio: z.number().gt(0).max(1), maxRatio: z.number().gt(0).max(1) }),
    /** Modo 2: entrada inteira no ato e financiamento do saldo nas chaves. */
    upfront: z.object({ enabled: z.boolean() }),
    /** Modo 3: entrada parcelada direto com a construtora até as chaves. */
    installments: z.object({
      enabled: z.boolean(),
      /** Ato (sinal) mínimo: o maior entre a fração da entrada e o piso em reais. */
      act: z.object({ minRatio: ratio, minAmount: money }),
      monthly: z.object({
        /** Teto de parcelas mensais (o prazo real é o menor entre este e os meses até as chaves). */
        maxCount: z.number().int().min(0).max(240),
        /** Valor mínimo de cada mensal: com pouco saldo, o número de parcelas diminui. */
        minAmount: z.number().finite().min(1),
        /** Juros da construtora sobre as mensais (Price). 0 = sem juros, só correção. */
        monthlyInterestRate: z.number().min(0).lt(0.1),
      }),
      /** Reforços (intermediárias). null = a condição não oferece reforços. */
      balloons: z.object({ intervalMonths: z.number().int().positive(), maxRatio: ratio }).nullable(),
      /** Parcela paga na entrega das chaves, em fração da entrada (0 = não há). */
      keysRatio: ratio,
      /** Mensal máxima = renda familiar × este limite − dívidas. */
      maxIncomeCommitment: z.number().gt(0).max(1),
      /** Alerta de comprometimento alto a partir desta fração do limite. */
      highCommitmentAlertRatio: ratio,
      /** Quanto acima da parcela desejada ainda conta como "pouca diferença". */
      desiredInstallmentToleranceRatio: ratio,
      /** Correção monetária do saldo da entrada. A projeção é só informativa (null = não projetar). */
      correction: z.object({
        index: z.enum(CORRECTION_INDEXES),
        projectedMonthlyRate: z.number().min(0).lt(0.1).nullable(),
      }),
    }),
    /** Estimativa do financiamento bancário do saldo nas chaves (D10). */
    bankEstimate: z.object({ enabled: z.boolean() }),
  })
  .refine((c) => c.validTo === null || c.validFrom <= c.validTo, {
    message: 'validFrom posterior a validTo',
    path: ['validTo'],
  })
  .refine((c) => c.downPayment.minRatio <= c.downPayment.maxRatio, {
    message: 'downPayment.minRatio > downPayment.maxRatio',
    path: ['downPayment'],
  })
  .refine(
    (c) => c.installments.act.minRatio + c.installments.keysRatio + (c.installments.balloons?.maxRatio ?? 0) <= 1,
    { message: 'ato mínimo + chaves + reforços passam de 100% da entrada', path: ['installments'] },
  )
  .refine((c) => c.cash.enabled || c.upfront.enabled || c.installments.enabled, {
    message: 'nenhuma forma de pagamento habilitada',
    path: ['cash'],
  });

export type SalesCondition = z.infer<typeof salesConditionSchema>;

export class InvalidSalesConditionError extends Error {
  constructor(readonly issues: string[]) {
    super(`condição comercial inválida: ${issues.join('; ')}`);
    this.name = 'InvalidSalesConditionError';
  }
}

export function parseSalesCondition(raw: unknown): SalesCondition {
  const parsed = salesConditionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidSalesConditionError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}

/** Formas de pagamento que a condição oferece, na ordem de apresentação ao lead. */
export function offeredModes(condition: SalesCondition): PaymentMode[] {
  const modes: PaymentMode[] = [];
  if (condition.cash.enabled) modes.push('A_VISTA');
  if (condition.upfront.enabled) modes.push('ENTRADA_A_VISTA');
  if (condition.installments.enabled) modes.push('ENTRADA_PARCELADA');
  return modes;
}
