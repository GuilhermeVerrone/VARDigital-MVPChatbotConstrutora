import { InvalidSalesConditionError, parseSalesCondition, type SalesCondition } from '@mvp/simulation';

// Formulário da condição comercial ⇄ formato do motor. Taxas e frações aparecem em % (o usuário digita
// 20 para 20%); o motor recebe 0.2. Cada campo tem o caminho no objeto da condição como nome.

export type FieldKind = 'percent' | 'money' | 'int' | 'bool' | 'select';

export interface FieldDef {
  /** Caminho no objeto da condição, separado por ponto; é o `name` do input. */
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: readonly string[];
  /** Campo opcional: vazio vira null. */
  nullable?: boolean;
}

export interface FieldGroup {
  id: string;
  title: string;
  fields: readonly FieldDef[];
}

export const CONDITION_GROUPS: readonly FieldGroup[] = [
  {
    id: 'geral',
    title: 'Geral',
    fields: [
      { name: 'status', label: 'Situação dos dados', kind: 'select', options: ['ILUSTRATIVO', 'VALIDADO'], hint: 'ILUSTRATIVO = ainda não validado pela construtora; toda simulação sai com alerta.' },
      { name: 'adjustmentToleranceRatio', label: 'Tolerância para "viável com ajustes" (%)', kind: 'percent', hint: 'Falta de dinheiro até esta fração da entrada ainda é "viável com ajustes".' },
      { name: 'downPayment.minRatio', label: 'Entrada mínima (% do preço)', kind: 'percent' },
      { name: 'downPayment.maxRatio', label: 'Entrada máxima (% do preço)', kind: 'percent' },
      { name: 'bankEstimate.enabled', label: 'Estimar o financiamento do saldo no banco', kind: 'bool' },
    ],
  },
  {
    id: 'a-vista',
    title: 'Modo 1 · À vista',
    fields: [
      { name: 'cash.enabled', label: 'Oferecer pagamento à vista', kind: 'bool' },
      { name: 'cash.discountRatio', label: 'Desconto à vista (%)', kind: 'percent' },
    ],
  },
  {
    id: 'entrada-a-vista',
    title: 'Modo 2 · Entrada à vista',
    fields: [{ name: 'upfront.enabled', label: 'Oferecer entrada à vista com financiamento do saldo', kind: 'bool' }],
  },
  {
    id: 'entrada-parcelada',
    title: 'Modo 3 · Entrada parcelada',
    fields: [
      { name: 'installments.enabled', label: 'Oferecer entrada parcelada com a construtora', kind: 'bool' },
      { name: 'installments.act.minRatio', label: 'Ato mínimo (% da entrada)', kind: 'percent' },
      { name: 'installments.act.minAmount', label: 'Ato mínimo (piso em R$)', kind: 'money', hint: 'Vale o maior entre a fração e o piso.' },
      { name: 'installments.monthly.maxCount', label: 'Máximo de mensais', kind: 'int' },
      { name: 'installments.monthly.minAmount', label: 'Valor mínimo de cada mensal (R$)', kind: 'money' },
      { name: 'installments.monthly.monthlyInterestRate', label: 'Juros da construtora (% ao mês)', kind: 'percent', hint: '0 = sem juros, só correção.' },
      { name: 'installments.balloons.enabled', label: 'Oferecer reforços (intermediárias)', kind: 'bool' },
      { name: 'installments.balloons.intervalMonths', label: 'Intervalo dos reforços (meses)', kind: 'int' },
      { name: 'installments.balloons.maxRatio', label: 'Reforços (% máximo da entrada)', kind: 'percent' },
      { name: 'installments.keysRatio', label: 'Parcela nas chaves (% da entrada)', kind: 'percent' },
      { name: 'installments.maxIncomeCommitment', label: 'Comprometimento máximo da renda (%)', kind: 'percent' },
      { name: 'installments.highCommitmentAlertRatio', label: 'Alerta de comprometimento alto a partir de (%)', kind: 'percent' },
      { name: 'installments.desiredInstallmentToleranceRatio', label: 'Tolerância da parcela desejada (%)', kind: 'percent' },
      { name: 'installments.correction.index', label: 'Índice de correção', kind: 'select', options: ['INCC', 'IPCA', 'IGPM', 'NENHUM'] },
      { name: 'installments.correction.projectedMonthlyRate', label: 'Projeção da correção (% ao mês)', kind: 'percent', nullable: true, hint: 'Só informativa. Vazio = não projetar.' },
    ],
  },
];

const ALL_FIELDS = CONDITION_GROUPS.flatMap((g) => g.fields);

type Obj = Record<string, unknown>;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[key];
  }
  return cur;
}

function setPath(obj: Obj, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key] as Obj;
  }
  cur[keys[keys.length - 1]!] = value;
}

const pct = (ratio: number) => String(Number((ratio * 100).toFixed(4)));

/** Valores iniciais do formulário (tudo texto, como o navegador envia). */
export function conditionToValues(c: SalesCondition): Record<string, string> {
  const out: Record<string, string> = {};
  const balloons = c.installments.balloons;
  for (const f of ALL_FIELDS) {
    if (f.name.startsWith('installments.balloons.')) {
      const key = f.name.slice('installments.balloons.'.length);
      out[f.name] = key === 'enabled' ? (balloons ? 'on' : '') : balloons ? (key === 'maxRatio' ? pct(balloons.maxRatio) : String(balloons.intervalMonths)) : '';
      continue;
    }
    const v = getPath(c, f.name);
    out[f.name] = f.kind === 'bool' ? (v ? 'on' : '') : v === null || v === undefined ? '' : f.kind === 'percent' ? pct(v as number) : String(v);
  }
  return out;
}

/** Formulário em branco (empreendimento sem nenhuma condição): o motor não tem valores padrão de negócio. */
export function emptyValues(): Record<string, string> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.name, f.kind === 'select' ? (f.options?.[0] ?? '') : '']));
}

/** Rótulo do campo a partir do caminho (cai no próprio caminho se não houver). */
export function labelForPath(path: string): string {
  return ALL_FIELDS.find((f) => f.name === path)?.label ?? path;
}

/** Valor legível de um campo da condição (frações em %, dinheiro em R$). */
export function formatConditionValue(path: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const kind = ALL_FIELDS.find((f) => f.name === path)?.kind;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number' && kind === 'percent') return `${pct(value)}%`;
  if (typeof value === 'number' && kind === 'money') return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return String(value);
}

export interface BuiltCondition {
  /** Condição no formato do motor, ainda sem versão/vigência definitivas. */
  condition: SalesCondition | null;
  /** Mensagem por campo (nome do input). */
  errors: Record<string, string>;
}

/** Converte os valores do formulário em condição, validando com o schema do motor. */
export function valuesToCondition(values: Record<string, string>, base: { validFrom: string; version: string }): BuiltCondition {
  const errors: Record<string, string> = {};
  const raw: Obj = { version: base.version, validFrom: base.validFrom, validTo: null };

  for (const f of ALL_FIELDS) {
    if (f.name.startsWith('installments.balloons.')) continue;
    const text = (values[f.name] ?? '').trim();
    if (f.kind === 'bool') setPath(raw, f.name, values[f.name] === 'on');
    else if (f.kind === 'select') setPath(raw, f.name, text);
    else if (text === '') {
      if (f.nullable) setPath(raw, f.name, null);
      else errors[f.name] = 'Preencha este campo';
    } else {
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n)) errors[f.name] = 'Use um número';
      else if (f.kind === 'int' && !Number.isInteger(n)) errors[f.name] = 'Use um número inteiro';
      else setPath(raw, f.name, f.kind === 'percent' ? Number((n / 100).toFixed(8)) : n);
    }
  }

  // Reforços: desligados = null; ligados exigem intervalo e teto.
  if (values['installments.balloons.enabled'] === 'on') {
    const interval = Number((values['installments.balloons.intervalMonths'] ?? '').replace(',', '.'));
    const max = Number((values['installments.balloons.maxRatio'] ?? '').replace(',', '.'));
    if (!Number.isInteger(interval) || interval <= 0) errors['installments.balloons.intervalMonths'] = 'Informe o intervalo em meses';
    if (!Number.isFinite(max) || (values['installments.balloons.maxRatio'] ?? '').trim() === '') errors['installments.balloons.maxRatio'] = 'Informe o teto';
    setPath(raw, 'installments.balloons', { intervalMonths: interval, maxRatio: Number((max / 100).toFixed(8)) });
  } else {
    setPath(raw, 'installments.balloons', null);
  }

  if (Object.keys(errors).length > 0) return { condition: null, errors };
  try {
    return { condition: parseSalesCondition(raw), errors };
  } catch (err) {
    if (!(err instanceof InvalidSalesConditionError)) throw err;
    for (const issue of err.issues) {
      const sep = issue.indexOf(': ');
      const path = sep > 0 ? issue.slice(0, sep) : '';
      const message = sep > 0 ? issue.slice(sep + 2) : issue;
      // Erros de regra entre campos (path "installments", "downPayment", "cash") vão para o primeiro campo do grupo.
      const target = ALL_FIELDS.find((f) => f.name === path) ?? ALL_FIELDS.find((f) => f.name.startsWith(`${path}.`)) ?? ALL_FIELDS[0]!;
      errors[target.name] ??= message;
    }
    return { condition: null, errors };
  }
}

/** Lê o FormData do navegador para o mapa de valores (só os campos conhecidos). */
export function valuesFromFormData(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ALL_FIELDS) out[f.name] = String(form.get(f.name) ?? '');
  for (const name of ['installments.balloons.enabled', 'installments.balloons.intervalMonths', 'installments.balloons.maxRatio']) out[name] = String(form.get(name) ?? '');
  return out;
}
