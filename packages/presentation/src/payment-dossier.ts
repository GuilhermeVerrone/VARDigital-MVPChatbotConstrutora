import type { PaymentResult } from '@mvp/simulation';
import { brl, dateTimeBr, joinList, monthYear, pct, phoneBr } from './format';
import { PAYMENT_ALERT_FOR_BROKER, PAYMENT_SUGGESTION_FOR_BROKER } from './payment-phrases';
import { financingBlock } from './lead-message';
import { leadClassFor, type DossierOptions } from './dossier';
import type { PaymentView } from './types';

// Dossiê do corretor para as formas de pagamento (V2): o modo e o plano da entrada. Só fatos e
// números do motor.

const CLASS_HEADER = { HOT: '🔥 LEAD QUENTE', WARM: '🌤️ LEAD MORNO', COLD: '❄️ LEAD FRIO' } as const;
const VERDICT_LABEL = { VIAVEL: '✅ Viável', VIAVEL_COM_AJUSTES: '⚠️ Viável com ajustes', INVIAVEL: '❌ Inviável no momento' } as const;
export const MODE_LABEL: Record<PaymentResult['mode'], string> = {
  A_VISTA: 'Pagamento à vista',
  ENTRADA_A_VISTA: 'Entrada de uma vez + financiamento do saldo',
  ENTRADA_PARCELADA: 'Entrada parcelada com a construtora',
};

function nextStep(view: PaymentView, minutes: number): string {
  const r = view.result;
  if (r.mode === 'A_VISTA') return `Ligar em até ${minutes} min e agendar visita ao stand: o lead quer pagar à vista (${brl(r.cash?.amountToPay ?? r.unitPrice)} com o desconto).`;
  const fixes = r.suggestions.map((s) => PAYMENT_SUGGESTION_FOR_BROKER[s.code](s));
  const talk: string[] = [];
  if (r.mode === 'ENTRADA_PARCELADA' && r.plan) {
    if (r.plan.balloons.count > 0) talk.push('reforços');
    if (r.plan.interestTotal > 0) talk.push('juros e correção das mensais');
  }
  if (r.bankEstimate) talk.push('financiamento do saldo');
  const highlight = talk.length > 0 ? ` Destacar: ${joinList(talk)}.` : '';
  switch (r.verdict) {
    case 'VIAVEL':
      return `Ligar em até ${minutes} min e agendar visita ao stand.${highlight}`;
    case 'VIAVEL_COM_AJUSTES':
      return `Ligar em até ${minutes} min, mostrar como fechar a conta${fixes.length > 0 ? ` (${joinList(fixes)})` : ''} e convidar para visita.${highlight}`;
    case 'INVIAVEL':
      return `Contato consultivo, sem pressão: explicar as alternativas${fixes.length > 0 ? ` (${joinList(fixes)})` : ''} e avaliar outra tipologia.`;
  }
}

export function paymentDossierCard(view: PaymentView, opts: DossierOptions = {}): string {
  const { input, result: r } = view;
  const out: string[] = [];
  if (opts.update) out.push('🔄 SIMULAÇÃO ATUALIZADA: o lead ajustou o plano');
  out.push(`${CLASS_HEADER[leadClassFor(r.verdict)]} — ${VERDICT_LABEL[r.verdict]}`);
  out.push('(classe pelo parecer da simulação; o score numérico configurável vem depois do MVP)');
  if (opts.existingOwner) out.push(`ℹ️ Lead já existia no CRM. Responsável: ${opts.existingOwner}`);

  out.push('', '👤 CLIENTE', [view.leadName ?? 'Nome não informado', view.phone ? phoneBr(view.phone) : null, view.email].filter(Boolean).join(' | '));
  if (input.mode === 'ENTRADA_PARCELADA') {
    const family = input.buyers.reduce((s, b) => s + b.grossMonthlyIncome, 0);
    const debts = input.buyers.reduce((s, b) => s + b.monthlyDebts, 0);
    out.push(`Renda familiar: ${brl(family)} | Compradores: ${input.buyers.length} | Parcelas mensais: ${brl(debts)}`);
  }

  out.push(
    '',
    '🏢 INTERESSE',
    `${view.development.name}${view.unit ? ` | ${view.unit.typology}, unidade ${view.unit.code}` : ''} | Valor: ${brl(r.unitPrice)}`,
  );

  out.push('', '💰 SIMULAÇÃO (indicativa)', `Forma de pagamento: ${MODE_LABEL[r.mode]}`);
  if (r.cash) {
    out.push(`Desconto à vista: ${brl(r.cash.discount)} (${pct(r.cash.discountRatio)}) | Total a pagar: ${brl(r.cash.amountToPay)}`);
  }
  if (r.downPayment) {
    const d = r.downPayment;
    out.push(`Entrada: ${brl(d.chosen)} (faixa ${brl(d.min)} a ${brl(d.max)}) | Disponível hoje: ${brl(d.cashNow)}${d.shortfall > 0 ? ` | Faltam: ${brl(d.shortfall)}` : ''}`);
  }
  if (r.plan && input.mode === 'ENTRADA_PARCELADA') {
    const p = r.plan;
    const parts = [`ato ${brl(p.act)}`];
    if (p.monthly.count > 0) parts.push(`${p.monthly.count}x ${brl(p.monthly.amount)}`);
    if (p.balloons.count > 0) parts.push(`${p.balloons.count} ${p.balloons.count === 1 ? 'reforço' : 'reforços'} de ${brl(p.balloons.amount)} (meses ${joinList(p.balloons.months)})`);
    if (p.keys.amount > 0) parts.push(`chaves ${brl(p.keys.amount)}`);
    out.push(`Plano da entrada: ${parts.join(' + ')}`);
    if (p.interestTotal > 0) out.push(`Juros da construtora: ${brl(p.interestTotal)} | Total pago na entrada: ${brl(p.totalPaid)}`);
    if (p.correction) out.push(`Correção (${p.correction.index}, projeção): entrada iria a ${brl(p.correction.projectedTotal)} (+${brl(p.correction.projectedIncrease)})`);
    out.push(`Entrega prevista: ${monthYear(input.deliveryDate)}`);
    if (r.capacity) {
      out.push(`Mensal máxima pela renda: ${brl(r.capacity.maxMonthly)}${r.capacity.incomeCommitment !== null ? ` | Comprometimento: ${pct(r.capacity.incomeCommitment)}` : ''}`);
    }
    if (input.desiredInstallment !== undefined) out.push(`Mensal desejada: até ${brl(input.desiredInstallment)} | Aceita reforços: ${input.acceptsBalloons ? 'sim' : 'não'}`);
    else out.push(`Aceita reforços: ${input.acceptsBalloons ? 'sim' : 'não'}`);
  }
  if (r.balanceAtKeys !== null) out.push(`Saldo para financiar nas chaves: ${brl(r.balanceAtKeys)}`);
  const f = r.bankEstimate?.selected?.financing ?? null;
  if (r.bankEstimate && f) {
    out.push(`Estimativa do banco (${r.bankEstimate.selected?.lineName}): ${(financingBlock(f, r.bankEstimate.selected?.term?.months ?? null, false) ?? '').split('\n').slice(1).join(' ')}`);
  }
  out.push(`Parecer: ${VERDICT_LABEL[r.verdict]}`);
  out.push(`Condição comercial: ${r.conditionVersion}${r.conditionStatus === 'ILUSTRATIVO' ? ' (ILUSTRATIVA)' : ''} | Gerada em ${dateTimeBr(view.generatedAt)}`);
  if (view.scenario) {
    const ch: string[] = [];
    if (view.scenario.cashNow !== undefined) ch.push(`disponível agora ${brl(view.scenario.cashNow)}`);
    if (view.scenario.acceptsBalloons !== undefined) ch.push(view.scenario.acceptsBalloons ? 'com reforços' : 'sem reforços');
    if (ch.length > 0) out.push(`Cenário do lead: ${ch.join(', ')}`);
  }

  const alerts = r.alerts.map((x) => PAYMENT_ALERT_FOR_BROKER[x.code](x)).filter((t): t is string => t !== null);
  if (alerts.length > 0) out.push('', '⚠️ ALERTAS', ...alerts.map((t) => `• ${t}`));

  out.push('', '🎯 PRÓXIMO PASSO SUGERIDO', nextStep(view, opts.contactWithinMinutes ?? 5));
  out.push('', '📎 PDF da simulação anexo');
  return out.join('\n');
}
