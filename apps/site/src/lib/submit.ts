import { submitSiteLead, UnknownDevelopmentError, type Db, type SiteLeadResult } from '@mvp/db/site';
import { checkFormToken } from './form-token';
import { OPTIN_TEXT, PRIVACY_TEXT } from './legal';
import type { RateLimiter } from './rate-limit';
import { fieldErrors, formSchema, parseUtm, type FieldErrors } from './schema';

// Lógica do envio do formulário, separada da Server Action para ser testada sem o Next: valida no
// servidor (Zod), barra spam (honeypot, tempo mínimo, limite por IP e por telefone) e grava o lead,
// os consentimentos WEB e o job FIRST_CONTACT. Nada daqui vai para o bundle do cliente.

export interface SubmitDeps {
  db: Db;
  formSecret: string;
  ipLimiter: RateLimiter;
  phoneLimiter: RateLimiter;
  minFillMs?: number;
  maxFillMs?: number;
  now?: () => Date;
}

export type SubmitOutcome =
  | { status: 'ok'; contactCode: string; development: string }
  /** Spam silencioso: parece sucesso para o robô, mas nada é gravado. */
  | { status: 'ignored'; development: string }
  | { status: 'invalid'; errors: FieldErrors }
  | { status: 'too-fast' | 'expired' | 'rate-limited' | 'unknown-development' | 'error'; message: string };

export async function handleSubmission(deps: SubmitDeps, data: Record<string, FormDataEntryValue | undefined>, ip: string): Promise<SubmitOutcome> {
  const now = deps.now?.() ?? new Date();
  const text = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);

  const parsed = formSchema.safeParse({
    name: text('name') ?? '', phone: text('phone') ?? '', email: text('email'), development: text('development') ?? '',
    typology: text('typology'), consent: text('consent'), optin: text('optin'), website: text('website'), token: text('token'), utm: text('utm'),
  });

  // Honeypot: campo que só robô preenche. Responde como se tivesse dado certo e não grava nada.
  if (text('website')) return { status: 'ignored', development: text('development') ?? '' };

  if (!deps.ipLimiter.hit(`ip:${ip}`, now.getTime())) return { status: 'rate-limited', message: 'Muitas tentativas. Tente novamente em alguns minutos.' };

  if (!parsed.success) return { status: 'invalid', errors: fieldErrors(parsed.error) };
  const f = parsed.data;

  const tokenState = checkFormToken(f.token, deps.formSecret, { minMs: deps.minFillMs ?? 3000, maxMs: deps.maxFillMs ?? 2 * 60 * 60 * 1000, now: now.getTime() });
  if (tokenState === 'too-fast') return { status: 'too-fast', message: 'Confira seus dados e envie de novo.' };
  if (tokenState === 'expired' || tokenState === 'invalid') return { status: 'expired', message: 'A página ficou aberta por muito tempo. Atualize e envie de novo.' };

  if (!deps.phoneLimiter.hit(`phone:${f.phone}`, now.getTime())) return { status: 'rate-limited', message: 'Já recebemos seu pedido. Aguarde o nosso contato no WhatsApp.' };

  try {
    const r: SiteLeadResult = await submitSiteLead(deps.db, {
      name: f.name, phone: f.phone, email: f.email, developmentSlug: f.development, typology: f.typology, utm: parseUtm(f.utm),
      consentText: PRIVACY_TEXT, optInText: OPTIN_TEXT, now,
    });
    return { status: 'ok', contactCode: r.contactCode, development: f.development };
  } catch (err) {
    if (err instanceof UnknownDevelopmentError) return { status: 'unknown-development', message: 'Esse empreendimento não está disponível.' };
    return { status: 'error', message: 'Não foi possível enviar agora. Tente novamente em instantes.' };
  }
}
