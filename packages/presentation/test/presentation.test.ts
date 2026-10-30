import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildSimulationPdf, collectNumbers, dossierCard, legalMessage, resultMessage, resultMessages, unexplainedNumbers } from '../src';
import { baseInput, paramsWithoutSbpe, SCENARIOS, viewFor } from './helpers';

/** Números permitidos: os do motor (entrada + resultado) e os da unidade e do cenário. */
/** `semLinha` usa um cadastro sem a linha SBPE (que não tem limite) para não haver linha elegível. */
const viewOf = (name: string, input: Parameters<typeof viewFor>[0], over = {}) =>
  viewFor(input, over, name === 'semLinha' ? paramsWithoutSbpe : undefined);

const allowedFor = (v: ReturnType<typeof viewFor>) => {
  const set = collectNumbers([v.input, v.result, v.unit, v.scenario]);
  for (const d of v.unit?.code.match(/\d+/g) ?? []) set.add(Number(d)); // "A-101"
  // O que o próprio lead informou (telefone) e o que se deriva do que ele informou (idade).
  for (const d of v.phone?.replace(/^55/, '').match(/^(\d{2})(\d{5})(\d{4})$/)?.slice(1) ?? []) set.add(Number(d));
  for (const p of [v.input.applicant, v.input.coApplicant]) {
    if (p) set.add(Math.floor((Date.parse(v.input.referenceDate) - Date.parse(p.birthDate)) / (365.2425 * 86_400_000)));
  }
  return set;
};

describe('pareceres', () => {
  it('cobrem viável, com ajustes e inviável', () => {
    const verdicts = Object.fromEntries(Object.entries(SCENARIOS).map(([k, i]) => [k, viewOf(k, i).result.verdict]));
    expect(verdicts.viavel).toBe('VIAVEL');
    expect(verdicts.ajustes).toBe('VIAVEL_COM_AJUSTES');
    expect(verdicts.faltaEntrada).toBe('INVIAVEL');
    expect(verdicts.semCapacidade).toBe('INVIAVEL');
    expect(verdicts.semLinha).toBe('INVIAVEL');
    expect(viewOf('semLinha', SCENARIOS.semLinha!).result.selected).toBeNull();
  });
});

describe('mensagem do resultado', () => {
  it('viável: mostra entrada, financiamento, parcelas e fluxo de obra com os números do motor', () => {
    const v = viewFor(SCENARIOS.viavel!);
    const f = v.result.selected!.financing!;
    const msg = resultMessage(v);
    expect(msg).toContain('✅');
    expect(msg).toContain('Maria,');
    expect(msg).toContain(`R$ ${f.financedAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    expect(msg).toContain('Durante a obra');
    expect(msg).toContain('Na entrega das chaves');
    expect(msg).not.toContain('O que pode ajudar');
  });

  it('com ajustes e inviável explicam o que falta e sugerem caminhos, sem prometer aprovação', () => {
    const a = resultMessage(viewFor(SCENARIOS.ajustes!));
    expect(a).toContain('⚠️');
    expect(a).toContain('faltam');
    expect(a).toContain('O que pode ajudar');
    const c = resultMessage(viewFor(SCENARIOS.semCapacidade!));
    expect(c).toContain('❌');
    expect(c).toContain('quitar ou reduzir');
    expect(c).not.toContain('Como ficaria'); // sem parcela calculada
    expect(c).not.toContain('entrada mínima'); // falta de entrada não é o problema aqui
    for (const m of Object.values(SCENARIOS).map((i) => resultMessages(viewFor(i)).join('\n'))) {
      expect(m).not.toMatch(/aprovad[oa] (?!de crédito)|garant/i);
    }
  });

  it('sem linha elegível diz isso com cuidado, sem números de financiamento', () => {
    const m = resultMessage(viewOf('semLinha', SCENARIOS.semLinha!));
    expect(m).toContain('Nenhuma linha de crédito');
    expect(m).not.toContain('Como ficaria');
  });

  it('sem fluxo de obra (empreendimento entregue) não mostra o bloco de obra', () => {
    expect(resultMessage(viewFor(SCENARIOS.semObra!))).not.toContain('Durante a obra');
  });

  it('ajuste de entrada e prazo aparece na abertura', () => {
    const v = viewFor(baseInput({ availableDownPayment: 90000, desiredTermMonths: 300, useFullDownPayment: true }), { scenario: { downPayment: 90000, termMonths: 300 } });
    const msg = resultMessage(v);
    expect(msg).toContain('refiz a simulação');
    expect(msg).toContain('entrada de R$ 90.000');
    expect(msg).toContain('prazo de 300 meses (25 anos)');
  });

  it('o aviso legal vem sempre, com data e hora, e marca parâmetros ilustrativos', () => {
    const [, legal] = resultMessages(viewFor(SCENARIOS.viavel!));
    expect(legal).toContain('indicativa');
    expect(legal).toContain('não é uma aprovação de crédito');
    expect(legal).toContain('29/10/2026 às 12:00'); // 15:00 UTC = 12:00 em São Paulo
    expect(legal).toContain('ILUSTRATIVOS');
    expect(legalMessage(new Date('2026-10-29T15:00:00Z'), false)).not.toContain('ILUSTRATIVOS');
  });
});

describe('nenhum número vem de fora do motor (spec §9.2, §13)', () => {
  for (const [name, input] of Object.entries(SCENARIOS)) {
    it(`${name}: mensagens, dossiê e PDF só mostram números da entrada, do resultado e da unidade`, async () => {
      const view = viewOf(name, input);
      const allowed = allowedFor(view);
      expect(unexplainedNumbers(resultMessages(view).join('\n'), allowed), 'mensagem ao lead').toEqual([]);
      expect(unexplainedNumbers(dossierCard(view), allowed, [5]), 'dossiê (5 = prazo de contato)').toEqual([]);
      expect(unexplainedNumbers(pdfText(await buildSimulationPdf(view)), allowed), 'pdf').toEqual([]);
    });
  }

  it('o auditor pega um número inventado', () => {
    const v = viewFor(SCENARIOS.viavel!);
    const msg = resultMessage(v).replace(/R\$ 219\.000/, 'R$ 219.001');
    expect(unexplainedNumbers(msg, allowedFor(v))).toEqual(['219.001']);
  });
});

describe('dossiê do corretor', () => {
  it('traz cliente, interesse, simulação, alertas e próximo passo', () => {
    const card = dossierCard(viewFor(SCENARIOS.viavel!));
    expect(card).toContain('🔥 LEAD QUENTE');
    expect(card).toContain('(13) 98126-4295');
    expect(card).toContain('Idade: 36');
    expect(card).toContain('Residencial Exemplo');
    expect(card).toContain('Fluxo de obra:');
    expect(card).toContain('Parecer: ✅ Viável');
    expect(card).toContain('Ligar em até 5 min');
    expect(card).toContain('ALERTAS');
    expect(card).toContain('PDF da simulação anexo');
  });

  it('classe pelo parecer, atualização e responsável já existente', () => {
    expect(dossierCard(viewFor(SCENARIOS.ajustes!))).toContain('🌤️ LEAD MORNO');
    expect(dossierCard(viewFor(SCENARIOS.semCapacidade!))).toContain('❄️ LEAD FRIO');
    const up = dossierCard(viewFor(SCENARIOS.viavel!, { scenario: { downPayment: 70000 } }), { update: true, existingOwner: 'Corretora Exemplo Um' });
    expect(up).toContain('SIMULAÇÃO ATUALIZADA');
    expect(up).toContain('Responsável: Corretora Exemplo Um');
    expect(up).toContain('Cenário do lead: entrada R$ 70.000');
  });

  it('co-proponente e renda informal aparecem', () => {
    const card = dossierCard(viewFor(SCENARIOS.coProponente!));
    expect(card).toContain('Co-proponente: sim, renda R$ 4.000 (autônomo)');
    expect(card).toContain('Renda familiar: R$ 11.000');
  });
});

/** Texto de um PDF do pdf-lib: descomprime os streams e lê as strings (hexadecimais, WinAnsi) dos Tj. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
    } catch {
      continue; // stream que não é de conteúdo (fonte, por exemplo)
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1]!, 'hex').toString('latin1'));
  }
  return out.join('\n');
}

describe('PDF', () => {
  it('é um PDF válido com o aviso legal, data e hora e versão dos parâmetros', async () => {
    const v = viewFor(SCENARIOS.viavel!);
    const bytes = await buildSimulationPdf(v);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const text = pdfText(bytes);
    expect(text).toContain('Esta simulação é indicativa e não constitui aprovação de crédito.');
    expect(text).toContain('29/10/2026 às 12:00');
    expect(text).toContain(v.result.parametersVersion);
    expect(text).toContain('ILUSTRATIVOS');
    expect(text).toContain('Fluxo de pagamento durante a obra');
  });

  it('gera para todos os cenários (inclusive sem parcela e sem linha) e nunca falha por emoji ou acento', async () => {
    for (const input of Object.values(SCENARIOS)) {
      const bytes = await buildSimulationPdf(viewFor(input, { leadName: 'Zoë 🏠 D’Ávila' }));
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });
});
