import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { ALERT_FOR_BROKER, SUGGESTION_FOR_LEAD } from './phrases';
import { ageYears, areaM2, brl, dateBr, dateTimeBr, firstName, INCOME_TYPE_LABEL, joinList, monthYear, pct, termText } from './format';
import { ILLUSTRATIVE_LINE, LEGAL_LINES } from './legal';
import type { PaymentView, SimulationView } from './types';

// PDF simples da simulação (RF-32): uma ou duas páginas, só texto e tabelas, com o aviso legal.
// A identidade visual da construtora é pós-MVP. Fonte padrão (WinAnsi): sem emojis.

export const A4 = { w: 595.28, h: 841.89 };
export const M = 48;
export const INK = rgb(0.12, 0.14, 0.18);
export const MUTED = rgb(0.4, 0.43, 0.48);
export const ACCENT = rgb(0.1, 0.3, 0.55);
export const WARN = rgb(0.72, 0.15, 0.1);

export const VERDICT = { VIAVEL: 'Viável', VIAVEL_COM_AJUSTES: 'Viável com ajustes', INVIAVEL: 'Inviável no momento' } as const;

/** Remove o que a fonte padrão não codifica (emojis, setas), para o PDF nunca falhar por um caractere. */
export const clean = (s: string): string => s.replace(/[^\x20-\x7E\xA1-\xFF–—‘-”•€]/gu, '').replace(/\s+/g, ' ').trim();

export class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.y = A4.h - M;
  }

  private ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of clean(text).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  text(text: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const x = M + (o.indent ?? 0);
    for (const line of this.wrap(text, font, size, A4.w - M - x)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= o.gap ?? 0;
  }

  heading(text: string) {
    this.ensure(30);
    this.y -= 8;
    this.text(text, { size: 12, bold: true, color: ACCENT });
    this.page.drawLine({ start: { x: M, y: this.y + 2 }, end: { x: A4.w - M, y: this.y + 2 }, thickness: 0.6, color: MUTED });
    this.y -= 4;
  }

  row(label: string, value: string) {
    this.ensure(16);
    const size = 10;
    this.page.drawText(clean(label), { x: M, y: this.y - size, size, font: this.font, color: MUTED });
    const lines = this.wrap(value, this.bold, size, A4.w - M - (M + 190));
    for (const [i, line] of lines.entries()) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: M + 190, y: this.y - size, size, font: this.bold, color: INK });
      if (i < lines.length - 1) this.y -= size + 4;
    }
    this.y -= size + 5;
  }
}

/** Gera o PDF da simulação. Os valores vêm só do motor (`view.result`/`view.input`). */
export async function buildSimulationPdf(view: SimulationView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Simulação de financiamento imobiliário');
  doc.setSubject(`${view.development.name} | parâmetros ${view.result.parametersVersion}`);
  doc.setCreator('mvp-chatbot-construtora');
  doc.setProducer('mvp-chatbot-construtora');
  doc.setCreationDate(view.generatedAt);
  doc.setModificationDate(view.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  const { input, result } = view;
  const f = result.selected?.financing ?? null;
  const term = result.selected?.term ?? null;
  const a = input.applicant;
  const co = input.coApplicant;

  w.text('Simulação de financiamento imobiliário', { size: 18, bold: true, color: ACCENT, gap: 2 });
  w.text(`${view.development.name}${view.development.city ? ` - ${view.development.city}` : ''}`, { size: 11, color: MUTED });
  w.text(`Gerada em ${dateTimeBr(view.generatedAt)}${firstName(view.leadName) ? ` para ${firstName(view.leadName)}` : ''}`, { size: 10, color: MUTED });
  if (result.parametersStatus === 'ILUSTRATIVO') w.text(ILLUSTRATIVE_LINE, { size: 10, bold: true, color: WARN });

  w.heading('Imóvel');
  if (view.unit) {
    w.row('Unidade', `${view.unit.code} - ${view.unit.typology}`);
    w.row('Área', areaM2(view.unit.areaM2));
  }
  w.row('Valor do imóvel', brl(result.propertyValue));
  if (input.construction) w.row('Entrega prevista', monthYear(input.construction.deliveryDate));

  w.heading('Perfil informado');
  const family = a.grossMonthlyIncome + (co?.grossMonthlyIncome ?? 0);
  w.row('Renda familiar bruta', `${brl(family)} (${INCOME_TYPE_LABEL[a.incomeType] ?? a.incomeType})`);
  w.row('Idade do proponente', `${ageYears(a.birthDate, input.referenceDate)} anos`);
  w.row('Co-proponente', co ? `sim, renda de ${brl(co.grossMonthlyIncome)}` : 'não');
  w.row('Parcelas mensais já pagas', brl(a.monthlyDebts + (co?.monthlyDebts ?? 0)));
  w.row('Entrada disponível', brl(input.availableDownPayment));
  w.row('FGTS informado', a.fgts ? `${brl(a.fgts.balance)} (${a.fgts.contributionMonths} meses de carteira)` : 'não informado');
  if (view.scenario) {
    const ch: string[] = [];
    if (view.scenario.downPayment !== undefined) ch.push(`entrada de ${brl(view.scenario.downPayment)}`);
    if (view.scenario.termMonths !== undefined) ch.push(`prazo de ${termText(view.scenario.termMonths)}`);
    if (ch.length > 0) w.row('Cenário ajustado', ch.join(' e '));
  }

  w.heading('Resultado');
  w.row('Parecer', VERDICT[result.verdict]);
  if (result.selected && f) {
    w.row('Linha de crédito', result.selected.lineName);
    w.row('Sistema de amortização', f.system === 'SAC' ? 'SAC (parcelas decrescentes)' : 'Price (parcelas fixas)');
    if (term) w.row('Prazo', termText(term.months));
    w.row('Valor financiado', brl(f.financedAmount));
    w.row('Entrada necessária (dinheiro)', brl(f.requiredDownPayment));
    if (f.subsidy > 0) w.row('Subsídio estimado', brl(f.subsidy));
    if (f.fgtsUsed > 0) w.row('FGTS na entrada', brl(f.fgtsUsed));
    if (f.firstInstallment) {
      w.row('1ª parcela', brl(f.firstInstallment.total));
      w.row(f.system === 'SAC' ? 'Última parcela' : 'Parcela final', brl(f.lastInstallment?.total ?? f.firstInstallment.total));
      if (f.incomeCommitment !== null) w.row('Comprometimento da renda', pct(f.incomeCommitment));
    }
    if (f.shortfall > 0) w.row('Falta de entrada', brl(f.shortfall));
  } else {
    w.text('Nenhuma linha de crédito do cadastro se encaixa nesse perfil e valor de imóvel.');
  }

  const c = f?.constructionFlow;
  if (c && f?.firstInstallment) {
    w.heading('Fluxo de pagamento durante a obra');
    w.row(c.monthly.count === 0 ? 'Entrada à vista' : 'Sinal (no ato)', brl(c.signal));
    if (c.monthly.count > 0) w.row('Parcelas mensais', `${c.monthly.count} x ${brl(c.monthly.amount)} (total ${brl(c.monthly.total)})`);
    if (c.balloons.count > 0) {
      w.row('Reforços', `${c.balloons.count} x ${brl(c.balloons.amount)} nos meses ${joinList(c.balloons.months)} (total ${brl(c.balloons.total)})`);
    }
    w.row('Na entrega das chaves', `financiamento de ${brl(c.keys.financed)}`);
    w.text('Parcelas de evolução de obra (juros ao banco durante a obra) não estão incluídas nesta simulação.', { size: 9, color: MUTED });
  }

  const alerts = result.alerts.map((x) => ALERT_FOR_BROKER[x.code](x)).filter((t): t is string => t !== null);
  if (alerts.length > 0) {
    w.heading('Pontos de atenção');
    for (const t of alerts) w.text(`•  ${t}`, { indent: 4 });
  }
  if (result.verdict !== 'VIAVEL' && result.suggestions.length > 0) {
    w.heading('O que pode ajudar');
    for (const s of result.suggestions) w.text(`•  ${SUGGESTION_FOR_LEAD[s.code](s)}`, { indent: 4 });
  }

  w.heading('Aviso legal');
  for (const line of LEGAL_LINES) w.text(line, { size: 10 });
  w.text(`Documento gerado em ${dateTimeBr(view.generatedAt)}. Parâmetros: ${result.parametersVersion}. Data de referência: ${dateBr(result.referenceDate)}.`, { size: 9, color: MUTED });
  if (view.simulationId) w.text(`Referência: ${view.simulationId}`, { size: 8, color: MUTED });

  return doc.save({ useObjectStreams: false });
}

export const pdfFileName = (view: SimulationView | PaymentView): string => {
  const name = (firstName(view.leadName) ?? 'simulacao').normalize('NFD').replace(/[^\w]/g, '').toLowerCase() || 'simulacao';
  return `simulacao-${name}-${view.input.referenceDate}.pdf`;
};

/** Documento e escritor prontos, com os metadados de data fixos (o mesmo PDF sai igual quando refeito). */
export async function openPdf(title: string, subject: string, generatedAt: Date): Promise<{ doc: PDFDocument; w: Writer }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject(subject);
  doc.setCreator('mvp-chatbot-construtora');
  doc.setProducer('mvp-chatbot-construtora');
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, w: new Writer(doc, font, bold) };
}
