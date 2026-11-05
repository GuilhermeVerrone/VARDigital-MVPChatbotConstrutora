import type { DownPaymentPlan } from '@mvp/simulation';
import { areaM2, brl, dateTimeBr, firstName, joinList, monthYear, pct } from './format';
import { financingBlock } from './lead-message';
import { PAYMENT_ALERT_FOR_LEAD, PAYMENT_REASON_FOR_LEAD, PAYMENT_SUGGESTION_FOR_LEAD } from './payment-phrases';
import type { PaymentView } from './types';

// Mensagens do resultado por forma de pagamento (V2). Texto fixo + números do motor, em listas
// curtas (um bloco por assunto) e no máximo um emoji por mensagem. O LLM não participa.

const HEADLINE = {
  A_VISTA: '✅ Pagando à vista, a condição fica assim.',
  VIAVEL: '✅ Boa notícia: pelo que você me contou, o plano cabe.',
  VIAVEL_COM_AJUSTES: 'Está bem pertinho! Com um pequeno ajuste a conta fecha.',
  INVIAVEL: 'Por enquanto esse plano ainda não fecha com o que você me passou, mas dá para pensar em caminhos.',
} as const;

function intro(view: PaymentView): string {
  const name = firstName(view.leadName);
  const unit = view.unit
    ? `o apartamento de *${view.unit.typology}* (unidade ${view.unit.code}, ${areaM2(view.unit.areaM2)}), com valor de ${brl(view.result.unitPrice)}`
    : `um imóvel de ${brl(view.result.unitPrice)}`;
  const verb = view.scenario ? 'refiz a simulação' : 'fiz a simulação';
  const changes: string[] = [];
  if (view.scenario?.cashNow !== undefined) changes.push(`${brl(view.scenario.cashNow)} disponíveis agora`);
  if (view.scenario?.acceptsBalloons !== undefined) changes.push(view.scenario.acceptsBalloons ? 'com reforços' : 'sem reforços');
  const tail = changes.length > 0 ? ` Considerei ${joinList(changes)}.` : '';
  return `${name ? `${name}, ` : ''}${verb} do *${view.development.name}* para ${unit}.${tail}`;
}

function planBlock(plan: DownPaymentPlan, deliveryIso: string): string {
  const lines: string[] = [`*Como fica a entrada* (${brl(plan.total)} no total)`];
  if (plan.monthly.count === 0 && plan.balloons.count === 0 && plan.keys.amount === 0) {
    lines.push(`• Tudo de uma vez, no ato: ${brl(plan.act)}`);
    return lines.join('\n');
  }
  lines.push(`• Ato, hoje: ${brl(plan.act)}`);
  if (plan.monthly.count > 0) {
    const same = plan.monthly.amount === plan.monthly.lastAmount;
    lines.push(
      `• ${plan.monthly.count} ${plan.monthly.count === 1 ? 'mensal' : 'mensais'} de ${brl(plan.monthly.amount)}${same ? '' : ` (a última de ${brl(plan.monthly.lastAmount)})`}`,
    );
  }
  if (plan.balloons.count > 0) {
    lines.push(
      `• ${plan.balloons.count} ${plan.balloons.count === 1 ? 'reforço' : 'reforços'} de ${brl(plan.balloons.amount)} (nos meses ${joinList(plan.balloons.months)})`,
    );
  }
  if (plan.keys.amount > 0) lines.push(`• Na entrega das chaves${plan.keys.month ? ` (mês ${plan.keys.month})` : ''}: ${brl(plan.keys.amount)}`);
  if (plan.interestTotal > 0) lines.push(`• Juros da construtora nas mensais: ${brl(plan.interestTotal)} (total pago na entrada: ${brl(plan.totalPaid)})`);
  lines.push(`Entrega prevista para ${monthYear(deliveryIso)}.`);
  if (plan.correction) {
    lines.push(
      `Projeção informativa com a correção do ${plan.correction.index}: a entrada iria a ${brl(plan.correction.projectedTotal)}, ${brl(plan.correction.projectedIncrease)} a mais.`,
    );
  }
  return lines.join('\n');
}

function cashBlock(view: PaymentView): string | null {
  const c = view.result.cash;
  if (!c) return null;
  const lines = ['*Pagamento à vista*', `• Valor de tabela: ${brl(view.result.unitPrice)}`];
  if (c.discount > 0) lines.push(`• Desconto à vista: ${brl(c.discount)} (${pct(c.discountRatio)})`);
  lines.push(`• Total a pagar: ${brl(c.amountToPay)}`);
  return lines.join('\n');
}

function downPaymentBlock(view: PaymentView): string | null {
  const d = view.result.downPayment;
  if (!d) return null;
  const lines = [`*Entrada*`, `• A construtora aceita entrada de ${brl(d.min)} a ${brl(d.max)}; usei ${brl(d.chosen)}`, `• Você tem disponível hoje: ${brl(d.cashNow)}`];
  if (d.shortfall > 0) lines.push(`• Faltam: ${brl(d.shortfall)}`);
  if (view.result.balanceAtKeys !== null) lines.push(`• Saldo para financiar nas chaves: ${brl(view.result.balanceAtKeys)}`);
  return lines.join('\n');
}

function capacityBlock(view: PaymentView): string | null {
  const c = view.result.capacity;
  if (!c || !view.result.plan || view.result.plan.monthly.count === 0) return null;
  const lines = [`*Seu orçamento*`, `• Renda familiar considerada: ${brl(c.familyIncome)}`, `• O máximo de mensal que cabe, no limite da construtora: ${brl(c.maxMonthly)}`];
  if (c.incomeCommitment !== null && !view.result.alerts.some((a) => a.code === 'HIGH_INCOME_COMMITMENT')) {
    lines.push(`• Isso usa cerca de ${pct(c.incomeCommitment)} da sua renda, contando as parcelas que você já paga`);
  }
  return lines.join('\n');
}

function bankBlock(view: PaymentView): string | null {
  const est = view.result.bankEstimate;
  const f = est?.selected?.financing ?? null;
  if (!est || !f) return null;
  const block = financingBlock(f, est.selected?.term?.months ?? null, est.alerts.some((a) => a.code === 'HIGH_INCOME_COMMITMENT'));
  return block ? ['*Estimativa do financiamento do saldo nas chaves*', block.split('\n').slice(1).join('\n')].join('\n') : null;
}

function attentionBlock(view: PaymentView): string | null {
  const items = view.result.alerts.map((a) => PAYMENT_ALERT_FOR_LEAD[a.code](a)).filter((t): t is string => t !== null);
  return items.length > 0 ? ['*Pontos de atenção*', ...items.map((t) => `• ${t}`)].join('\n') : null;
}

function helpBlock(view: PaymentView): string | null {
  if (view.result.verdict === 'VIAVEL') return null;
  const items = view.result.suggestions.map((s) => PAYMENT_SUGGESTION_FOR_LEAD[s.code](s));
  return items.length > 0 ? ['*O que pode ajudar*', ...items.map((t) => `• ${t}`)].join('\n') : null;
}

/** Mensagem principal do resultado (uma só, com blocos curtos). */
export function paymentResultMessage(view: PaymentView): string {
  const r = view.result;
  const headline = r.mode === 'A_VISTA' ? HEADLINE.A_VISTA : HEADLINE[r.verdict];
  const blocks: (string | null)[] = [intro(view), headline];
  const reasons = r.reasons.map((x) => PAYMENT_REASON_FOR_LEAD[x]);
  if (reasons.length > 0) blocks.push(reasons.join(' '));
  blocks.push(cashBlock(view), downPaymentBlock(view));
  if (r.plan && r.mode !== 'A_VISTA') blocks.push(planBlock(r.plan, view.input.deliveryDate));
  blocks.push(capacityBlock(view), bankBlock(view), helpBlock(view), attentionBlock(view));
  return blocks.filter((b): b is string => b !== null).join('\n\n');
}

/** Aviso legal da simulação por forma de pagamento: condições comerciais, não crédito. */
export function paymentLegalMessage(generatedAt: Date, illustrative: boolean, hasBankEstimate: boolean): string {
  return [
    `*Importante:* esta simulação é *indicativa* e não é uma proposta nem uma reserva da unidade. Os valores e condições dependem da confirmação da construtora e da disponibilidade da unidade${hasBankEstimate ? ', e o financiamento do saldo depende da análise de crédito do banco' : ''}, e podem mudar sem aviso.`,
    `Simulação gerada em ${dateTimeBr(generatedAt)}.`,
    ...(illustrative ? ['_Condição comercial ILUSTRATIVA (de exemplo), ainda não validada pela construtora._'] : []),
  ].join('\n\n');
}

/** Mensagens do resultado, em ordem de envio: resultado e aviso legal. */
export function paymentResultMessages(view: PaymentView): string[] {
  return [
    paymentResultMessage(view),
    paymentLegalMessage(view.generatedAt, view.result.conditionStatus === 'ILUSTRATIVO', view.result.bankEstimate !== null),
  ];
}
