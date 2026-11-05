import { z } from 'zod';
import { normalizeBrPhone } from './phone';

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

const checked = z.literal('on', { error: 'Marque para continuar.' });

/** Campos que chegam do formulário (todos texto). */
export const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Informe seu nome.')
    .max(100, 'Nome muito longo.')
    .refine((v) => /\p{L}/u.test(v), 'Informe seu nome.'),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = normalizeBrPhone(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Informe um celular com DDD, por exemplo (41) 98888-7777.' });
      return n ?? z.NEVER;
    }),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.union([z.null(), z.string().email('E-mail inválido.')])),
  development: z.string().trim().min(1, 'Escolha o empreendimento.').max(80),
  typology: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  consent: checked,
  optin: checked,
  // Anti-spam: o campo escondido tem que chegar vazio; o token assinado diz quando o formulário abriu.
  website: z.string().max(200).optional().default(''),
  token: z.string().max(200).default(''),
  utm: z.string().max(1500).optional().default(''),
});

export type FormFields = z.infer<typeof formSchema>;

/** utm vem como JSON do campo escondido: só chaves conhecidas, textos curtos. */
export function parseUtm(raw: string): Record<string, string> | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

export type FieldErrors = Partial<Record<'name' | 'phone' | 'email' | 'development' | 'typology' | 'consent' | 'optin', string>>;

/** Primeira mensagem de erro por campo. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}
