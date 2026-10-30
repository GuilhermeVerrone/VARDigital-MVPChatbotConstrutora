import { dateTimeBr } from './format';

/** Avisos legais obrigatórios na conversa e no PDF (spec §4.8). Texto provisório até o jurídico aprovar. */
export const LEGAL_VERSION = 'ilustrativo-1';

export const LEGAL_LINES = [
  'Esta simulação é indicativa e não constitui aprovação de crédito.',
  'Valores e condições estão sujeitos à análise de crédito, à política do agente financeiro e à disponibilidade da unidade.',
  'Taxas e regras podem mudar sem aviso prévio.',
] as const;

export const ILLUSTRATIVE_LINE = 'Parâmetros ILUSTRATIVOS (de exemplo), ainda não validados pelo financeiro.';

/** Mensagem de WhatsApp com o aviso legal e a data e hora de geração. */
export function legalMessage(generatedAt: Date, illustrative: boolean): string {
  return [
    '*Importante:* esta simulação é *indicativa* e não é uma aprovação de crédito. Os valores e condições dependem da análise de crédito, da política do agente financeiro e da disponibilidade da unidade, e as taxas e regras podem mudar sem aviso.',
    `Simulação gerada em ${dateTimeBr(generatedAt)}.`,
    ...(illustrative ? [`_${ILLUSTRATIVE_LINE}_`] : []),
  ].join('\n\n');
}
