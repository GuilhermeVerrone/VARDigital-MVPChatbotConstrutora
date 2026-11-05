import { createHmac } from 'node:crypto';
import type { SentMessage } from './fake-wa-akg';

// Lado "lead" do WhatsApp no e2e: manda mensagens ao bot pelo webhook assinado (como o WA-AKG faria) e
// lê o que o bot respondeu no WA-AKG falso.

export interface StackEnv {
  botUrl: string;
  fakeWaUrl: string;
  webhookSecret: string;
  sessionId: string;
}

export const stackEnv = (): StackEnv => ({
  botUrl: process.env.E2E_BOT_URL!,
  fakeWaUrl: process.env.E2E_FAKE_WA_URL!,
  webhookSecret: process.env.E2E_WEBHOOK_SECRET!,
  sessionId: process.env.E2E_WA_SESSION!,
});

const jidOf = (phone: string) => `${phone}@s.whatsapp.net`;
let counter = 0;

export async function leadSays(env: StackEnv, phone: string, text: string): Promise<void> {
  const jid = jidOf(phone);
  const raw = JSON.stringify({
    event: 'message.received',
    sessionId: env.sessionId,
    timestamp: new Date().toISOString(),
    data: { key: { id: `E2E${Date.now()}-${++counter}`, fromMe: false, remoteJid: jid }, from: jid, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: text },
  });
  const res = await fetch(`${env.botUrl}/webhooks/wa-akg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': 'sha256=' + createHmac('sha256', env.webhookSecret).update(raw).digest('hex') },
    body: raw,
  });
  if (!res.ok) throw new Error(`webhook recusado (${res.status})`);
}

export async function sentTo(env: StackEnv, phone: string): Promise<SentMessage[]> {
  const all = (await (await fetch(`${env.fakeWaUrl}/_sent`)).json()) as SentMessage[];
  return all.filter((m) => m.to === jidOf(phone));
}

export async function waitFor<T>(what: string, probe: () => Promise<T | null | false | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`tempo esgotado esperando: ${what}${last ? ` (${String(last)})` : ''}`);
}

/**
 * Manda a mensagem e espera o bot responder (mensagens novas para o telefone). Devolve só as respostas
 * dessa rodada. `expect` é um trecho que precisa aparecer nelas (ex.: o nome da etapa seguinte).
 */
export async function say(env: StackEnv, phone: string, text: string, opts: { expect?: string; timeoutMs?: number } = {}): Promise<SentMessage[]> {
  const before = (await sentTo(env, phone)).length;
  await leadSays(env, phone, text);
  return waitFor(`resposta do bot a "${text}"${opts.expect ? ` contendo "${opts.expect}"` : ''}`, async () => {
    const now = (await sentTo(env, phone)).slice(before);
    if (now.length === 0) return null;
    if (opts.expect && !now.some((m) => m.text.includes(opts.expect!))) return null;
    // Dá um instante para o restante do lote de respostas chegar antes de devolver.
    await new Promise((r) => setTimeout(r, 250));
    return (await sentTo(env, phone)).slice(before);
  }, opts.timeoutMs ?? 20_000);
}

export const joined = (msgs: SentMessage[]) => msgs.map((m) => m.text).join('\n---\n');
