import { z } from 'zod';
import { isIsoDate } from './dates';
import { proponentSchema } from './input';

const isoDate = z.string().refine(isIsoDate, 'data ISO inválida (AAAA-MM-DD)');
const money = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

/**
 * Perfil para a estimativa do financiamento bancário do saldo (opcional). Reaproveita o motor de
 * financiamento: precisa de idade, renda, dívidas e FGTS de cada proponente.
 */
export const financingProfileSchema = z.object({
  applicant: proponentSchema,
  coApplicant: proponentSchema.nullable(),
  ownsResidentialProperty: z.boolean(),
  firstFinancing: z.boolean(),
  system: z.enum(['SAC', 'PRICE']).optional(),
  desiredTermMonths: z.number().int().positive().optional(),
});

/** Renda e dívidas de quem compra (1 ou 2 pessoas), para a capacidade de pagar a entrada. */
const buyerSchema = z.object({ grossMonthlyIncome: positive, monthlyDebts: money });

const common = {
  /** Data da simulação. Nunca o relógio do motor. */
  referenceDate: isoDate,
  unitPrice: positive,
  /** Previsão de entrega das chaves (no passado = pronto para morar). */
  deliveryDate: isoDate,
};

export const paymentInputSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('A_VISTA') }),
  z.object({
    ...common,
    mode: z.literal('ENTRADA_A_VISTA'),
    /** Dinheiro disponível hoje para a entrada. */
    cashNow: money,
    /** Entrada que o lead quer dar; vazio = a mínima da condição. */
    desiredDownPayment: positive.optional(),
    financing: financingProfileSchema.nullable().optional(),
  }),
  z.object({
    ...common,
    mode: z.literal('ENTRADA_PARCELADA'),
    /** Dinheiro disponível hoje para o ato. */
    cashNow: money,
    buyers: z.array(buyerSchema).min(1).max(2),
    /** Mensal que o lead quer pagar (teto, com folga pequena). Vazio = sem preferência. */
    desiredInstallment: positive.optional(),
    /** O lead aceita reforços semestrais/anuais. */
    acceptsBalloons: z.boolean(),
    desiredDownPayment: positive.optional(),
    financing: financingProfileSchema.nullable().optional(),
  }),
]);

export type FinancingProfile = z.infer<typeof financingProfileSchema>;
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export class InvalidPaymentInputError extends Error {
  constructor(readonly issues: string[]) {
    super(`entrada de simulação de pagamento inválida: ${issues.join('; ')}`);
    this.name = 'InvalidPaymentInputError';
  }
}

export function parsePaymentInput(raw: unknown): PaymentInput {
  const parsed = paymentInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidPaymentInputError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
