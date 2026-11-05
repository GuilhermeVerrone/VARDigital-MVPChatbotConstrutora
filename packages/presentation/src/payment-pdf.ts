import { ACCENT, MUTED, openPdf, VERDICT, WARN } from './pdf';
import { areaM2, brl, dateBr, dateTimeBr, firstName, joinList, monthYear, pct } from './format';
import { LEGAL_LINES } from './legal';
import { MODE_LABEL } from './payment-dossier';
import { PAYMENT_ALERT_FOR_BROKER, PAYMENT_SUGGESTION_FOR_LEAD } from './payment-phrases';
import type { PaymentView } from './types';

// PDF da simulação por forma de pagamento (V2): o modo, o plano da entrada e o aviso legal. Só os
// números do motor (`view.result`/`view.input`).

export async function buildPaymentPdf(view: PaymentView): Promise<Uint8Array> {
  const { result: r, input } = view;
  const { doc, w } = await openPdf('Simulação de pagamento de imóvel', `${view.development.name} | condição ${r.conditionVersion}`, view.generatedAt);

  w.text('Simulação de pagamento de imóvel', { size: 18, bold: true, color: ACCENT, gap: 2 });
  w.text(`${view.development.name}${view.development.city ? ` - ${view.development.city}` : ''}`, { size: 11, color: MUTED });
  w.text(`Gerada em ${dateTimeBr(view.generatedAt)}${firstName(view.leadName) ? ` para ${firstName(view.leadName)}` : ''}`, { size: 10, color: MUTED });
  if (r.conditionStatus === 'ILUSTRATIVO') w.text('Condição comercial ILUSTRATIVA (de exemplo), ainda não validada pela construtora.', { size: 10, bold: true, color: WARN });

  w.heading('Imóvel');
  if (view.unit) {
    w.row('Unidade', `${view.unit.code} - ${view.unit.typology}`);
    w.row('Área', areaM2(view.unit.areaM2));
  }
  w.row('Valor do imóvel', brl(r.unitPrice));
  w.row('Entrega prevista', monthYear(input.deliveryDate));

  w.heading('Forma de pagamento');
  w.row('Escolhida', MODE_LABEL[r.mode]);
  w.row('Parecer', VERDICT[r.verdict]);
  if (r.cash) {
    if (r.cash.discount > 0) w.row('Desconto à vista', `${brl(r.cash.discount)} (${pct(r.cash.discountRatio)})`);
    w.row('Total a pagar', brl(r.cash.amountToPay));
  }
  if (r.downPayment) {
    const d = r.downPayment;
    w.row('Entrada considerada', brl(d.chosen));
    w.row('Faixa aceita pela construtora', `${brl(d.min)} a ${brl(d.max)}`);
    w.row('Disponível hoje', brl(d.cashNow));
    if (d.shortfall > 0) w.row('Falta para o ato', brl(d.shortfall));
  }
  if (view.scenario) {
    const ch: string[] = [];
    if (view.scenario.cashNow !== undefined) ch.push(`${brl(view.scenario.cashNow)} disponíveis agora`);
    if (view.scenario.acceptsBalloons !== undefined) ch.push(view.scenario.acceptsBalloons ? 'com reforços' : 'sem reforços');
    if (ch.length > 0) w.row('Cenário ajustado', ch.join(' e '));
  }

  if (r.plan && r.mode !== 'A_VISTA') {
    const p = r.plan;
    w.heading('Plano da entrada');
    w.row('Entrada total', brl(p.total));
    w.row(p.monthly.count === 0 && p.balloons.count === 0 ? 'Pagamento no ato' : 'Ato (hoje)', brl(p.act));
    if (p.monthly.count > 0) w.row('Parcelas mensais', `${p.monthly.count} x ${brl(p.monthly.amount)} (total ${brl(p.monthly.total)})`);
    if (p.balloons.count > 0) w.row('Reforços', `${p.balloons.count} x ${brl(p.balloons.amount)} nos meses ${joinList(p.balloons.months)} (total ${brl(p.balloons.total)})`);
    if (p.keys.amount > 0) w.row('Na entrega das chaves', brl(p.keys.amount));
    if (p.interestTotal > 0) {
      w.row('Juros da construtora', brl(p.interestTotal));
      w.row('Total pago na entrada', brl(p.totalPaid));
    }
    if (p.correction) {
      w.row(`Projeção com correção (${p.correction.index})`, `${brl(p.correction.projectedTotal)} (${brl(p.correction.projectedIncrease)} a mais)`);
      w.text('A correção é uma projeção informativa e pode mudar.', { size: 9, color: MUTED });
    }
    if (r.balanceAtKeys !== null) w.row('Saldo a financiar nas chaves', brl(r.balanceAtKeys));
  }

  if (r.capacity) {
    w.heading('Capacidade de pagamento');
    w.row('Renda familiar considerada', brl(r.capacity.familyIncome));
    w.row('Parcelas mensais já pagas', brl(r.capacity.monthlyDebts));
    w.row('Maior mensal que cabe', brl(r.capacity.maxMonthly));
    if (r.capacity.incomeCommitment !== null) w.row('Comprometimento da renda', pct(r.capacity.incomeCommitment));
  }

  const f = r.bankEstimate?.selected?.financing ?? null;
  if (r.bankEstimate && f) {
    w.heading('Estimativa do financiamento do saldo');
    w.row('Linha de crédito', r.bankEstimate.selected?.lineName ?? '');
    w.row('Valor financiado', brl(f.financedAmount));
    if (f.firstInstallment) {
      w.row('1ª parcela', brl(f.firstInstallment.total));
      w.row('Última parcela', brl(f.lastInstallment?.total ?? f.firstInstallment.total));
    }
    w.text('Estimativa sujeita à análise de crédito do banco.', { size: 9, color: MUTED });
  }

  const alerts = r.alerts.map((x) => PAYMENT_ALERT_FOR_BROKER[x.code](x)).filter((t): t is string => t !== null);
  if (alerts.length > 0) {
    w.heading('Pontos de atenção');
    for (const t of alerts) w.text(`•  ${t}`, { indent: 4 });
  }
  if (r.verdict !== 'VIAVEL' && r.suggestions.length > 0) {
    w.heading('O que pode ajudar');
    for (const s of r.suggestions) w.text(`•  ${PAYMENT_SUGGESTION_FOR_LEAD[s.code](s)}`, { indent: 4 });
  }

  w.heading('Aviso legal');
  w.text('Esta simulação é indicativa e não é proposta nem reserva da unidade. Valores e condições dependem da confirmação da construtora e da disponibilidade da unidade.');
  for (const line of LEGAL_LINES.slice(1)) w.text(line, { size: 10 });
  w.text(`Documento gerado em ${dateTimeBr(view.generatedAt)}. Condição comercial: ${r.conditionVersion}. Data de referência: ${dateBr(r.referenceDate)}.`, { size: 9, color: MUTED });
  if (view.simulationId) w.text(`Referência: ${view.simulationId}`, { size: 8, color: MUTED });

  return doc.save({ useObjectStreams: false });
}
