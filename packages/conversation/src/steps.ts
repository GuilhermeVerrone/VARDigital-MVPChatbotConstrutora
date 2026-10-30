import { INCOME_TYPE_OPTIONS, parseOption, parsePhone, parseYesNo, type OptionDef } from '@mvp/parsers';
import type { FieldDef, FieldValue } from '@mvp/llm';
import { brl, formatDateBr, formatPhone, T } from './templates';
import type { Collected, FlowEnv, QuestionState, Reply, StateName } from './types';

type Values = Record<string, FieldValue | null>;

export interface Step {
  fields: readonly FieldDef[];
  question(env: FlowEnv, data: Collected): Reply;
  /** Dica de formato usada quando a resposta não é entendida. */
  hint: string;
  /** Mensagem de erro se o valor entendido não serve (ex.: menor de idade). */
  validate?(values: Values, env: FlowEnv): string | null;
  apply(data: Collected, values: Values, env: FlowEnv): Collected;
  /** Eco curto do que foi anotado. */
  ack?(values: Values, data: Collected): string | null;
  next(data: Collected, env: FlowEnv): StateName;
  /** Tentativa extra antes do interpretador (ex.: o lead digita o telefone em vez de sim/não). */
  preParse?(text: string): Values | null;
  answered(data: Collected): boolean;
}

const text = (t: string): Reply => ({ text: t });
const num = (v: FieldValue | null | undefined): number => v as number;
const str = (v: FieldValue | null | undefined): string => v as string;
const bool = (v: FieldValue | null | undefined): boolean => v as boolean;

const MIN_AGE_YEARS = 18;
const MAX_AGE_YEARS = 100;

function ageYears(birth: string, today: string): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

function birthValidator(key: string) {
  return (v: Values, env: FlowEnv): string | null => {
    const age = ageYears(str(v[key]), env.today);
    if (age < MIN_AGE_YEARS) return T.underage;
    if (age > MAX_AGE_YEARS) return T.tooOld;
    return null;
  };
}

const money = (key: string): FieldDef => ({ key, kind: 'money' });

/** Um "não" seco, em pergunta de valor, vale zero ("tem parcelas?" → "não"). */
const noMeansZero = (key: string) => (t: string): Values | null => (parseYesNo(t) === false ? { [key]: 0 } : null);

const brlAck = (key: string, label: string) => (v: Values) => T.ack(`${label} ${brl(num(v[key]))}`);

export const STEPS: Record<Exclude<QuestionState, 'CONFIRM' | 'CORRECTION_MENU' | 'HANDOFF_OFFER' | 'RESULT' | 'ADJUST_DOWN' | 'ADJUST_TERM'>, Step> = {
  NAME: {
    fields: [{ key: 'name', kind: 'name' }],
    question: () => text(T.askName),
    hint: 'Pode me dizer seu nome e sobrenome? Ex.: Maria Silva',
    apply: (d, v) => ({ ...d, name: str(v.name) }),
    ack: (v) => T.ack(`prazer, ${str(v.name).split(' ')[0]}`),
    next: (_d, env) => (env.channelPhone ? 'PHONE_CONFIRM' : 'PHONE'),
    answered: (d) => d.name !== undefined,
  },
  PHONE_CONFIRM: {
    fields: [{ key: 'use_this_number', kind: 'boolean' }],
    question: (env) => text(T.askPhoneConfirm(formatPhone(env.channelPhone ?? ''))),
    hint: 'Responda *sim* para usar este número, ou digite outro com DDD.',
    // O lead pode responder já com o número que prefere.
    preParse: (t) => {
      const p = parsePhone(t);
      return p ? { phone: p.e164 } : null;
    },
    apply: (d, v, env) => ({ ...d, phone: v.phone !== undefined ? str(v.phone) : (env.channelPhone ?? undefined) }) as Collected,
    next: (d) => (d.phone ? 'EMAIL' : 'PHONE'),
    answered: (d) => d.phone !== undefined,
  },
  PHONE: {
    fields: [{ key: 'phone', kind: 'phone' }],
    question: () => text(T.askPhone),
    hint: 'Informe o DDD e o número. Ex.: (13) 98126-4295',
    apply: (d, v) => ({ ...d, phone: str(v.phone) }),
    ack: (v) => T.ack(`telefone ${formatPhone(str(v.phone))}`),
    next: () => 'EMAIL',
    answered: (d) => d.phone !== undefined,
  },
  EMAIL: {
    fields: [{ key: 'email', kind: 'email', optional: true }],
    question: () => text(T.askEmail),
    hint: 'Informe um e-mail válido (ex.: nome@gmail.com) ou responda *pular*.',
    apply: (d, v) => ({ ...d, email: (v.email as string | null) ?? null }),
    ack: (v) => (v.email ? T.ack(`e-mail ${str(v.email)}`) : null),
    next: () => 'INTEREST',
    answered: (d) => d.email !== undefined,
  },
  INTEREST: {
    fields: [], // preenchido por etapa com as tipologias reais (ver fieldsFor)
    question: (env) => ({ list: { ...T.askInterest(env.developmentName), options: env.typologies.map((t) => t.label) } }),
    hint: 'Responda com o número da opção.',
    apply: (d, v) => ({ ...d, typology: str(v.typology) }),
    ack: (v, d) => T.ack(`interesse em ${d.typology ?? str(v.typology)}`),
    next: () => 'INCOME',
    answered: (d) => d.typology !== undefined,
  },
  INCOME: {
    fields: [money('income')],
    question: () => text(T.askIncome),
    hint: 'Informe o valor mensal. Ex.: 7 mil, 7000 ou R$ 7.000',
    validate: (v) => (num(v.income) > 0 ? null : T.incomeZero),
    apply: (d, v) => ({ ...d, income: num(v.income) }),
    ack: (v) => T.ack(`renda de ${brl(num(v.income))}/mês`),
    next: () => 'INCOME_TYPE',
    answered: (d) => d.income !== undefined,
  },
  INCOME_TYPE: {
    fields: [{ key: 'incomeType', kind: 'option', options: INCOME_TYPE_OPTIONS }],
    question: () => ({ list: { ...T.askIncomeType, options: INCOME_TYPE_OPTIONS.map((o) => o.label) } }),
    hint: 'Responda com o número da opção (1 a 5) ou o nome, ex.: CLT.',
    apply: (d, v) => ({ ...d, incomeType: str(v.incomeType) }),
    next: () => 'BIRTH',
    answered: (d) => d.incomeType !== undefined,
  },
  BIRTH: {
    fields: [{ key: 'birthDate', kind: 'date' }],
    question: () => text(T.askBirth),
    hint: 'Use o formato dia/mês/ano. Ex.: 05/03/1990',
    validate: birthValidator('birthDate'),
    apply: (d, v) => ({ ...d, birthDate: str(v.birthDate) }),
    ack: (v) => T.ack(`nascimento em ${formatDateBr(str(v.birthDate))}`),
    next: () => 'DEBTS',
    answered: (d) => d.birthDate !== undefined,
  },
  DEBTS: {
    fields: [money('debts')],
    question: () => text(T.askDebts),
    preParse: noMeansZero('debts'),
    hint: 'Informe o valor somado das parcelas por mês (ex.: 800) ou *não* se não tiver.',
    apply: (d, v) => ({ ...d, debts: num(v.debts) }),
    ack: (v) => T.ack(num(v.debts) === 0 ? 'sem parcelas mensais' : `parcelas de ${brl(num(v.debts))}/mês`),
    next: () => 'CO_ASK',
    answered: (d) => d.debts !== undefined,
  },
  CO_ASK: {
    fields: [{ key: 'hasCoApplicant', kind: 'boolean' }],
    question: () => text(T.askCoApplicant),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, hasCoApplicant: bool(v.hasCoApplicant) }),
    next: (d) => (d.hasCoApplicant ? 'CO_INCOME' : 'DOWN'),
    answered: (d) => d.hasCoApplicant !== undefined,
  },
  CO_INCOME: {
    fields: [money('coIncome')],
    question: () => text(T.askCoIncome),
    hint: 'Informe o valor mensal. Ex.: 4 mil ou R$ 4.000',
    validate: (v) => (num(v.coIncome) > 0 ? null : T.incomeZero),
    apply: (d, v) => ({ ...d, coIncome: num(v.coIncome) }),
    ack: brlAck('coIncome', 'renda dela de'),
    next: () => 'CO_INCOME_TYPE',
    answered: (d) => d.coIncome !== undefined,
  },
  CO_INCOME_TYPE: {
    fields: [{ key: 'coIncomeType', kind: 'option', options: INCOME_TYPE_OPTIONS }],
    question: () => ({ list: { ...T.askCoIncomeType, options: INCOME_TYPE_OPTIONS.map((o) => o.label) } }),
    hint: 'Responda com o número da opção (1 a 5) ou o nome, ex.: CLT.',
    apply: (d, v) => ({ ...d, coIncomeType: str(v.coIncomeType) }),
    next: () => 'CO_BIRTH',
    answered: (d) => d.coIncomeType !== undefined,
  },
  CO_BIRTH: {
    fields: [{ key: 'coBirthDate', kind: 'date' }],
    question: () => text(T.askCoBirth),
    hint: 'Use o formato dia/mês/ano. Ex.: 05/03/1990',
    validate: birthValidator('coBirthDate'),
    apply: (d, v) => ({ ...d, coBirthDate: str(v.coBirthDate) }),
    next: () => 'CO_DEBTS',
    answered: (d) => d.coBirthDate !== undefined,
  },
  CO_DEBTS: {
    fields: [money('coDebts')],
    question: () => text(T.askCoDebts),
    preParse: noMeansZero('coDebts'),
    hint: 'Informe o valor somado das parcelas por mês (ex.: 500) ou *não*.',
    apply: (d, v) => ({ ...d, coDebts: num(v.coDebts) }),
    next: () => 'DOWN',
    answered: (d) => d.coDebts !== undefined,
  },
  DOWN: {
    fields: [money('downPayment')],
    question: () => text(T.askDown),
    preParse: noMeansZero('downPayment'),
    hint: 'Informe o valor. Ex.: 40 mil, 40000 ou 0 se não tiver agora.',
    apply: (d, v) => ({ ...d, downPayment: num(v.downPayment) }),
    ack: (v) => T.ack(num(v.downPayment) === 0 ? 'sem entrada por enquanto' : `entrada de ${brl(num(v.downPayment))}`),
    next: () => 'FGTS_ASK',
    answered: (d) => d.downPayment !== undefined,
  },
  FGTS_ASK: {
    fields: [{ key: 'hasFgts', kind: 'boolean' }],
    question: () => text(T.askFgts),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, hasFgts: bool(v.hasFgts) }),
    next: (d) => (d.hasFgts ? 'FGTS_BALANCE' : 'OWNS'),
    answered: (d) => d.hasFgts !== undefined,
  },
  FGTS_BALANCE: {
    fields: [money('fgtsBalance')],
    question: () => text(T.askFgtsBalance),
    hint: 'Informe o valor aproximado. Ex.: 15 mil',
    apply: (d, v) => ({ ...d, fgtsBalance: num(v.fgtsBalance) }),
    ack: brlAck('fgtsBalance', 'saldo de FGTS de'),
    next: () => 'FGTS_MONTHS',
    answered: (d) => d.fgtsBalance !== undefined,
  },
  FGTS_MONTHS: {
    fields: [{ key: 'fgtsMonths', kind: 'months' }],
    question: () => text(T.askFgtsMonths),
    hint: 'Diga o tempo com a unidade. Ex.: 3 anos ou 18 meses',
    apply: (d, v) => ({ ...d, fgtsMonths: num(v.fgtsMonths) }),
    next: () => 'OWNS',
    answered: (d) => d.fgtsMonths !== undefined,
  },
  OWNS: {
    fields: [{ key: 'ownsProperty', kind: 'boolean' }],
    question: () => text(T.askOwns),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, ownsProperty: bool(v.ownsProperty) }),
    next: () => 'FIRST',
    answered: (d) => d.ownsProperty !== undefined,
  },
  FIRST: {
    fields: [{ key: 'firstFinancing', kind: 'boolean' }],
    question: () => text(T.askFirst),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, firstFinancing: bool(v.firstFinancing) }),
    next: () => 'CONFIRM',
    answered: (d) => d.firstFinancing !== undefined,
  },
};

export type AnswerState = keyof typeof STEPS;
export const isAnswerState = (s: StateName): s is AnswerState => s in STEPS;

/** Campos da etapa; INTEREST depende das tipologias cadastradas. */
export function fieldsFor(state: AnswerState, env: FlowEnv): readonly FieldDef[] {
  if (state === 'INTEREST') return [{ key: 'typology', kind: 'option', options: env.typologies }];
  return STEPS[state].fields;
}

// ---- Confirmação e correção ----

export function summaryLines(d: Collected, env: FlowEnv): string[] {
  const lines: string[] = [];
  const add = (label: string, v: string | undefined) => v !== undefined && lines.push(`• ${label}: ${v}`);
  add('Nome', d.name);
  add('Telefone', d.phone ? formatPhone(d.phone) : undefined);
  add('E-mail', d.email ?? undefined);
  add('Interesse', env.typologies.find((t) => t.id === d.typology)?.label ?? d.typology);
  add('Renda mensal', d.income !== undefined ? brl(d.income) : undefined);
  add('Tipo de renda', INCOME_TYPE_OPTIONS.find((o) => o.id === d.incomeType)?.label);
  add('Nascimento', d.birthDate ? formatDateBr(d.birthDate) : undefined);
  add('Parcelas mensais', d.debts !== undefined ? brl(d.debts) : undefined);
  if (d.hasCoApplicant) {
    add('Renda de quem compra junto', d.coIncome !== undefined ? brl(d.coIncome) : undefined);
    add('Tipo de renda dela', INCOME_TYPE_OPTIONS.find((o) => o.id === d.coIncomeType)?.label);
    add('Nascimento dela', d.coBirthDate ? formatDateBr(d.coBirthDate) : undefined);
    add('Parcelas dela', d.coDebts !== undefined ? brl(d.coDebts) : undefined);
  }
  add('Entrada', d.downPayment !== undefined ? brl(d.downPayment) : undefined);
  if (d.hasFgts) add('FGTS', `${brl(d.fgtsBalance ?? 0)}, ${d.fgtsMonths ?? 0} meses de carteira`);
  add('Possui imóvel', d.ownsProperty === undefined ? undefined : d.ownsProperty ? 'sim' : 'não');
  add('Primeiro financiamento', d.firstFinancing === undefined ? undefined : d.firstFinancing ? 'sim' : 'não');
  return lines;
}

/** Itens do menu "o que corrigir?"; `id` é a etapa para a qual voltar. */
export function correctionOptions(): OptionDef[] {
  const o = (id: AnswerState, label: string, aliases: string[] = []): OptionDef => ({ id, label, aliases });
  return [
    o('NAME', 'Nome', ['nome', 'meu nome']),
    o('PHONE', 'Telefone', ['telefone', 'celular', 'whatsapp', 'numero', 'zap']),
    o('EMAIL', 'E-mail', ['email', 'e mail']),
    o('INTEREST', 'Tipo de unidade', ['unidade', 'tipologia', 'apartamento', 'interesse', 'quartos']),
    o('INCOME', 'Renda', ['renda', 'salario', 'ganho', 'renda familiar']),
    o('INCOME_TYPE', 'Tipo de renda', ['tipo de renda', 'clt', 'autonomo']),
    o('BIRTH', 'Data de nascimento', ['nascimento', 'idade', 'data de nascimento', 'aniversario']),
    o('DEBTS', 'Parcelas mensais', ['parcelas', 'dividas', 'divida', 'financiamentos', 'emprestimos']),
    o('CO_ASK', 'Quem compra junto', ['junto', 'co proponente', 'conjuge', 'esposa', 'esposo', 'marido', 'companheiro', 'outra pessoa']),
    o('DOWN', 'Entrada', ['entrada', 'sinal']),
    o('FGTS_ASK', 'FGTS', ['fgts']),
    o('OWNS', 'Possui imóvel', ['imovel', 'imovel proprio', 'casa propria']),
    o('FIRST', 'Primeiro financiamento', ['primeiro imovel', 'primeiro financiamento']),
  ];
}

/** Mapeia o que o lead quer corrigir ("renda", "nascimento dela") para uma etapa. */
export function resolveCorrectionTarget(target: string, d: Collected): AnswerState | null {
  const t = target.trim();
  if (d.hasCoApplicant && /\b(dela|dele|junto|conjuge|esposa|esposo|marido|companheir[oa])\b/.test(t)) {
    if (/renda|salario|ganha/.test(t)) return 'CO_INCOME';
    if (/nasc|idade/.test(t)) return 'CO_BIRTH';
    if (/divid|parcela/.test(t)) return 'CO_DEBTS';
  }
  const hit = parseOption(t, correctionOptions());
  return hit ? (hit.id as AnswerState) : null;
}

// ---- Resultado e ajustes (Fase 6) ----

export type ResultChoice = 'down' | 'term' | 'pdf' | 'finish';

/** Menu depois do resultado; `id` é a ação. "Mudar a entrada" também chega aqui como comando "corrigir". */
export function resultOptions(): OptionDef[] {
  return [
    { id: 'down', label: 'Mudar o valor da entrada', aliases: ['entrada', 'mudar entrada', 'sinal', 'mais entrada', 'menos entrada', 'outra entrada'] },
    { id: 'term', label: 'Mudar o prazo', aliases: ['prazo', 'anos', 'meses', 'tempo', 'mais prazo', 'menos prazo'] },
    { id: 'pdf', label: 'Receber o PDF da simulação', aliases: ['pdf', 'receber pdf', 'documento', 'arquivo', 'me manda'] },
    { id: 'finish', label: 'Está ótimo, pode seguir', aliases: ['ok', 'tudo certo', 'esta otimo', 'pode seguir', 'obrigado', 'obrigada', 'valeu', 'perfeito', 'beleza', 'nada', 'so isso', 'era isso'] },
  ];
}
