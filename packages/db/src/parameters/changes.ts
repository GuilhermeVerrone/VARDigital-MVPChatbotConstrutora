import { isDeepStrictEqual } from 'node:util';
import type { SimulationParameters } from '@mvp/simulation';

// Caminhos de parâmetro usados pela CLI e pelo log de auditoria:
//   <campo global>              ex.: adjustmentToleranceRatio, status
//   lines.<id>.<campo[.sub]>    ex.: lines.sbpe.annualInterestRate, lines.sbpe.insurance.dfiMonthlyRate
// Arrays (faixas de MIP, subsídio, tarifas) são valores inteiros: troca-se a lista toda.

/** Campos controlados pela linha do tempo da CLI, nunca por `--set`. */
const MANAGED = new Set(['version', 'validFrom', 'validTo', 'creditLines']);

export class InvalidParameterPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterPathError';
  }
}

export interface ParameterChange {
  path: string;
  before: unknown;
  after: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Interpreta o valor da CLI: JSON quando possível (números, booleanos, null, listas), senão texto. */
export function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Aplica `path = value` numa cópia dos parâmetros. Só altera campos que já existem. */
export function applyChange(params: SimulationParameters, path: string, value: unknown): SimulationParameters {
  const copy = structuredClone(params) as unknown as Obj;
  const segments = path.split('.');
  if (segments.some((s) => s === '')) throw new InvalidParameterPathError(`caminho inválido: "${path}"`);

  let target: Obj;
  let rest: string[];
  if (segments[0] === 'lines') {
    const [, lineId, ...fields] = segments;
    const line = (copy.creditLines as Obj[]).find((l) => l.id === lineId);
    if (!line) throw new InvalidParameterPathError(`linha de crédito inexistente: "${lineId}"`);
    if (fields.length === 0 || fields[0] === 'id') {
      throw new InvalidParameterPathError(`"${path}": informe um campo da linha (incluir/remover linhas: use import)`);
    }
    target = line;
    rest = fields;
  } else {
    if (MANAGED.has(segments[0]!)) {
      throw new InvalidParameterPathError(`"${segments[0]}" é controlado pela CLI (use --from; linhas via lines.<id>.<campo>)`);
    }
    target = copy;
    rest = segments;
  }

  for (const key of rest.slice(0, -1)) {
    const next = target[key];
    if (!isObj(next)) throw new InvalidParameterPathError(`caminho inexistente: "${path}"`);
    target = next;
  }
  const last = rest[rest.length - 1]!;
  if (!Object.hasOwn(target, last)) throw new InvalidParameterPathError(`caminho inexistente: "${path}"`);
  target[last] = value;
  return copy as unknown as SimulationParameters;
}

function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
}

function leaves(params: SimulationParameters): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const { creditLines, ...globals } = params;
  for (const key of MANAGED) delete (globals as Obj)[key];
  flatten(globals, '', out);
  for (const line of creditLines) {
    const { id, ...fields } = line;
    flatten(fields, `lines.${id}`, out);
  }
  return out;
}

/** Diferenças campo a campo (ignora versão e vigência). Linha nova/removida aparece campo a campo com o outro lado `null`. */
export function diffParameters(before: SimulationParameters | null, after: SimulationParameters): ParameterChange[] {
  const a = before ? leaves(before) : new Map<string, unknown>();
  const b = leaves(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((p) => !isDeepStrictEqual(a.get(p), b.get(p)))
    .map((p) => ({ path: p, before: a.has(p) ? a.get(p) : null, after: b.has(p) ? b.get(p) : null }));
}
