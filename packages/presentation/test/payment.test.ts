import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { illustrativeParameters, illustrativeSalesConditions, simulatePayment, type PaymentInput, type SalesCondition } from '@mvp/simulation';
import { buildPaymentPdf, collectNumbers, paymentDossierCard, paymentResultMessages, pdfFileName, unexplainedNumbers, type PaymentView } from '../src';

const condition: SalesCondition = { ...illustrativeSalesConditions['lumen-urban'], status: 'VALIDADO' };
const financing = {
  applicant: { birthDate: '1990-03-05', grossMonthlyIncome: 9000, incomeType: 'CLT' as const, monthlyDebts: 0, fgts: null },
  coApplicant: null,
  ownsResidentialProperty: false,
  firstFinancing: true,
};
const common = { referenceDate: '2026-11-06', unitPrice: 300000, deliveryDate: '2028-11-06' };

const INPUTS: Record<string, PaymentInput> = {
  aVista: { ...common, mode: 'A_VISTA' },
  entradaViavel: { ...common, mode: 'ENTRADA_A_VISTA', cashNow: 70000, financing },
  entradaFalta: { ...common, mode: 'ENTRADA_A_VISTA', cashNow: 56000 },
  entradaInviavel: { ...common, mode: 'ENTRADA_A_VISTA', cashNow: 10000 },
  parceladaViavel: { ...common, mode: 'ENTRADA_PARCELADA', cashNow: 30000, buyers: [{ grossMonthlyIncome: 9000, monthlyDebts: 0 }], acceptsBalloons: true, desiredInstallment: 2000 },
  parceladaReforcos: { ...common, mode: 'ENTRADA_PARCELADA', cashNow: 6000, buyers: [{ grossMonthlyIncome: 6000, monthlyDebts: 500 }], acceptsBalloons: true },
  parceladaSemReforco: { ...common, mode: 'ENTRADA_PARCELADA', cashNow: 12000, buyers: [{ grossMonthlyIncome: 6000, monthlyDebts: 500 }], acceptsBalloons: false, financing },
  parceladaInviavel: { ...common, mode: 'ENTRADA_PARCELADA', cashNow: 0, buyers: [{ grossMonthlyIncome: 1500, monthlyDebts: 900 }], acceptsBalloons: false },
  entregaProxima: { ...common, deliveryDate: '2026-12-01', mode: 'ENTRADA_PARCELADA', cashNow: 70000, buyers: [{ grossMonthlyIncome: 9000, monthlyDebts: 0 }], acceptsBalloons: true },
};

function viewOf(input: PaymentInput, cond = condition, over: Partial<PaymentView> = {}): PaymentView {
  return {
    kind: 'payment',
    leadName: 'Ana Souza',
    phone: '5511912345678',
    email: 'ana@gmail.com',
    development: { name: 'Lumen Urban', city: 'Santos - SP' },
    unit: { code: 'L-204', typology: '2 quartos', areaM2: 58.4 },
    input,
    result: simulatePayment(input, cond, illustrativeParameters),
    generatedAt: new Date('2026-11-06T15:00:00Z'),
    simulationId: '5f0d6f46-4c3b-4a9e-9d58-0c1f2f2f3c11',
    ...over,
  };
}

/** Números permitidos: os do motor e o que o lead informou (telefone, código da unidade). */
function allowedFor(v: PaymentView) {
  const set = collectNumbers([v.input, v.result, v.unit, v.scenario]);
  for (const d of `${v.unit?.code} ${v.unit?.typology}`.match(/\d+/g) ?? []) set.add(Number(d));
  for (const d of v.phone?.replace(/^55/, '').match(/^(\d{2})(\d{5})(\d{4})$/)?.slice(1) ?? []) set.add(Number(d));
  return set;
}

const emojis = (t: string) => (t.match(/\p{Extended_Pictographic}/gu) ?? []).length;

describe('mensagens do resultado por forma de pagamento', () => {
  it('pareceres: cobre viável, com ajustes e inviável', () => {
    const verdicts = Object.fromEntries(Object.entries(INPUTS).map(([k, i]) => [k, viewOf(i).result.verdict]));
    expect(verdicts.aVista).toBe('VIAVEL');
    expect(verdicts.entradaViavel).toBe('VIAVEL');
    expect(verdicts.entradaFalta).toBe('VIAVEL_COM_AJUSTES');
    expect(verdicts.entradaInviavel).toBe('INVIAVEL');
    expect(verdicts.parceladaViavel).toBe('VIAVEL');
    expect(verdicts.parceladaInviavel).toBe('INVIAVEL');
  });

  it('todo número das mensagens vem do motor ou do que o lead informou', () => {
    for (const [name, input] of Object.entries(INPUTS)) {
      const v = viewOf(input);
      const allowed = allowedFor(v);
      for (const msg of paymentResultMessages(v)) {
        expect(unexplainedNumbers(msg, allowed), `${name}: ${msg}`).toEqual([]);
      }
    }
  });

  it('com condição ILUSTRATIVA e com cenário ajustado, os números continuam explicados', () => {
    const v = viewOf(INPUTS.parceladaViavel!, illustrativeSalesConditions['lumen-urban'], { scenario: { cashNow: 45000, acceptsBalloons: false } });
    const [main, legal] = paymentResultMessages(v);
    expect(legal).toContain('ILUSTRATIVA');
    expect(main).toContain('refiz a simulação');
    expect(main).toContain('R$ 45.000 disponíveis agora');
    for (const m of [main!, legal!]) expect(unexplainedNumbers(m, allowedFor(v))).toEqual([]);
  });

  it('no máximo um emoji por mensagem, sem prometer aprovação', () => {
    for (const input of Object.values(INPUTS)) {
      for (const msg of paymentResultMessages(viewOf(input))) {
        expect(emojis(msg)).toBeLessThanOrEqual(1);
        expect(msg).not.toMatch(/garantid|aprovad[oa] pelo|taxa de \d/i);
      }
    }
  });

  it('à vista mostra o desconto e o total a pagar do motor', () => {
    const v = viewOf(INPUTS.aVista!);
    const msg = paymentResultMessages(v)[0]!;
    expect(msg).toContain('Ana,');
    expect(msg).toContain('Pagamento à vista');
    expect(msg).toContain(`Total a pagar: R$ ${v.result.cash!.amountToPay.toLocaleString('pt-BR')}`);
    expect(msg).not.toContain('Como fica a entrada');
  });

  it('entrada parcelada lista ato, mensais, reforços e saldo; entrega próxima vira pagamento único', () => {
    const msg = paymentResultMessages(viewOf(INPUTS.parceladaReforcos!))[0]!;
    expect(msg).toContain('Como fica a entrada');
    expect(msg).toContain('• Ato, hoje: R$ 9.100');
    expect(msg).toMatch(/• \d+ mensais de R\$/);
    expect(msg).toMatch(/• \d+ reforços? de R\$/);
    expect(msg).toContain('Saldo para financiar nas chaves');
    const near = paymentResultMessages(viewOf(INPUTS.entregaProxima!))[0]!;
    expect(near).toContain('Tudo de uma vez, no ato');
    expect(near).toContain('muito próxima');
  });

  it('inviável explica o motivo e sugere caminhos', () => {
    const msg = paymentResultMessages(viewOf(INPUTS.parceladaInviavel!))[0]!;
    expect(msg).toContain('O que pode ajudar');
    expect(msg).toContain('ainda não fecha');
  });

  it('mostra a estimativa do banco quando ela existe', () => {
    const v = viewOf(INPUTS.entradaViavel!);
    expect(v.result.bankEstimate).not.toBeNull();
    expect(paymentResultMessages(v)[0]).toContain('Estimativa do financiamento do saldo nas chaves');
    expect(paymentResultMessages(viewOf(INPUTS.entradaFalta!))[0]).not.toContain('Estimativa do financiamento');
  });
});

describe('dossiê do corretor por forma de pagamento', () => {
  it('traz o modo, o plano da entrada e o próximo passo', () => {
    const card = paymentDossierCard(viewOf(INPUTS.parceladaViavel!));
    expect(card).toContain('🔥 LEAD QUENTE');
    expect(card).toContain('Forma de pagamento: Entrada parcelada com a construtora');
    expect(card).toContain('Plano da entrada: ato R$ 30.000');
    expect(card).toContain('Aceita reforços: sim');
    expect(card).toContain('PRÓXIMO PASSO SUGERIDO');
    expect(paymentDossierCard(viewOf(INPUTS.aVista!))).toContain('Total a pagar');
    expect(paymentDossierCard(viewOf(INPUTS.entradaInviavel!))).toContain('❄️ LEAD FRIO');
  });

  it('atualização, cenário e condição ilustrativa aparecem', () => {
    const card = paymentDossierCard(viewOf(INPUTS.parceladaViavel!, illustrativeSalesConditions['lumen-urban'], { scenario: { cashNow: 45000 } }), { update: true });
    expect(card).toContain('SIMULAÇÃO ATUALIZADA');
    expect(card).toContain('Cenário do lead: disponível agora R$ 45.000');
    expect(card).toContain('(ILUSTRATIVA)');
  });

  it('todo número do dossiê vem do motor', () => {
    for (const [name, input] of Object.entries(INPUTS)) {
      const v = viewOf(input);
      const allowed = allowedFor(v);
      for (const d of v.phone?.match(/\d+/g) ?? []) allowed.add(Number(d));
      const card = paymentDossierCard(v).replace(v.result.conditionVersion, '');
      expect(unexplainedNumbers(card, allowed, [5, 1]), `${name}\n${card}`).toEqual([]);
    }
  });
});

describe('PDF por forma de pagamento', () => {
  it('gera um PDF válido para cada modo', async () => {
    for (const input of Object.values(INPUTS)) {
      const bytes = await buildPaymentPdf(viewOf(input));
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it('refazer o PDF da mesma simulação dá os mesmos bytes', async () => {
    const a = await buildPaymentPdf(viewOf(INPUTS.parceladaViavel!));
    const b = await buildPaymentPdf(viewOf(INPUTS.parceladaViavel!));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('o nome do arquivo usa o primeiro nome e a data', () => {
    expect(pdfFileName(viewOf(INPUTS.aVista!))).toBe('simulacao-ana-2026-11-06.pdf');
  });
});
