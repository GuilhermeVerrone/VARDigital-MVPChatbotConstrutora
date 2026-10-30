import type { Alert, AlertCode, Suggestion, SuggestionCode, VerdictReason } from '@mvp/simulation';
import { brl, pct } from './format';

// Frases para as mensagens. Dois tons: o do lead (cordial, sem jargão) e o do corretor (direto).
// Os números entram só pelo argumento `value`/`amount`, que vem do motor.

export const SUGGESTION_FOR_LEAD: Record<SuggestionCode, (s: Suggestion) => string> = {
  INCREASE_DOWN_PAYMENT: (s) => `juntar mais ${brl(s.amount ?? 0)} de entrada`,
  PLAN_DOWN_PAYMENT: (s) => `se planejar para juntar a entrada: hoje faltam ${brl(s.amount ?? 0)}`,
  ADD_CO_APPLICANT: () => 'somar a renda de mais uma pessoa na compra',
  LONGER_TERM: () => 'aumentar o prazo do financiamento',
  SMALLER_UNIT: () => 'olhar uma unidade menor ou de menor valor',
  PAY_OFF_DEBTS: () => 'quitar ou reduzir as parcelas que você já paga todo mês',
  RETURN_LATER: () => 'voltar a simular mais para frente',
};

export const SUGGESTION_FOR_BROKER: Record<SuggestionCode, (s: Suggestion) => string> = {
  INCREASE_DOWN_PAYMENT: (s) => `reforçar a entrada em ${brl(s.amount ?? 0)}`,
  PLAN_DOWN_PAYMENT: (s) => `planejar a entrada (faltam ${brl(s.amount ?? 0)})`,
  ADD_CO_APPLICANT: () => 'incluir co-proponente',
  LONGER_TERM: () => 'estender o prazo',
  SMALLER_UNIT: () => 'avaliar unidade menor',
  PAY_OFF_DEBTS: () => 'quitar dívidas antes',
  RETURN_LATER: () => 'retomar o contato mais adiante',
};

export const REASON_FOR_LEAD: Partial<Record<VerdictReason, string>> = {
  NO_PAYMENT_CAPACITY: 'Pela renda e pelas parcelas que você já paga, o que sobra para uma parcela de financiamento ainda não é suficiente.',
  AGE_LIMIT: 'Pela idade, o prazo do financiamento ficaria curto demais para esse imóvel.',
  NO_ELIGIBLE_LINE: 'Nenhuma linha de crédito do nosso cadastro se encaixa nesse perfil e nesse valor de imóvel.',
};

type AlertText = (a: Alert) => string | null;

const v = (a: Alert): number => a.value ?? 0;

export const ALERT_FOR_LEAD: Record<AlertCode, AlertText> = {
  // O aviso de parâmetros de exemplo já vai na mensagem do aviso legal.
  ILLUSTRATIVE_PARAMETERS: () => null,
  INFORMAL_INCOME: () => 'Como a renda não é de carteira assinada ou servidor, o banco pode pedir uma comprovação extra.',
  AGE_LIMITS_TERM: (a) => `Pela idade, o prazo máximo ficou em ${v(a)} meses.`,
  TERM_ADJUSTED: (a) => `O prazo que você pediu foi ajustado para ${v(a)} meses, o limite permitido.`,
  SYSTEM_ADJUSTED: () => 'Usei o sistema de parcelas permitido para essa linha de crédito.',
  HIGH_INCOME_COMMITMENT: (a) => `A parcela ocuparia ${pct(v(a))} da sua renda, perto do limite do banco.`,
  CO_APPLICANT_RECOMMENDED: () => null,
  DOWN_PAYMENT_INSUFFICIENT: () => null,
  FGTS_MIN_TIME_NOT_MET: (a) => `Seu FGTS ainda não tem os ${v(a)} meses de carteira exigidos para entrar na entrada.`,
  FGTS_NOT_ELIGIBLE: () => 'Pela regra dessa linha, o seu FGTS não pôde entrar na entrada.',
  DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY: (a) => `A parcela ficou um pouco acima do que você queria pagar: ${brl(v(a))} no primeiro mês.`,
  DESIRED_INSTALLMENT_UNREACHABLE: (a) =>
    `Não consegui chegar na parcela que você queria. Usando toda a sua entrada, a menor parcela possível é de ${brl(v(a))} no primeiro mês.`,
  CONSTRUCTION_INSTALLMENT_ABOVE_CAPACITY: (a) =>
    `As parcelas da entrada durante a obra (${brl(v(a))} por mês) são maiores que a parcela que cabe no seu orçamento hoje.`,
};

export const ALERT_FOR_BROKER: Record<AlertCode, AlertText> = {
  ILLUSTRATIVE_PARAMETERS: () => 'Parâmetros ILUSTRATIVOS: não usar para promessa de condições',
  INFORMAL_INCOME: () => 'Renda informal: pedir comprovação',
  AGE_LIMITS_TERM: (a) => `Idade limita o prazo a ${v(a)} meses`,
  TERM_ADJUSTED: (a) => `Prazo pedido ajustado para ${v(a)} meses`,
  DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY: (a) => `Coube um pouco acima da parcela desejada (1ª parcela ${brl(v(a))})`,
  DESIRED_INSTALLMENT_UNREACHABLE: (a) => `Parcela desejada inalcançável; menor possível com toda a entrada: ${brl(v(a))}`,
  SYSTEM_ADJUSTED: () => 'Sistema de amortização ajustado à linha',
  HIGH_INCOME_COMMITMENT: (a) => `Comprometimento de renda em ${pct(v(a))} (próximo do limite)`,
  CO_APPLICANT_RECOMMENDED: () => 'Co-proponente recomendado para fechar a parcela',
  DOWN_PAYMENT_INSUFFICIENT: (a) => `Entrada insuficiente: faltam ${brl(v(a))}`,
  FGTS_MIN_TIME_NOT_MET: (a) => `FGTS sem o tempo mínimo (${v(a)} meses): não entrou na entrada`,
  FGTS_NOT_ELIGIBLE: () => 'FGTS não elegível nessa linha',
  CONSTRUCTION_INSTALLMENT_ABOVE_CAPACITY: (a) => `Parcela da obra (${brl(v(a))}/mês) acima da capacidade de pagamento`,
};
