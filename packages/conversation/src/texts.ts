import { T } from './templates';
import type { FlowEnv } from './types';

// Textos editáveis do bot (V2, D11). Cada texto tem uma chave estável, um padrão no código e as
// variáveis que aceita ({nome}, {empreendimento}...). O FlowConfig publicado sobrepõe o padrão
// chave a chave; sem versão publicada, ou sem a chave, vale o padrão (templates.ts). Textos legais
// (consentimento, aviso da simulação, exclusão de dados) NÃO entram aqui: ficam travados no código.

export const DEFAULT_TEXTS = {
  // Identificação
  ASK_NAME: T.askName,
  ASK_PHONE_CONFIRM: 'Posso usar este número, {telefone}, para o corretor falar com você? (sim/não)',
  ASK_PHONE: T.askPhone,
  ASK_EMAIL: T.askEmail,
  ASK_DEVELOPMENT: 'Qual empreendimento da Elevare você quer conhecer?',
  ASK_INTEREST: 'Qual tipo de unidade do {empreendimento} você procura?',
  // Forma de pagamento (V2)
  ASK_PAYMENT_MODE: 'Como você pensa em pagar o imóvel?',
  ASK_DOWN_CASH: 'Quanto você consegue dar de entrada de uma vez, sem contar o FGTS? Se nada por enquanto, responda *0*.',
  ASK_CASH_NOW: 'Quanto você tem disponível hoje para o ato, que é o primeiro pagamento da entrada? Se nada por enquanto, responda *0*.',
  ASK_DESIRED_INSTALLMENT:
    'E por mês, qual valor você se sente à vontade para pagar na entrada parcelada, até a entrega das chaves? Se não tiver um valor em mente, responda *não sei*.',
  ASK_BALLOONS:
    'Para aliviar as parcelas mensais, a construtora pode incluir reforços, que são parcelas um pouco maiores a cada {intervalo} meses. Você topa? (sim/não)',
  // Perfil financeiro
  ASK_INCOME: T.askIncome,
  ASK_INCOME_TYPE: 'Qual é o seu tipo de renda?',
  ASK_BIRTH: T.askBirth,
  ASK_DEBTS:
    'Hoje você paga alguma parcela todo mês, como financiamento, empréstimo ou cartão parcelado? Se pagar, me diz quanto dá por mês no total. Se não, é só responder *não*.',
  ASK_CO_APPLICANT: T.askCoApplicant,
  ASK_CO_INCOME: T.askCoIncome,
  ASK_CO_INCOME_TYPE: 'E o tipo de renda dela?',
  ASK_CO_BIRTH: T.askCoBirth,
  ASK_CO_DEBTS:
    'E ela paga alguma parcela todo mês, como financiamento, empréstimo ou cartão parcelado? Se pagar, quanto dá por mês no total? Se não, é só responder *não*.',
  ASK_DOWN: T.askDown,
  ASK_INSTALLMENT:
    'Quanto da sua renda por mês você se sente à vontade para destinar à parcela do financiamento? Se não tiver um valor em mente, responda *não sei*.',
  ASK_FGTS: T.askFgts,
  ASK_FGTS_BALANCE: T.askFgtsBalance,
  ASK_FGTS_MONTHS: T.askFgtsMonths,
  ASK_OWNS: T.askOwns,
  ASK_FIRST: T.askFirst,
  // Início pelo formulário do site (double opt-in)
  FIRST_CONTACT:
    'Oi, {nome}! Aqui é a Elevare. Você pediu uma simulação do {empreendimento} no nosso site, certo? Responda *sim* para continuarmos por aqui.',
  CONTACT_CONFIRM_ASK: 'Só para confirmar, {nome}: foi você que pediu uma simulação do {empreendimento} no nosso site? (sim/não)',
  CONTACT_CONFIRMED: 'Perfeito, {nome}! Vou te fazer algumas perguntas rápidas e já te mostro como a conta fica.',
  CONTACT_DECLINED: 'Sem problema, desculpe o incômodo! Não vou mais te escrever.',
  // Resultado
  CASH_OFFER_ASK: 'Quer que um corretor entre em contato agora para combinar o pagamento à vista? (sim/não)',
} as const;

export type TextKey = keyof typeof DEFAULT_TEXTS;
export const TEXT_KEYS = Object.keys(DEFAULT_TEXTS) as TextKey[];

/** Variáveis que o texto aceita; o editor do painel valida que o texto não usa nenhuma outra. */
export function textVariables(key: TextKey): string[] {
  return [...new Set([...DEFAULT_TEXTS[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}

/** Variáveis que o bot sabe preencher em qualquer texto editável. */
export const KNOWN_VARIABLES = ['nome', 'empreendimento', 'telefone', 'intervalo'] as const;

export type TextVars = Partial<Record<(typeof KNOWN_VARIABLES)[number], string | number>>;

function fill(template: string, vars: TextVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = (vars as Record<string, string | number | undefined>)[name];
    return v === undefined ? whole : String(v);
  });
}

/** O texto da chave: o publicado no FlowConfig, ou o padrão do código, com as variáveis preenchidas. */
export function tx(env: Pick<FlowEnv, 'flow'> | undefined, key: TextKey, vars: TextVars = {}): string {
  const custom = env?.flow?.texts?.[key];
  return fill(custom ?? DEFAULT_TEXTS[key], vars);
}

/** Etapa opcional ligada? Sem chave no FlowConfig vale `fallback` (o padrão do código: ligada). */
export function stepOn(env: Pick<FlowEnv, 'flow'> | undefined, step: string, fallback = true): boolean {
  return env?.flow?.optionalSteps?.[step] ?? fallback;
}

/** Mensagem do 1º contato (formulário do site). O FlowConfig tem um campo próprio para ela. */
export function firstContactText(env: Pick<FlowEnv, 'flow'> | undefined, vars: Pick<TextVars, 'nome' | 'empreendimento'>): string {
  return fill(env?.flow?.firstContact ?? DEFAULT_TEXTS.FIRST_CONTACT, vars);
}
