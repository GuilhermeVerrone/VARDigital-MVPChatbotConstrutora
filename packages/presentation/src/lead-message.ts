import type { FinancingResult } from '@mvp/simulation';
import { ALERT_FOR_LEAD, REASON_FOR_LEAD, SUGGESTION_FOR_LEAD } from './phrases';
import { areaM2, brl, firstName, joinList, monthYear, pct, termText } from './format';
import { legalMessage } from './legal';
import type { SimulationView } from './types';

// Mensagens do resultado ao lead (RF-24, spec §4.8): texto fixo + números do motor. Cordial,
// sem jargão, sem prometer aprovação. O LLM não participa.

const HEADLINE = {
  VIAVEL: '✅ Boa notícia: pelo que você me contou, essa compra cabe no seu perfil.',
  VIAVEL_COM_AJUSTES: '⚠️ Está bem pertinho! Com um pequeno ajuste a conta fecha.',
  INVIAVEL: '❌ Por enquanto essa unidade ainda não fecha com os dados que você me passou, mas dá para pensar em caminhos.',
} as const;

function intro(view: SimulationView): string {
  const name = firstName(view.leadName);
  const who = name ? `${name}, ` : '';
  const unit = view.unit
    ? `o apartamento de *${view.unit.typology}* (unidade ${view.unit.code}, ${areaM2(view.unit.areaM2)}), no valor de ${brl(view.result.propertyValue)}`
    : `um imóvel de ${brl(view.result.propertyValue)}`;
  const scenario = view.scenario;
  const verb = scenario ? 'refiz a simulação' : 'pronto, fiz a simulação';
  const changes: string[] = [];
  if (scenario?.downPayment !== undefined) changes.push(`entrada de ${brl(scenario.downPayment)}`);
  if (scenario?.termMonths !== undefined) changes.push(`prazo de ${termText(scenario.termMonths)}`);
  const tail = changes.length > 0 ? ` Considerei ${joinList(changes)}.` : '';
  return `${who}${verb} do *${view.development.name}* para ${unit}.${tail}`;
}

function financingBlock(f: FinancingResult, termMonths: number | null, highCommitment: boolean): string | null {
  if (!f.firstInstallment) return null;
  const lines: string[] = [f.shortfall > 0 ? '*Se a entrada mínima fosse paga, ficaria assim*' : '*Como ficaria*'];
  lines.push(`• Entrada em dinheiro: ${brl(f.downPaymentUsed)}`);
  if (f.fgtsUsed > 0) lines.push(`• FGTS na entrada: ${brl(f.fgtsUsed)}`);
  if (f.subsidy > 0) lines.push(`• Subsídio estimado: ${brl(f.subsidy)}`);
  lines.push(`• Valor financiado: ${brl(f.financedAmount)}${termMonths ? ` em ${termText(termMonths)}` : ''}`);
  const first = f.firstInstallment.total;
  const last = f.lastInstallment?.total ?? first;
  lines.push(
    f.system === 'SAC'
      ? `• Parcelas (SAC, que diminuem com o tempo): a primeira de ${brl(first)} e a última de ${brl(last)}`
      : `• Parcela (Price, que não muda): ${brl(first)}`,
  );
  // Quando o comprometimento é alto, o aviso em "Pontos de atenção" já diz isso.
  if (f.incomeCommitment !== null && !highCommitment) lines.push(`• Isso usa cerca de ${pct(f.incomeCommitment)} da sua renda, contando as parcelas que você já paga`);
  return lines.join('\n');
}

function constructionBlock(f: FinancingResult, deliveryIso: string | undefined): string | null {
  const c = f.constructionFlow;
  if (!c || !f.firstInstallment) return null;
  const lines: string[] = [`*Durante a obra*${deliveryIso ? ` (entrega prevista para ${monthYear(deliveryIso)})` : ''}`];
  if (c.monthly.count === 0) {
    lines.push(`• Entrada à vista: ${brl(c.signal)}`);
  } else {
    lines.push(`• Sinal: ${brl(c.signal)}`);
    lines.push(`• ${c.monthly.count} parcelas mensais de ${brl(c.monthly.amount)}`);
    if (c.balloons.count > 0) {
      lines.push(`• ${c.balloons.count} ${c.balloons.count === 1 ? 'reforço' : 'reforços'} de ${brl(c.balloons.amount)} (nos meses ${joinList(c.balloons.months)})`);
    }
  }
  lines.push(`• Na entrega das chaves: financiamento de ${brl(c.keys.financed)}`);
  return lines.join('\n');
}

/** Pontos de atenção que o lead precisa saber (alertas sem texto próprio ficam de fora). */
function attentionBlock(view: SimulationView): string | null {
  const items = view.result.alerts.map((a) => ALERT_FOR_LEAD[a.code](a)).filter((t): t is string => t !== null);
  return items.length > 0 ? ['*Pontos de atenção*', ...items.map((t) => `• ${t}`)].join('\n') : null;
}

function shortfallBlock(f: FinancingResult): string | null {
  if (f.shortfall <= 0) return null;
  return `Para esse imóvel, a entrada mínima seria de ${brl(f.requiredDownPayment)}. Você tem ${brl(f.availableDownPayment)} disponível, então faltam ${brl(f.shortfall)}.`;
}

function helpBlock(view: SimulationView): string | null {
  if (view.result.verdict === 'VIAVEL') return null;
  const items = view.result.suggestions.map((s) => SUGGESTION_FOR_LEAD[s.code](s));
  return items.length > 0 ? ['*O que pode ajudar*', ...items.map((t) => `• ${t}`)].join('\n') : null;
}

/** Mensagem principal do resultado (uma só, com blocos curtos). */
export function resultMessage(view: SimulationView): string {
  const r = view.result;
  const f = r.selected?.financing ?? null;
  const blocks: (string | null)[] = [intro(view), HEADLINE[r.verdict]];
  const reasons = r.reasons.map((x) => REASON_FOR_LEAD[x]).filter((t): t is string => t !== undefined);
  if (reasons.length > 0) blocks.push(reasons.join(' '));
  if (f) {
    // Sem capacidade de pagamento ou por idade, "falta de entrada" não é o problema: só ruído.
    const onlyShortfall = !r.reasons.includes('NO_PAYMENT_CAPACITY') && !r.reasons.includes('AGE_LIMIT');
    if (onlyShortfall) blocks.push(shortfallBlock(f));
    blocks.push(financingBlock(f, r.selected?.term?.months ?? null, r.alerts.some((a) => a.code === 'HIGH_INCOME_COMMITMENT')));
    blocks.push(constructionBlock(f, view.input.construction?.deliveryDate));
  }
  blocks.push(helpBlock(view), attentionBlock(view));
  return blocks.filter((b): b is string => b !== null).join('\n\n');
}

/** Mensagens do resultado, em ordem de envio: resultado e aviso legal. */
export function resultMessages(view: SimulationView): string[] {
  return [resultMessage(view), legalMessage(view.generatedAt, view.result.parametersStatus === 'ILUSTRATIVO')];
}
