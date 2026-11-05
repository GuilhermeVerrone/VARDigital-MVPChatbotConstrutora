import { DEFAULT_TEXTS, TEXT_KEYS, type TextKey } from './texts';

// Linter do fluxo editável (Fase 15, D11): é o que decide se um texto pode ser publicado. Roda no
// servidor do painel a cada salvar e a cada publicar (a tela só mostra o resultado). Um texto com
// variável que o bot não sabe preencher, ou com promessa que a construtora não pode fazer, não
// publica. Os blocos legais (consentimento, aviso da simulação, exclusão de dados) não estão em
// DEFAULT_TEXTS e, portanto, nem entram aqui: ficam travados no código.

export interface FlowContentLike {
  texts?: Readonly<Record<string, string>>;
  optionalSteps?: Readonly<Record<string, boolean>>;
  buttons?: Readonly<Record<string, readonly string[]>>;
  firstContact?: string | null;
}

export interface FlowIssue {
  severity: 'error' | 'warning';
  /** Onde: "texts.ASK_NAME", "firstContact", "optionalSteps.EMAIL", "buttons.ASK_PAYMENT_MODE". */
  path: string;
  message: string;
}

export const MAX_TEXT_LENGTH = 1000;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_LENGTH = 25;

/** Etapas que o fluxo pode ligar e desligar (as que o bot consulta com `stepOn`). */
export const OPTIONAL_STEPS: readonly { key: string; label: string; hint: string }[] = [
  { key: 'EMAIL', label: 'E-mail', hint: 'Pergunta o e-mail (o lead pode pular).' },
  { key: 'BIRTH', label: 'Data de nascimento e estimativa do banco', hint: 'Desligada, a simulação não estima o financiamento do saldo.' },
  { key: 'CO_ASK', label: 'Comprar junto com outra pessoa', hint: 'Pergunta sobre o segundo comprador e a renda dele.' },
  { key: 'DESIRED_INSTALLMENT', label: 'Parcela mensal desejada', hint: 'Pergunta quanto o lead quer pagar por mês na entrada.' },
  { key: 'BALLOONS', label: 'Reforços na entrada parcelada', hint: 'Pergunta se o lead topa reforços (parcelas maiores de tempos em tempos).' },
];

export const OPTIONAL_STEP_KEYS: readonly string[] = OPTIONAL_STEPS.map((s) => s.key);

export type TextGroup = 'Identificação' | 'Forma de pagamento' | 'Perfil financeiro' | 'Início pelo formulário' | 'Resultado';

/** Nome e grupo de cada texto na tela do editor. O tipo obriga a descrever toda chave nova. */
export const TEXT_META: Record<TextKey, { label: string; group: TextGroup }> = {
  ASK_NAME: { label: 'Pergunta do nome', group: 'Identificação' },
  ASK_PHONE_CONFIRM: { label: 'Confirmar o telefone do WhatsApp', group: 'Identificação' },
  ASK_PHONE: { label: 'Pergunta do telefone', group: 'Identificação' },
  ASK_EMAIL: { label: 'Pergunta do e-mail', group: 'Identificação' },
  ASK_DEVELOPMENT: { label: 'Escolha do empreendimento', group: 'Identificação' },
  ASK_INTEREST: { label: 'Escolha da tipologia', group: 'Identificação' },
  ASK_PAYMENT_MODE: { label: 'Escolha da forma de pagamento', group: 'Forma de pagamento' },
  ASK_DOWN_CASH: { label: 'Entrada de uma vez', group: 'Forma de pagamento' },
  ASK_CASH_NOW: { label: 'Dinheiro para o ato', group: 'Forma de pagamento' },
  ASK_DESIRED_INSTALLMENT: { label: 'Parcela mensal desejada', group: 'Forma de pagamento' },
  ASK_BALLOONS: { label: 'Aceita reforços', group: 'Forma de pagamento' },
  ASK_INCOME: { label: 'Renda mensal', group: 'Perfil financeiro' },
  ASK_INCOME_TYPE: { label: 'Tipo de renda', group: 'Perfil financeiro' },
  ASK_BIRTH: { label: 'Data de nascimento', group: 'Perfil financeiro' },
  ASK_DEBTS: { label: 'Parcelas que já paga', group: 'Perfil financeiro' },
  ASK_CO_APPLICANT: { label: 'Compra junto com alguém', group: 'Perfil financeiro' },
  ASK_CO_INCOME: { label: 'Renda do segundo comprador', group: 'Perfil financeiro' },
  ASK_CO_INCOME_TYPE: { label: 'Tipo de renda do segundo comprador', group: 'Perfil financeiro' },
  ASK_CO_BIRTH: { label: 'Nascimento do segundo comprador', group: 'Perfil financeiro' },
  ASK_CO_DEBTS: { label: 'Parcelas do segundo comprador', group: 'Perfil financeiro' },
  ASK_DOWN: { label: 'Entrada disponível', group: 'Perfil financeiro' },
  ASK_INSTALLMENT: { label: 'Parcela do financiamento', group: 'Perfil financeiro' },
  ASK_FGTS: { label: 'Tem FGTS', group: 'Perfil financeiro' },
  ASK_FGTS_BALANCE: { label: 'Saldo do FGTS', group: 'Perfil financeiro' },
  ASK_FGTS_MONTHS: { label: 'Tempo de FGTS', group: 'Perfil financeiro' },
  ASK_OWNS: { label: 'Tem imóvel residencial', group: 'Perfil financeiro' },
  ASK_FIRST: { label: 'Primeiro financiamento', group: 'Perfil financeiro' },
  FIRST_CONTACT: { label: '1ª mensagem (após o formulário do site)', group: 'Início pelo formulário' },
  CONTACT_CONFIRM_ASK: { label: 'Confirmar que pediu a simulação', group: 'Início pelo formulário' },
  CONTACT_CONFIRMED: { label: 'Contato confirmado', group: 'Início pelo formulário' },
  CONTACT_DECLINED: { label: 'Contato recusado', group: 'Início pelo formulário' },
  CASH_OFFER_ASK: { label: 'Oferta do corretor (à vista)', group: 'Resultado' },
};

/**
 * Variáveis que o bot preenche em cada texto (as que a máquina passa a `tx`/`firstContactText`).
 * Qualquer outra ficaria literal na mensagem do lead, então não publica.
 */
export const ALLOWED_VARIABLES: Partial<Record<TextKey, readonly string[]>> = {
  ASK_PHONE_CONFIRM: ['telefone'],
  ASK_INTEREST: ['empreendimento'],
  ASK_BALLOONS: ['intervalo'],
  FIRST_CONTACT: ['nome', 'empreendimento'],
  CONTACT_CONFIRM_ASK: ['nome', 'empreendimento'],
  CONTACT_CONFIRMED: ['nome', 'empreendimento'],
};

/** Variáveis que não podem sumir do texto (sem elas a pergunta perde o sentido). */
export const REQUIRED_VARIABLES: Partial<Record<TextKey, readonly string[]>> = {
  ASK_PHONE_CONFIRM: ['telefone'],
};

/** Perguntas de sim/não: o texto precisa deixar claro como responder. */
const YES_NO_KEYS: readonly TextKey[] = [
  'ASK_PHONE_CONFIRM', 'ASK_BALLOONS', 'ASK_CO_APPLICANT', 'ASK_FGTS', 'ASK_OWNS', 'ASK_FIRST', 'CASH_OFFER_ASK', 'CONTACT_CONFIRM_ASK', 'FIRST_CONTACT',
];

/** Promessas e termos que a construtora não pode dizer numa simulação (ela não é aprovação de crédito). */
export const FORBIDDEN_TERMS: readonly { pattern: string; label: string }[] = [
  { pattern: 'garantid[oa]s?', label: 'garantido' },
  { pattern: 'garantimos', label: 'garantimos' },
  { pattern: 'aprovad[oa]s?', label: 'aprovado' },
  { pattern: 'aprovacao', label: 'aprovação' },
  { pattern: 'sem (analise|consulta|burocracia)', label: 'sem análise / consulta / burocracia' },
  { pattern: 'sem juros', label: 'sem juros' },
  { pattern: 'juros zero', label: 'juros zero' },
  { pattern: 'taxa zero', label: 'taxa zero' },
  { pattern: 'sem risco', label: 'sem risco' },
  { pattern: 'risco zero', label: 'risco zero' },
  { pattern: 'lucro', label: 'lucro' },
  { pattern: 'rentabilidade', label: 'rentabilidade' },
  { pattern: 'ultima chance', label: 'última chance' },
  { pattern: 'oportunidade unica', label: 'oportunidade única' },
];

/** Minúsculas e sem acento, para comparar sem se enganar com "Aprovação" e "aprovacao". */
const plain = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const FORBIDDEN_RES = FORBIDDEN_TERMS.map((t) => ({ label: t.label, re: new RegExp(`(^|[^a-z0-9])(${t.pattern})(?![a-z0-9])`) }));

/** O primeiro termo proibido do texto, ou null. */
export function findForbiddenTerm(text: string): string | null {
  const p = plain(text);
  return FORBIDDEN_RES.find((t) => t.re.test(p))?.label ?? null;
}

/** Variáveis `{nome}` usadas no texto, e as chaves que sobram ou faltam fechar. */
export function scanVariables(text: string): { used: string[]; stray: boolean; malformed: string[] } {
  const used: string[] = [];
  const malformed: string[] = [];
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (/^\w+$/.test(m[1]!)) used.push(m[1]!);
    else malformed.push(m[0]);
  }
  const rest = text.replace(/\{[^{}]*\}/g, '');
  return { used: [...new Set(used)], stray: /[{}]/.test(rest), malformed };
}

function lintText(path: string, key: TextKey, text: string, out: FlowIssue[]): void {
  const err = (message: string): void => {
    out.push({ severity: 'error', path, message });
  };
  if (!text.trim()) return err('O texto não pode ficar vazio.');
  if (text.length > MAX_TEXT_LENGTH) err(`O texto passa de ${MAX_TEXT_LENGTH} caracteres.`);
  const allowed = ALLOWED_VARIABLES[key] ?? [];
  const { used, stray, malformed } = scanVariables(text);
  for (const m of malformed) err(`Variável inválida ${m}: use só letras, como {nome}.`);
  if (stray) err('Há uma chave { ou } sem par.');
  for (const v of used) {
    if (!allowed.includes(v)) {
      err(allowed.length > 0 ? `A variável {${v}} não existe neste texto. Disponíveis: ${allowed.map((a) => `{${a}}`).join(', ')}.` : `A variável {${v}} não existe neste texto (ele não aceita variáveis).`);
    }
  }
  for (const v of REQUIRED_VARIABLES[key] ?? []) if (!used.includes(v)) err(`O texto precisa conter {${v}}.`);
  const term = findForbiddenTerm(text);
  if (term) err(`Palavra proibida: "${term}". A simulação não é aprovação de crédito nem promete resultado.`);
  if (YES_NO_KEYS.includes(key) && !/\b(sim|nao)\b/.test(plain(text))) {
    out.push({ severity: 'warning', path, message: 'Pergunta de sim/não: diga como responder (ex.: "(sim/não)").' });
  }
}

const isTextKey = (k: string): k is TextKey => (TEXT_KEYS as string[]).includes(k);

/** Valida o conteúdo do fluxo. Só `severity: 'error'` impede salvar e publicar. */
export function lintFlowContent(content: FlowContentLike): FlowIssue[] {
  const out: FlowIssue[] = [];
  for (const [key, text] of Object.entries(content.texts ?? {})) {
    const path = `texts.${key}`;
    if (!isTextKey(key)) out.push({ severity: 'error', path, message: `Texto desconhecido: ${key}.` });
    else if (key === 'FIRST_CONTACT') out.push({ severity: 'error', path, message: 'A 1ª mensagem tem campo próprio (firstContact).' });
    else lintText(path, key, text, out);
  }
  if (content.firstContact !== undefined && content.firstContact !== null) lintText('firstContact', 'FIRST_CONTACT', content.firstContact, out);
  for (const key of Object.keys(content.optionalSteps ?? {})) {
    if (!OPTIONAL_STEP_KEYS.includes(key)) out.push({ severity: 'error', path: `optionalSteps.${key}`, message: `Etapa que não pode ser ligada ou desligada: ${key}.` });
  }
  for (const [key, labels] of Object.entries(content.buttons ?? {})) {
    const path = `buttons.${key}`;
    if (!isTextKey(key) || key === 'FIRST_CONTACT') {
      out.push({ severity: 'error', path, message: `Etapa desconhecida para botões: ${key}.` });
      continue;
    }
    if (labels.length > MAX_BUTTONS) out.push({ severity: 'error', path, message: `No máximo ${MAX_BUTTONS} botões por etapa.` });
    labels.forEach((label, i) => {
      if (label.length > MAX_BUTTON_LENGTH) out.push({ severity: 'error', path: `${path}.${i}`, message: `Botão "${label.slice(0, 12)}…" passa de ${MAX_BUTTON_LENGTH} caracteres.` });
      const term = findForbiddenTerm(label);
      if (term) out.push({ severity: 'error', path: `${path}.${i}`, message: `Palavra proibida no botão: "${term}".` });
      if (/[{}]/.test(label)) out.push({ severity: 'error', path: `${path}.${i}`, message: 'Botão não aceita variáveis.' });
    });
  }
  return out;
}

export const flowErrors = (issues: readonly FlowIssue[]): FlowIssue[] => issues.filter((i) => i.severity === 'error');

/** Textos padrão do código, por chave (o editor mostra o padrão ao lado do texto publicado). */
export const defaultText = (key: TextKey): string => DEFAULT_TEXTS[key];
