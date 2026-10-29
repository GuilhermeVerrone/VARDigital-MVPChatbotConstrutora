import {
  parseDate, parseDurationMonths, parseEmail, parseMoney, parseName, parsePhone, parseYesNo, parseOption,
  scanNumbers, normalize, type OptionDef,
} from '@mvp/parsers';
import { z } from 'zod';

export type FieldKind = 'money' | 'boolean' | 'date' | 'months' | 'name' | 'phone' | 'email' | 'option';

export interface FieldDef {
  key: string;
  kind: FieldKind;
  /** Para `option`: as opções válidas. */
  options?: readonly OptionDef[];
  optional?: boolean;
}

export type FieldValue = number | boolean | string;

const MONEY_MAX = 1_000_000_000;

export function describeField(f: FieldDef): string {
  switch (f.kind) {
    case 'money': return `${f.key}: dinheiro em reais, número (ex.: "uns 5 mil" → 5000)`;
    case 'boolean': return `${f.key}: true para sim, false para não`;
    case 'date': return `${f.key}: data no formato AAAA-MM-DD`;
    case 'months': return `${f.key}: duração em meses, número inteiro (ex.: "2 anos" → 24)`;
    case 'name': return `${f.key}: nome completo (mínimo duas palavras)`;
    case 'phone': return `${f.key}: telefone brasileiro, só dígitos com DDD`;
    case 'email': return `${f.key}: endereço de e-mail`;
    case 'option': return `${f.key}: um destes ids: ${(f.options ?? []).map((o) => `${o.id} (${o.label})`).join(', ')}`;
  }
}

/** Schema do que o LLM pode devolver para o campo; o valor ainda passa por `validateFieldValue`. */
export function fieldSchema(f: FieldDef): z.ZodType {
  switch (f.kind) {
    case 'money': case 'months': return z.number().nullable();
    case 'boolean': return z.boolean().nullable();
    case 'option': {
      const ids = (f.options ?? []).map((o) => o.id);
      return ids.length ? z.enum(ids as [string, ...string[]]).nullable() : z.null();
    }
    default: return z.string().nullable();
  }
}

/**
 * Revalida com as mesmas regras dos parsers o que o LLM extraiu da mensagem. `null` = rejeitado.
 * O valor do LLM só é aceito se também for plausível em relação ao texto do lead.
 */
export function validateFieldValue(f: FieldDef, raw: unknown, leadText: string, today?: string): FieldValue | null {
  if (raw === null || raw === undefined) return null;
  switch (f.kind) {
    case 'money': {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > MONEY_MAX) return null;
      // O valor tem de ter base no texto: sem número escrito só vale 0 ("não tenho", "nada").
      const grounded = scanNumbers(leadText).length > 0;
      const none = /\b(nada|zero|nenhum|nenhuma|nao|sem|livre|limpo)\b/.test(normalize(leadText));
      if (raw === 0) return none || grounded ? 0 : null;
      return grounded ? Math.round(raw * 100) / 100 : null;
    }
    case 'months':
      return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= 1200 && scanNumbers(leadText).length > 0 ? raw : null;
    case 'boolean': return typeof raw === 'boolean' ? raw : null;
    case 'date': return typeof raw === 'string' ? parseDate(raw, today ? { today } : undefined) : null;
    case 'name': return typeof raw === 'string' ? parseName(raw) : null;
    case 'phone': return typeof raw === 'string' ? (parsePhone(raw)?.e164 ?? null) : null;
    case 'email': return typeof raw === 'string' ? parseEmail(raw) : null;
    case 'option': return typeof raw === 'string' && f.options?.some((o) => o.id === raw) ? raw : null;
  }
}

/** Parser determinístico do campo (primeira tentativa, sem LLM). */
export function parseField(f: FieldDef, text: string, today?: string): FieldValue | null {
  switch (f.kind) {
    case 'money': return parseMoney(text)?.value ?? null;
    case 'boolean': return parseYesNo(text);
    case 'date': return parseDate(text, today ? { today } : undefined);
    case 'months': return parseDurationMonths(text);
    case 'name': return parseName(text);
    case 'phone': return parsePhone(text)?.e164 ?? null;
    case 'email': return parseEmail(text);
    case 'option': return parseOption(text, f.options ?? [])?.id ?? null;
  }
}
