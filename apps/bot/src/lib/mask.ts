/**
 * Mascara telefone/JID para logs (spec §7.3): mantém só os 4 últimos dígitos.
 * "5511987654321@s.whatsapp.net" → "*********4321@s.whatsapp.net"
 */
export function maskJid(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const at = value.indexOf('@');
  const user = at === -1 ? value : value.slice(0, at);
  const domain = at === -1 ? '' : value.slice(at);
  const visible = user.length > 4 ? user.slice(-4) : '';
  return '*'.repeat(Math.max(user.length - visible.length, 4)) + visible + domain;
}

/**
 * Mascara dados pessoais dentro de um texto livre (mensagem de erro, por exemplo), sem depender de
 * saber onde eles aparecem: JIDs e telefones (só os 4 últimos dígitos), e-mails, valores em reais e
 * qualquer sequência longa de dígitos (CPF, telefone sem formatação).
 */
export function maskText(value: string): string {
  return value
    .replace(/\b\d{4,}@(?:s\.whatsapp\.net|lid|g\.us|c\.us)\b/g, (jid) => maskJid(jid) ?? '***')
    .replace(/(?=[\w.+-]*[a-z])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, (email) => `***@${email.split('@')[1]}`)
    .replace(/R\$\s?\d[\d.,]*/g, 'R$ ***')
    .replace(/\+?\(?\d(?:[\s().-]{0,2}\d){7,}/g, (digits) => `***${digits.replace(/\D/g, '').slice(-4)}`);
}

/** Texto de erro seguro para log e para gravar em `last_error`: sem dados pessoais e de tamanho limitado. */
export function safeError(err: unknown, max = 500): string {
  const text = err instanceof Error ? err.message : String(err);
  return maskText(text).slice(0, max);
}

/**
 * Campos que nunca vão para o log em claro, em qualquer nível do objeto logado. Os logs do bot
 * trazem só ids (endereços do canal passam por `maskJid` antes de ir ao log) (mensagem, job, simulação); isto é a segunda barreira caso alguém logue um objeto inteiro.
 */
export const LOG_REDACT_KEYS = [
  'phone', 'chatId', 'jid', 'text', 'message', 'name', 'pushName', 'email', 'birthDate',
  'income', 'grossMonthlyIncome', 'debts', 'monthlyDebts', 'downPayment', 'availableDownPayment', 'fgtsBalance',
  'payload', 'history', 'context', 'data',
] as const;

export const LOG_REDACT_PATHS: string[] = [
  'req.headers["x-webhook-signature"]', 'req.headers.authorization', 'req.headers["x-api-key"]',
  ...LOG_REDACT_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];
