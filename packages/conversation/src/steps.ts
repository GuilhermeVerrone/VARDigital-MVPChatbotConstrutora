import { INCOME_TYPE_OPTIONS, normalize, parseOption, parsePhone, parseYesNo, type OptionDef } from '@mvp/parsers';
import type { FieldDef, FieldValue } from '@mvp/llm';
import { brl, formatDateBr, formatPhone, T } from './templates';
import { stepOn, tx } from './texts';
import type { Collected, DevelopmentInfo, DevelopmentSales, FlowEnv, PaymentModeId, QuestionState, Reply, StateName } from './types';

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
  answered(data: Collected, env: FlowEnv): boolean;
}


// ---- Regras do fluxo por empreendimento (V2) ----

/** O empreendimento da conversa: o escolhido ou, havendo só um, esse. */
export function developmentOf(env: FlowEnv, d: Collected): DevelopmentInfo | undefined {
  return env.developments?.find((x) => x.id === d.developmentId) ?? (env.developments?.length === 1 ? env.developments[0] : undefined);
}

/** Regras comerciais do empreendimento; ausentes = fluxo de financiamento do MVP. */
export const salesOf = (env: FlowEnv, d: Collected): DevelopmentSales | undefined => developmentOf(env, d)?.sales;

/** O lead está no fluxo das formas de pagamento (e não no financiamento do MVP). */
export const isPaymentFlow = (env: FlowEnv, d: Collected): boolean => salesOf(env, d) !== undefined;

/** Estimativa do banco no saldo: ligada na condição e a data de nascimento não foi desligada no painel. */
export const bankEstimateOn = (env: FlowEnv, d: Collected): boolean => Boolean(salesOf(env, d)?.bankEstimate) && stepOn(env, 'BIRTH');

const needsBirth = (env: FlowEnv, d: Collected): boolean => (isPaymentFlow(env, d) ? bankEstimateOn(env, d) : true);
const needsDevelopmentChoice = (env: FlowEnv): boolean => (env.developments?.length ?? 0) > 1;
const typologiesOf = (env: FlowEnv, d: Collected) => developmentOf(env, d)?.typologies ?? env.typologies;

export const PAYMENT_MODE_OPTIONS: Record<PaymentModeId, { label: string; aliases: string[] }> = {
  A_VISTA: { label: 'Pagar à vista', aliases: ['a vista', 'avista', 'pagar a vista', 'pagar tudo', 'tudo de uma vez', 'dinheiro'] },
  ENTRADA_A_VISTA: {
    label: 'Dar a entrada de uma vez e financiar o saldo',
    aliases: ['entrada a vista', 'entrada de uma vez', 'financiar', 'financiamento', 'financiar o saldo', 'financiar o resto'],
  },
  ENTRADA_PARCELADA: {
    label: 'Parcelar a entrada com a construtora',
    aliases: ['entrada parcelada', 'parcelar a entrada', 'parcelada', 'parcelar', 'direto com a construtora', 'entrada em parcelas'],
  },
};

export function paymentModeOptions(env: FlowEnv, d: Collected): OptionDef[] {
  const modes = salesOf(env, d)?.modes ?? [];
  return modes.map((m) => ({ id: m, label: PAYMENT_MODE_OPTIONS[m].label, aliases: PAYMENT_MODE_OPTIONS[m].aliases }));
}

export function developmentOptions(env: FlowEnv): OptionDef[] {
  return (env.developments ?? []).map((x) => {
    const short = x.name.replace(/^(residencial|edif[ií]cio|condom[ií]nio)\s+/i, '');
    return { id: x.id, label: x.name, aliases: short !== x.name ? [short] : [] };
  });
}

// Encadeamento (o que vem depois de cada bloco do fluxo).
const afterPhone = (d: Collected, env: FlowEnv): StateName => (stepOn(env, 'EMAIL') ? 'EMAIL' : afterEmail(d, env));
const afterEmail = (_d: Collected, env: FlowEnv): StateName => (needsDevelopmentChoice(env) ? 'DEVELOPMENT' : 'INTEREST');
/** Fim do bloco de renda/dívidas/co-proponente: o que vem depois depende da forma de pagamento. */
const afterProfile = (d: Collected, env: FlowEnv): StateName => {
  if (!isPaymentFlow(env, d)) return 'DOWN';
  return d.paymentMode === 'ENTRADA_PARCELADA' ? 'CASH_NOW' : 'FGTS_ASK';
};
const afterCoApplicantQuestion = (d: Collected, env: FlowEnv): StateName => (stepOn(env, 'CO_ASK') ? 'CO_ASK' : afterProfile(d, env));
const afterBalloons = (d: Collected, env: FlowEnv): StateName => (bankEstimateOn(env, d) ? 'FGTS_ASK' : 'CONFIRM');
const afterDesired = (d: Collected, env: FlowEnv): StateName => {
  const interval = salesOf(env, d)?.balloonIntervalMonths;
  return interval && stepOn(env, 'BALLOONS') ? 'BALLOONS' : afterBalloons(d, env);
};

/** Desfaz o que dependia de outro empreendimento quando o lead troca de empreendimento. */
const sameDevelopment = (d: Collected, id: string): boolean => d.developmentId === id;

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

/** "não sei", "tanto faz" e parecidos: sem preferência (a simulação usa a capacidade máxima). */
const noInstallmentPreference = (t: string): Values | null =>
  /\b(nao sei|tanto faz|qualquer|sem preferencia|nao tenho (ideia|preferencia)|o que (der|couber)|nao)\b/.test(normalize(t)) ? { desiredInstallment: 0 } : null;

const brlAck = (key: string, label: string) => (v: Values) => T.ack(`${label} ${brl(num(v[key]))}`);

export const STEPS: Record<
  Exclude<
    QuestionState,
    'CONFIRM' | 'CORRECTION_MENU' | 'HANDOFF_OFFER' | 'LGPD_CONFIRM' | 'RESULT' | 'ADJUST_DOWN' | 'ADJUST_TERM'
    | 'CONTACT_CONFIRM' | 'CASH_OFFER' | 'ADJUST_ACT' | 'ADJUST_BALLOONS' | 'ADJUST_UNIT'
  >,
  Step
> = {
  NAME: {
    fields: [{ key: 'name', kind: 'name' }],
    question: (env) => text(tx(env, 'ASK_NAME')),
    hint: 'Pode me dizer seu nome e sobrenome? Ex.: Maria Silva',
    apply: (d, v) => ({ ...d, name: str(v.name) }),
    ack: (v) => `Prazer, ${str(v.name).split(' ')[0]}!`,
    next: (_d, env) => (env.channelPhone ? 'PHONE_CONFIRM' : 'PHONE'),
    answered: (d) => d.name !== undefined,
  },
  PHONE_CONFIRM: {
    fields: [{ key: 'use_this_number', kind: 'boolean' }],
    question: (env) => text(tx(env, 'ASK_PHONE_CONFIRM', { telefone: formatPhone(env.channelPhone ?? '') })),
    hint: 'Responda *sim* para usar este número, ou digite outro com DDD.',
    // O lead pode responder já com o número que prefere.
    preParse: (t) => {
      const p = parsePhone(t);
      return p ? { phone: p.e164 } : null;
    },
    apply: (d, v, env) => ({ ...d, phone: v.phone !== undefined ? str(v.phone) : (env.channelPhone ?? undefined) }) as Collected,
    next: (d, env) => (d.phone ? afterPhone(d, env) : 'PHONE'),
    answered: (d) => d.phone !== undefined,
  },
  PHONE: {
    fields: [{ key: 'phone', kind: 'phone' }],
    question: (env) => text(tx(env, 'ASK_PHONE')),
    hint: 'Informe o DDD e o número. Ex.: (11) 91234-5678',
    apply: (d, v) => ({ ...d, phone: str(v.phone) }),
    ack: (v) => T.ack(`telefone ${formatPhone(str(v.phone))}`),
    next: (d, env) => afterPhone(d, env),
    answered: (d) => d.phone !== undefined,
  },
  EMAIL: {
    fields: [{ key: 'email', kind: 'email', optional: true }],
    question: (env) => text(tx(env, 'ASK_EMAIL')),
    hint: 'Informe um e-mail válido (ex.: nome@gmail.com) ou responda *pular*.',
    apply: (d, v) => ({ ...d, email: (v.email as string | null) ?? null }),
    ack: (v) => (v.email ? T.ack(`e-mail ${str(v.email)}`) : null),
    next: (d, env) => afterEmail(d, env),
    answered: (d) => d.email !== undefined,
  },
  DEVELOPMENT: {
    fields: [], // as opções são os empreendimentos ativos (ver fieldsFor)
    question: (env) => ({ list: { title: tx(env, 'ASK_DEVELOPMENT'), options: developmentOptions(env).map((o) => o.label), footer: 'Responda com o número.' } }),
    hint: 'Responda com o número da opção ou o nome do empreendimento.',
    apply: (d, v) => {
      const id = str(v.developmentId);
      if (sameDevelopment(d, id)) return d;
      // Outro empreendimento tem outras tipologias e outras formas de pagamento: pergunta de novo.
      const rest = { ...d, developmentId: id };
      delete rest.typology;
      delete rest.paymentMode;
      return rest;
    },
    next: () => 'INTEREST',
    answered: (d, env) => d.developmentId !== undefined || !needsDevelopmentChoice(env),
  },
  INTEREST: {
    fields: [], // preenchido por etapa com as tipologias reais (ver fieldsFor)
    question: (env, d) => ({
      list: {
        title: tx(env, 'ASK_INTEREST', { empreendimento: developmentOf(env, d)?.name ?? env.developmentName }),
        footer: 'Responda com o número.',
        options: typologiesOf(env, d).map((t) => t.label),
      },
    }),
    hint: 'Responda com o número da opção.',
    apply: (d, v) => ({ ...d, typology: str(v.typology) }),
    ack: (v, d) => T.ack(`interesse em ${d.typology ?? str(v.typology)}`),
    next: (d, env) => (isPaymentFlow(env, d) ? 'PAYMENT_MODE' : 'INCOME'),
    answered: (d) => d.typology !== undefined,
  },
  PAYMENT_MODE: {
    fields: [], // as opções são as formas de pagamento da condição vigente (ver fieldsFor)
    question: (env, d) => ({
      list: {
        title: tx(env, 'ASK_PAYMENT_MODE'),
        options: paymentModeOptions(env, d).map((o) => o.label),
        footer: 'Responda com o número.',
      },
    }),
    hint: 'Responda com o número da opção (ou diga, por exemplo, "parcelar a entrada").',
    apply: (d, v) => ({ ...d, paymentMode: str(v.paymentMode) as PaymentModeId }),
    next: (d) => (d.paymentMode === 'A_VISTA' ? 'CONFIRM' : d.paymentMode === 'ENTRADA_A_VISTA' ? 'DOWN_CASH' : 'INCOME'),
    answered: (d) => d.paymentMode !== undefined,
  },
  INCOME: {
    fields: [money('income')],
    question: (env) => text(tx(env, 'ASK_INCOME')),
    hint: 'Informe o valor mensal. Ex.: 7 mil, 7000 ou R$ 7.000',
    validate: (v) => (num(v.income) > 0 ? null : T.incomeZero),
    apply: (d, v) => ({ ...d, income: num(v.income) }),
    ack: (v) => T.ack(`renda de ${brl(num(v.income))}/mês`),
    next: () => 'INCOME_TYPE',
    answered: (d) => d.income !== undefined,
  },
  INCOME_TYPE: {
    fields: [{ key: 'incomeType', kind: 'option', options: INCOME_TYPE_OPTIONS }],
    question: (env) => ({ list: { title: tx(env, 'ASK_INCOME_TYPE'), footer: 'Responda com o número.', options: INCOME_TYPE_OPTIONS.map((o) => o.label) } }),
    hint: 'Responda com o número da opção (1 a 5) ou o nome, ex.: CLT.',
    apply: (d, v) => ({ ...d, incomeType: str(v.incomeType) }),
    next: (d, env) => (needsBirth(env, d) ? 'BIRTH' : 'DEBTS'),
    answered: (d) => d.incomeType !== undefined,
  },
  BIRTH: {
    fields: [{ key: 'birthDate', kind: 'date' }],
    question: (env) => text(tx(env, 'ASK_BIRTH')),
    hint: 'Use o formato dia/mês/ano. Ex.: 05/03/1990',
    validate: birthValidator('birthDate'),
    apply: (d, v) => ({ ...d, birthDate: str(v.birthDate) }),
    ack: (v) => T.ack(`nascimento em ${formatDateBr(str(v.birthDate))}`),
    next: () => 'DEBTS',
    answered: (d) => d.birthDate !== undefined,
  },
  DEBTS: {
    fields: [money('debts')],
    question: (env) => text(tx(env, 'ASK_DEBTS')),
    preParse: noMeansZero('debts'),
    hint: 'Informe o valor somado das parcelas por mês (ex.: 800) ou *não* se não tiver.',
    apply: (d, v) => ({ ...d, debts: num(v.debts) }),
    ack: (v) => T.ack(num(v.debts) === 0 ? 'sem parcelas mensais' : `parcelas de ${brl(num(v.debts))}/mês`),
    next: (d, env) => afterCoApplicantQuestion(d, env),
    answered: (d) => d.debts !== undefined,
  },
  CO_ASK: {
    fields: [{ key: 'hasCoApplicant', kind: 'boolean' }],
    question: (env) => text(tx(env, 'ASK_CO_APPLICANT')),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, hasCoApplicant: bool(v.hasCoApplicant) }),
    next: (d, env) => (d.hasCoApplicant ? 'CO_INCOME' : afterProfile(d, env)),
    answered: (d) => d.hasCoApplicant !== undefined,
  },
  CO_INCOME: {
    fields: [money('coIncome')],
    question: (env) => text(tx(env, 'ASK_CO_INCOME')),
    hint: 'Informe o valor mensal. Ex.: 4 mil ou R$ 4.000',
    validate: (v) => (num(v.coIncome) > 0 ? null : T.incomeZero),
    apply: (d, v) => ({ ...d, coIncome: num(v.coIncome) }),
    ack: brlAck('coIncome', 'renda dela de'),
    next: () => 'CO_INCOME_TYPE',
    answered: (d) => d.coIncome !== undefined,
  },
  CO_INCOME_TYPE: {
    fields: [{ key: 'coIncomeType', kind: 'option', options: INCOME_TYPE_OPTIONS }],
    question: (env) => ({ list: { title: tx(env, 'ASK_CO_INCOME_TYPE'), footer: 'Responda com o número.', options: INCOME_TYPE_OPTIONS.map((o) => o.label) } }),
    hint: 'Responda com o número da opção (1 a 5) ou o nome, ex.: CLT.',
    apply: (d, v) => ({ ...d, coIncomeType: str(v.coIncomeType) }),
    next: (d, env) => (needsBirth(env, d) ? 'CO_BIRTH' : 'CO_DEBTS'),
    answered: (d) => d.coIncomeType !== undefined,
  },
  CO_BIRTH: {
    fields: [{ key: 'coBirthDate', kind: 'date' }],
    question: (env) => text(tx(env, 'ASK_CO_BIRTH')),
    hint: 'Use o formato dia/mês/ano. Ex.: 05/03/1990',
    validate: birthValidator('coBirthDate'),
    apply: (d, v) => ({ ...d, coBirthDate: str(v.coBirthDate) }),
    next: () => 'CO_DEBTS',
    answered: (d) => d.coBirthDate !== undefined,
  },
  CO_DEBTS: {
    fields: [money('coDebts')],
    question: (env) => text(tx(env, 'ASK_CO_DEBTS')),
    preParse: noMeansZero('coDebts'),
    hint: 'Informe o valor somado das parcelas por mês (ex.: 500) ou *não*.',
    apply: (d, v) => ({ ...d, coDebts: num(v.coDebts) }),
    next: (d, env) => afterProfile(d, env),
    answered: (d) => d.coDebts !== undefined,
  },
  DOWN: {
    fields: [money('downPayment')],
    question: (env) => text(tx(env, 'ASK_DOWN')),
    preParse: noMeansZero('downPayment'),
    hint: 'Informe o valor. Ex.: 40 mil, 40000 ou 0 se não tiver agora.',
    apply: (d, v) => ({ ...d, downPayment: num(v.downPayment) }),
    ack: (v) => T.ack(num(v.downPayment) === 0 ? 'sem entrada por enquanto' : `entrada de ${brl(num(v.downPayment))}`),
    next: () => 'INSTALLMENT',
    answered: (d) => d.downPayment !== undefined,
  },
  INSTALLMENT: {
    fields: [money('desiredInstallment')],
    question: (env) => text(tx(env, 'ASK_INSTALLMENT')),
    // "não sei" e parecidos: sem preferência (a simulação usa a capacidade máxima).
    preParse: noInstallmentPreference,
    hint: 'Informe o valor da parcela mensal que você gostaria de pagar. Ex.: 2000. Se não tiver um valor em mente, responda *não sei*.',
    apply: (d, v) => ({ ...d, desiredInstallment: num(v.desiredInstallment) }),
    ack: (v) => T.ack(num(v.desiredInstallment) === 0 ? 'sem parcela definida' : `parcela de até ${brl(num(v.desiredInstallment))}/mês`),
    next: () => 'FGTS_ASK',
    answered: (d) => d.desiredInstallment !== undefined,
  },
  DOWN_CASH: {
    fields: [money('cashNow')],
    question: (env) => text(tx(env, 'ASK_DOWN_CASH')),
    preParse: noMeansZero('cashNow'),
    hint: 'Informe o valor. Ex.: 40 mil, 40000 ou 0 se não tiver agora.',
    apply: (d, v) => ({ ...d, cashNow: num(v.cashNow) }),
    ack: (v) => T.ack(num(v.cashNow) === 0 ? 'sem entrada por enquanto' : `entrada de ${brl(num(v.cashNow))}`),
    next: (d, env) => (bankEstimateOn(env, d) ? 'INCOME' : 'CONFIRM'),
    answered: (d) => d.cashNow !== undefined,
  },
  CASH_NOW: {
    fields: [money('cashNow')],
    question: (env) => text(tx(env, 'ASK_CASH_NOW')),
    preParse: noMeansZero('cashNow'),
    hint: 'Informe o valor. Ex.: 30 mil, 30000 ou 0 se não tiver agora.',
    apply: (d, v) => ({ ...d, cashNow: num(v.cashNow) }),
    ack: (v) => T.ack(num(v.cashNow) === 0 ? 'sem dinheiro para o ato por enquanto' : `${brl(num(v.cashNow))} disponíveis para o ato`),
    next: (d, env) => (stepOn(env, 'DESIRED_INSTALLMENT') ? 'DESIRED_INSTALLMENT' : afterDesired(d, env)),
    answered: (d) => d.cashNow !== undefined,
  },
  DESIRED_INSTALLMENT: {
    fields: [money('desiredInstallment')],
    question: (env) => text(tx(env, 'ASK_DESIRED_INSTALLMENT')),
    preParse: noInstallmentPreference,
    hint: 'Informe o valor da parcela mensal que você gostaria de pagar. Ex.: 2000. Se não tiver um valor em mente, responda *não sei*.',
    apply: (d, v) => ({ ...d, desiredInstallment: num(v.desiredInstallment) }),
    ack: (v) => T.ack(num(v.desiredInstallment) === 0 ? 'sem parcela definida' : `parcela de até ${brl(num(v.desiredInstallment))}/mês`),
    next: (d, env) => afterDesired(d, env),
    answered: (d) => d.desiredInstallment !== undefined,
  },
  BALLOONS: {
    fields: [{ key: 'acceptsBalloons', kind: 'boolean' }],
    question: (env, d) => text(tx(env, 'ASK_BALLOONS', { intervalo: salesOf(env, d)?.balloonIntervalMonths ?? 6 })),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, acceptsBalloons: bool(v.acceptsBalloons) }),
    ack: (v) => T.ack(bool(v.acceptsBalloons) ? 'pode ter reforços' : 'sem reforços'),
    next: (d, env) => afterBalloons(d, env),
    answered: (d) => d.acceptsBalloons !== undefined,
  },
  FGTS_ASK: {
    fields: [{ key: 'hasFgts', kind: 'boolean' }],
    question: (env) => text(tx(env, 'ASK_FGTS')),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, hasFgts: bool(v.hasFgts) }),
    next: (d) => (d.hasFgts ? 'FGTS_BALANCE' : 'OWNS'),
    answered: (d) => d.hasFgts !== undefined,
  },
  FGTS_BALANCE: {
    fields: [money('fgtsBalance')],
    question: (env) => text(tx(env, 'ASK_FGTS_BALANCE')),
    hint: 'Informe o valor aproximado. Ex.: 15 mil',
    apply: (d, v) => ({ ...d, fgtsBalance: num(v.fgtsBalance) }),
    ack: brlAck('fgtsBalance', 'saldo de FGTS de'),
    next: () => 'FGTS_MONTHS',
    answered: (d) => d.fgtsBalance !== undefined,
  },
  FGTS_MONTHS: {
    fields: [{ key: 'fgtsMonths', kind: 'months' }],
    question: (env) => text(tx(env, 'ASK_FGTS_MONTHS')),
    hint: 'Diga o tempo com a unidade. Ex.: 3 anos ou 18 meses',
    apply: (d, v) => ({ ...d, fgtsMonths: num(v.fgtsMonths) }),
    next: () => 'OWNS',
    answered: (d) => d.fgtsMonths !== undefined,
  },
  OWNS: {
    fields: [{ key: 'ownsProperty', kind: 'boolean' }],
    question: (env) => text(tx(env, 'ASK_OWNS')),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, ownsProperty: bool(v.ownsProperty) }),
    next: () => 'FIRST',
    answered: (d) => d.ownsProperty !== undefined,
  },
  FIRST: {
    fields: [{ key: 'firstFinancing', kind: 'boolean' }],
    question: (env) => text(tx(env, 'ASK_FIRST')),
    hint: 'Responda *sim* ou *não*.',
    apply: (d, v) => ({ ...d, firstFinancing: bool(v.firstFinancing) }),
    next: () => 'CONFIRM',
    answered: (d) => d.firstFinancing !== undefined,
  },
};

export type AnswerState = keyof typeof STEPS;
export const isAnswerState = (s: StateName): s is AnswerState => s in STEPS;

/** Campos da etapa; INTEREST depende das tipologias cadastradas. */
export function fieldsFor(state: AnswerState, env: FlowEnv, data: Collected = {}): readonly FieldDef[] {
  if (state === 'INTEREST') return [{ key: 'typology', kind: 'option', options: typologiesOf(env, data) }];
  if (state === 'DEVELOPMENT') return [{ key: 'developmentId', kind: 'option', options: developmentOptions(env) }];
  if (state === 'PAYMENT_MODE') return [{ key: 'paymentMode', kind: 'option', options: paymentModeOptions(env, data) }];
  return STEPS[state].fields;
}

// ---- Confirmação e correção ----

const MODE_LABEL_SHORT: Record<PaymentModeId, string> = {
  A_VISTA: 'à vista',
  ENTRADA_A_VISTA: 'entrada de uma vez e financiamento do saldo',
  ENTRADA_PARCELADA: 'entrada parcelada com a construtora',
};

export function summaryLines(d: Collected, env: FlowEnv): string[] {
  const lines: string[] = [];
  const add = (label: string, v: string | undefined) => v !== undefined && lines.push(`• ${label}: ${v}`);
  const v2 = isPaymentFlow(env, d);
  add('Nome', d.name);
  add('Telefone', d.phone ? formatPhone(d.phone) : undefined);
  add('E-mail', d.email ?? undefined);
  if (needsDevelopmentChoice(env)) add('Empreendimento', developmentOf(env, d)?.name);
  add('Interesse', typologiesOf(env, d).find((t) => t.id === d.typology)?.label ?? d.typology);
  if (v2) add('Forma de pagamento', d.paymentMode ? MODE_LABEL_SHORT[d.paymentMode] : undefined);
  const noProfile = v2 && d.income === undefined;
  if (!noProfile) {
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
  }
  if (v2) {
    if (d.paymentMode && d.paymentMode !== 'A_VISTA') {
      add(d.paymentMode === 'ENTRADA_PARCELADA' ? 'Disponível hoje para o ato' : 'Entrada de uma vez', d.cashNow !== undefined ? brl(d.cashNow) : undefined);
    }
    if (d.paymentMode === 'ENTRADA_PARCELADA') {
      add('Parcela mensal desejada', d.desiredInstallment === undefined ? undefined : d.desiredInstallment === 0 ? 'sem preferência' : `até ${brl(d.desiredInstallment)}/mês`);
      if (salesOf(env, d)?.balloonIntervalMonths) add('Reforços', d.acceptsBalloons === undefined ? undefined : d.acceptsBalloons ? 'aceita' : 'não aceita');
    }
  } else {
    add('Entrada', d.downPayment !== undefined ? brl(d.downPayment) : undefined);
    add('Parcela desejada', d.desiredInstallment === undefined ? undefined : d.desiredInstallment === 0 ? 'sem preferência' : `até ${brl(d.desiredInstallment)}/mês`);
  }
  if (d.hasFgts) add('FGTS', `${brl(d.fgtsBalance ?? 0)}, ${d.fgtsMonths ?? 0} meses de carteira`);
  if (!noProfile) {
    add('Possui imóvel', d.ownsProperty === undefined ? undefined : d.ownsProperty ? 'sim' : 'não');
    add('Primeiro financiamento', d.firstFinancing === undefined ? undefined : d.firstFinancing ? 'sim' : 'não');
  }
  return lines;
}

/** Itens do menu "o que corrigir?"; `id` é a etapa para a qual voltar. */
export function correctionOptions(d?: Collected, env?: FlowEnv): OptionDef[] {
  const o = (id: AnswerState, label: string, aliases: string[] = []): OptionDef => ({ id, label, aliases });
  const all = [
    o('NAME', 'Nome', ['nome', 'meu nome']),
    o('PHONE', 'Telefone', ['telefone', 'celular', 'whatsapp', 'numero', 'zap']),
    o('EMAIL', 'E-mail', ['email', 'e mail']),
    o('DEVELOPMENT', 'Empreendimento', ['empreendimento', 'predio', 'residencial', 'projeto']),
    o('INTEREST', 'Tipo de unidade', ['unidade', 'tipologia', 'apartamento', 'interesse', 'quartos']),
    o('PAYMENT_MODE', 'Forma de pagamento', ['forma de pagamento', 'pagamento', 'a vista', 'financiar', 'parcelar']),
    o('INCOME', 'Renda', ['renda', 'salario', 'ganho', 'renda familiar']),
    o('INCOME_TYPE', 'Tipo de renda', ['tipo de renda', 'clt', 'autonomo']),
    o('BIRTH', 'Data de nascimento', ['nascimento', 'idade', 'data de nascimento', 'aniversario']),
    o('DEBTS', 'Parcelas mensais', ['parcelas', 'dividas', 'divida', 'financiamentos', 'emprestimos']),
    o('CO_ASK', 'Quem compra junto', ['junto', 'co proponente', 'conjuge', 'esposa', 'esposo', 'marido', 'companheiro', 'outra pessoa']),
    o('DOWN', 'Entrada', ['entrada', 'sinal']),
    o('DOWN_CASH', 'Entrada de uma vez', ['entrada', 'sinal', 'quanto tenho']),
    o('CASH_NOW', 'Dinheiro para o ato', ['ato', 'entrada', 'sinal', 'quanto tenho', 'disponivel']),
    o('DESIRED_INSTALLMENT', 'Parcela mensal desejada', ['parcela desejada', 'valor da parcela', 'quanto pagar', 'parcela mensal', 'mensal']),
    o('BALLOONS', 'Reforços', ['reforco', 'reforcos', 'intermediaria', 'intermediarias', 'balao']),
    o('INSTALLMENT', 'Parcela desejada', ['parcela desejada', 'valor da parcela', 'quanto pagar', 'parcela mensal']),
    o('FGTS_ASK', 'FGTS', ['fgts']),
    o('OWNS', 'Possui imóvel', ['imovel', 'imovel proprio', 'casa propria']),
    o('FIRST', 'Primeiro financiamento', ['primeiro imovel', 'primeiro financiamento']),
  ];
  // Só os itens que o lead de fato respondeu no caminho dele (as opções variam por forma de pagamento).
  const onPath = d && env ? answeredPath(d, env) : null;
  return all.filter((x) => (onPath ? onPath.has(x.id as AnswerState) : legacyCorrectionIds.has(x.id as AnswerState)));
}

const legacyCorrectionIds = new Set<AnswerState>([
  'NAME', 'PHONE', 'EMAIL', 'INTEREST', 'INCOME', 'INCOME_TYPE', 'BIRTH', 'DEBTS', 'CO_ASK', 'DOWN', 'INSTALLMENT', 'FGTS_ASK', 'OWNS', 'FIRST',
]);

/** As etapas que a conversa percorre (de NAME até a confirmação) para estes dados, no fluxo das formas de pagamento. */
function answeredPath(d: Collected, env: FlowEnv): Set<AnswerState> | null {
  if (!isPaymentFlow(env, d)) return null;
  const path = new Set<AnswerState>();
  let s: StateName = 'NAME';
  for (let i = 0; i < 40 && isAnswerState(s); i++) {
    // PHONE e PHONE_CONFIRM são o mesmo item do menu.
    path.add(s === 'PHONE_CONFIRM' ? 'PHONE' : s);
    s = STEPS[s].next(d, env);
  }
  // Etapas que o lead pulou por já virem do formulário continuam corrigíveis.
  return path;
}

/** Mapeia o que o lead quer corrigir ("renda", "nascimento dela") para uma etapa. */
export function resolveCorrectionTarget(target: string, d: Collected, env?: FlowEnv): AnswerState | null {
  const t = target.trim();
  if (d.hasCoApplicant && /\b(dela|dele|junto|conjuge|esposa|esposo|marido|companheir[oa])\b/.test(t)) {
    if (/renda|salario|ganha/.test(t)) return 'CO_INCOME';
    if (/nasc|idade/.test(t)) return 'CO_BIRTH';
    if (/divid|parcela/.test(t)) return 'CO_DEBTS';
  }
  const hit = parseOption(t, correctionOptions(d, env));
  return hit ? (hit.id as AnswerState) : null;
}

// ---- Resultado e ajustes (Fase 6 e V2) ----

export type ResultChoice = 'down' | 'term' | 'act' | 'balloons' | 'unit' | 'mode' | 'human' | 'pdf' | 'finish';

const FINISH: OptionDef = {
  id: 'finish', label: 'Está ótimo, pode seguir',
  aliases: ['ok', 'tudo certo', 'esta otimo', 'pode seguir', 'obrigado', 'obrigada', 'valeu', 'perfeito', 'beleza', 'nada', 'so isso', 'era isso'],
};
const PDF: OptionDef = { id: 'pdf', label: 'Receber o PDF da simulação', aliases: ['pdf', 'receber pdf', 'documento', 'arquivo', 'me manda'] };
const UNIT: OptionDef = { id: 'unit', label: 'Ver outro tipo de unidade', aliases: ['outra unidade', 'outro apartamento', 'outro tipo', 'trocar unidade', 'unidade', 'tipologia'] };
const MODE: OptionDef = { id: 'mode', label: 'Ver outra forma de pagamento', aliases: ['outra forma', 'outro pagamento', 'forma de pagamento', 'trocar pagamento', 'pagar de outro jeito'] };
const HUMAN: OptionDef = { id: 'human', label: 'Falar com um corretor', aliases: ['corretor', 'falar com corretor', 'atendente', 'pessoa', 'humano'] };

/**
 * Menu depois do resultado; `id` é a ação. No fluxo do MVP (financiamento) são entrada e prazo; nas
 * formas de pagamento da V2 o menu muda com a forma escolhida. "Mudar a entrada" também chega aqui
 * como comando "corrigir".
 */
export function resultOptions(d?: Collected, env?: FlowEnv): OptionDef[] {
  if (d && env && isPaymentFlow(env, d)) {
    const act: OptionDef = {
      id: 'act',
      label: d.paymentMode === 'ENTRADA_PARCELADA' ? 'Mudar o valor do ato' : 'Mudar o valor da entrada',
      aliases: ['ato', 'entrada', 'sinal', 'mudar entrada', 'mais entrada', 'menos entrada', 'outra entrada', 'mudar o ato', 'quanto tenho'],
    };
    const balloons: OptionDef = { id: 'balloons', label: 'Aceitar ou recusar reforços', aliases: ['reforco', 'reforcos', 'intermediaria', 'intermediarias', 'balao'] };
    const hasBalloons = Boolean(salesOf(env, d)?.balloonIntervalMonths);
    if (d.paymentMode === 'ENTRADA_PARCELADA') return [act, ...(hasBalloons ? [balloons] : []), UNIT, MODE, PDF, HUMAN, FINISH];
    if (d.paymentMode === 'ENTRADA_A_VISTA') return [act, UNIT, MODE, PDF, HUMAN, FINISH];
    return [MODE, UNIT, PDF, HUMAN, FINISH];
  }
  return [
    { id: 'down', label: 'Mudar o valor da entrada', aliases: ['entrada', 'mudar entrada', 'sinal', 'mais entrada', 'menos entrada', 'outra entrada'] },
    { id: 'term', label: 'Mudar o prazo', aliases: ['prazo', 'anos', 'meses', 'tempo', 'mais prazo', 'menos prazo'] },
    PDF,
    FINISH,
  ];
}
