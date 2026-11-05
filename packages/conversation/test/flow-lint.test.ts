import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXTS, TEXT_KEYS, TEXT_META, findForbiddenTerm, flowErrors, lintFlowContent, scanVariables } from '../src';

const errors = (c: Parameters<typeof lintFlowContent>[0]) => flowErrors(lintFlowContent(c)).map((i) => `${i.path}: ${i.message}`);

describe('linter do fluxo', () => {
  it('os textos padrão do código passam limpos (nenhum erro nem aviso)', () => {
    const { FIRST_CONTACT, ...texts } = DEFAULT_TEXTS;
    expect(lintFlowContent({ texts, firstContact: FIRST_CONTACT })).toEqual([]);
  });

  it('toda chave de texto tem nome e grupo na tela', () => {
    for (const k of TEXT_KEYS) expect(TEXT_META[k].label.length).toBeGreaterThan(0);
  });

  it('variável que o bot não preenche não publica, e a mensagem diz quais existem', () => {
    const e = errors({ texts: { ASK_NAME: 'Olá {sobrenome}, qual o seu nome?' } });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/texts\.ASK_NAME.*\{sobrenome\}.*não aceita variáveis/);
    expect(errors({ texts: { CONTACT_CONFIRMED: 'Oi {nome}, sobre o {empreendimento} e {telefone}.' } })[0]).toMatch(/\{telefone\}.*\{nome\}, \{empreendimento\}/);
    expect(errors({ texts: { ASK_NAME: 'Qual o seu nome? {nome' } })).toHaveLength(1);
    expect(errors({ texts: { ASK_NAME: 'Qual {o nome}?' } })[0]).toMatch(/Variável inválida/);
    expect(errors({ texts: { ASK_NAME: 'Qual o nome? }' } })[0]).toMatch(/sem par/);
  });

  it('variáveis válidas e obrigatórias', () => {
    expect(errors({ texts: { CONTACT_CONFIRMED: 'Perfeito, {nome}! Vamos falar do {empreendimento}.' } })).toEqual([]);
    expect(errors({ texts: { ASK_PHONE_CONFIRM: 'Posso usar este número? (sim/não)' } })[0]).toMatch(/precisa conter \{telefone\}/);
    expect(errors({ firstContact: 'Oi, {nome}! Responda *sim* para continuar.' })).toEqual([]);
  });

  it('palavra proibida não publica, com ou sem acento e maiúsculas, mas não pega parte de outra palavra', () => {
    expect(errors({ texts: { ASK_NAME: 'Seu crédito está APROVADO! Qual o seu nome?' } })[0]).toMatch(/proibida: "aprovado"/);
    expect(errors({ texts: { ASK_NAME: 'Aprovação garantida, qual o nome?' } })[0]).toMatch(/proibida/);
    expect(findForbiddenTerm('financiamento sem juros')).toBe('sem juros');
    expect(findForbiddenTerm('Um lucro certo')).toBe('lucro');
    expect(findForbiddenTerm('Reprovado? nunca')).toBeNull();
    expect(findForbiddenTerm('Qual é o seu nome completo?')).toBeNull();
    expect(errors({ firstContact: 'Oi {nome}, simulação garantida do {empreendimento}! (sim/não)' })[0]).toMatch(/firstContact.*garantido/);
  });

  it('texto vazio, longo demais, chave desconhecida e etapa que não liga/desliga', () => {
    expect(errors({ texts: { ASK_NAME: '   ' } })[0]).toMatch(/vazio/);
    expect(errors({ texts: { ASK_NAME: 'a'.repeat(1001) } })[0]).toMatch(/passa de 1000/);
    expect(errors({ texts: { NAO_EXISTE: 'x' } })[0]).toMatch(/desconhecido/);
    expect(errors({ texts: { FIRST_CONTACT: 'x' } })[0]).toMatch(/campo próprio/);
    expect(errors({ optionalSteps: { NAME: false } })[0]).toMatch(/não pode ser ligada/);
    expect(errors({ optionalSteps: { EMAIL: false, BALLOONS: true } })).toEqual([]);
  });

  it('botões: etapa conhecida, sem variável e sem palavra proibida', () => {
    expect(errors({ buttons: { ASK_PAYMENT_MODE: ['À vista', 'Parcelado'] } })).toEqual([]);
    expect(errors({ buttons: { X: ['a'] } })[0]).toMatch(/desconhecida/);
    expect(errors({ buttons: { ASK_PAYMENT_MODE: ['Sem juros'] } })[0]).toMatch(/proibida/);
    expect(errors({ buttons: { ASK_PAYMENT_MODE: ['{nome}'] } })[0]).toMatch(/variáveis/);
  });

  it('pergunta de sim/não sem a instrução de resposta vira aviso (não bloqueia)', () => {
    const issues = lintFlowContent({ texts: { ASK_OWNS: 'Você tem imóvel em seu nome?' } });
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning', path: 'texts.ASK_OWNS' })]);
    expect(flowErrors(issues)).toEqual([]);
  });

  it('scanVariables separa o que foi usado do que está torto', () => {
    expect(scanVariables('{a} e {b} e {a}')).toEqual({ used: ['a', 'b'], stray: false, malformed: [] });
    expect(scanVariables('{a b} {').malformed).toEqual(['{a b}']);
  });
});
