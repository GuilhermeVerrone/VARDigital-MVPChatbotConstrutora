import type { PaymentAlertCode, PaymentReason, PaymentSuggestionCode, PaymentAlert, PaymentSuggestion } from '@mvp/simulation';
import { brl, pct } from './format';

// Frases das formas de pagamento (V2). Dois tons: o do lead (cordial, sem jargão) e o do corretor
// (direto). Os números entram só pelo argumento `value`/`amount`, que vem do motor.

const val = (a: PaymentAlert): number => a.value ?? 0;
type AlertText = (a: PaymentAlert) => string | null;

export const PAYMENT_ALERT_FOR_LEAD: Record<PaymentAlertCode, AlertText> = {
  // O aviso de condição de exemplo já vai na mensagem do aviso legal.
  ILLUSTRATIVE_CONDITION: () => null,
  DOWN_PAYMENT_ADJUSTED: (a) => `Ajustei a entrada para ${brl(val(a))}, que fica dentro do mínimo e do máximo que a construtora aceita.`,
  NO_TIME_FOR_INSTALLMENTS: () => 'A entrega das chaves está muito próxima, então não sobra prazo para parcelar a entrada: ela é paga de uma vez.',
  CORRECTION_APPLIES: () => 'As parcelas da entrada são corrigidas pelo índice da construtora até a entrega. O valor corrigido é uma projeção e pode mudar.',
  HIGH_INCOME_COMMITMENT: (a) => `A maior parcela ocuparia ${pct(val(a))} da sua renda, perto do limite da construtora.`,
  DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY: (a) => `A mensal ficou um pouco acima do que você queria pagar: ${brl(val(a))}.`,
  DESIRED_INSTALLMENT_UNREACHABLE: (a) => `Não consegui chegar na mensal que você queria. Com o plano mais leve possível, a maior parcela é de ${brl(val(a))}.`,
  BANK_ESTIMATE_NEEDS_ADJUSTMENTS: () => 'No financiamento do saldo nas chaves, o banco ainda pode pedir ajustes.',
  BANK_ESTIMATE_NOT_VIABLE: () => 'Pelo perfil informado, o financiamento do saldo nas chaves ainda não fecha com o banco.',
  BANK_ESTIMATE_UNAVAILABLE: () => 'Não consegui estimar o financiamento do saldo agora; o corretor confirma isso com você.',
};

export const PAYMENT_ALERT_FOR_BROKER: Record<PaymentAlertCode, AlertText> = {
  ILLUSTRATIVE_CONDITION: () => 'Condição comercial ILUSTRATIVA: não usar para promessa de condições',
  DOWN_PAYMENT_ADJUSTED: (a) => `Entrada ajustada para ${brl(val(a))} (limites da condição)`,
  NO_TIME_FOR_INSTALLMENTS: () => 'Entrega muito próxima: sem mensais nem reforços, entrada paga de uma vez',
  CORRECTION_APPLIES: () => 'Parcelas da entrada corrigidas pelo índice da condição (projeção informativa)',
  HIGH_INCOME_COMMITMENT: (a) => `Comprometimento de renda em ${pct(val(a))} (próximo do limite)`,
  DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY: (a) => `Mensal um pouco acima da desejada (maior parcela ${brl(val(a))})`,
  DESIRED_INSTALLMENT_UNREACHABLE: (a) => `Mensal desejada inalcançável; menor plano possível tem maior parcela de ${brl(val(a))}`,
  BANK_ESTIMATE_NEEDS_ADJUSTMENTS: () => 'Estimativa do banco no saldo: viável com ajustes',
  BANK_ESTIMATE_NOT_VIABLE: () => 'Estimativa do banco no saldo: inviável com o perfil informado',
  BANK_ESTIMATE_UNAVAILABLE: () => 'Estimativa do banco indisponível (parâmetros fora de vigência)',
};

export const PAYMENT_SUGGESTION_FOR_LEAD: Record<PaymentSuggestionCode, (s: PaymentSuggestion) => string> = {
  INCREASE_DOWN_PAYMENT: (s) => `juntar mais ${brl(s.amount ?? 0)} para o ato`,
  PLAN_DOWN_PAYMENT: (s) => `se planejar para juntar o que falta: hoje faltam ${brl(s.amount ?? 0)}`,
  ADD_CO_APPLICANT: () => 'somar a renda de mais uma pessoa na compra',
  ACCEPT_BALLOONS: () => 'aceitar reforços, que deixam as mensais mais leves',
  CONSIDER_INSTALLMENTS: () => 'olhar a entrada parcelada com a construtora',
  PAY_OFF_DEBTS: () => 'quitar ou reduzir as parcelas que você já paga todo mês',
  SMALLER_UNIT: () => 'olhar uma unidade menor ou de menor valor',
  RETURN_LATER: () => 'voltar a simular mais para frente',
};

export const PAYMENT_SUGGESTION_FOR_BROKER: Record<PaymentSuggestionCode, (s: PaymentSuggestion) => string> = {
  INCREASE_DOWN_PAYMENT: (s) => `reforçar o ato em ${brl(s.amount ?? 0)}`,
  PLAN_DOWN_PAYMENT: (s) => `planejar a entrada (faltam ${brl(s.amount ?? 0)})`,
  ADD_CO_APPLICANT: () => 'incluir co-proponente',
  ACCEPT_BALLOONS: () => 'oferecer reforços',
  CONSIDER_INSTALLMENTS: () => 'apresentar a entrada parcelada',
  PAY_OFF_DEBTS: () => 'quitar dívidas antes',
  SMALLER_UNIT: () => 'avaliar unidade menor',
  RETURN_LATER: () => 'retomar o contato mais adiante',
};

export const PAYMENT_REASON_FOR_LEAD: Record<PaymentReason, string> = {
  DOWN_PAYMENT_SHORTFALL_WITHIN_TOLERANCE: 'Com o valor que você tem hoje, falta pouco para fechar o plano.',
  DOWN_PAYMENT_SHORTFALL: 'Com o valor que você tem hoje, ainda falta bastante para fechar o plano.',
  NO_PAYMENT_CAPACITY: 'Pela sua renda e pelas parcelas que você já paga, o que sobra por mês ainda não cobre a menor mensal que a construtora aceita.',
};
