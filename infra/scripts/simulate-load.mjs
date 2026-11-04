#!/usr/bin/env node
// Carga sintética para a medição de memória (Fase 11b): conversas simuladas entram pelo webhook assinado,
// passam pela fila, pela máquina de estados e pelo envio (que falha sem sessão de WhatsApp, o que também
// exercita o retry). Não usa WhatsApp nem LLM real.
//
//   node infra/scripts/simulate-load.mjs --secret <WA_AKG_WEBHOOK_SECRET> [--url https://localhost:3100]
//        [--conversations 40] [--messages 25] [--concurrency 10] [--session piloto]
//
// Os telefones simulados (5511900000001...) precisam estar em ALLOWED_PHONES do bot, senão o webhook os
// descarta. Aceita o certificado de CA de desenvolvimento (NODE_TLS_REJECT_UNAUTHORIZED=0 só neste processo).
import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1] : d;
};
const secret = opt('secret', process.env.WA_AKG_WEBHOOK_SECRET ?? '');
const base = opt('url', 'https://localhost:3100').replace(/\/$/, '');
const conversations = Number(opt('conversations', '40'));
const messages = Number(opt('messages', '25'));
const concurrency = Number(opt('concurrency', '10'));
const sessionId = opt('session', 'piloto');
if (!secret) {
  console.error('informe --secret (WA_AKG_WEBHOOK_SECRET)');
  process.exit(2);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Respostas típicas de um lead, em ordem; a conversa recomeça quando acaba.
const SCRIPT = [
  'oi', 'sim, aceito', 'Maria da Silva Souza', 'sim', '2', 'tipo 6 mil e quinhentos', '1', '12/05/1988',
  'não tenho dívidas', 'uns 40 mil', 'não', 'sim', 'quero ver as opções', '3', 'qual a previsão de entrega?',
];

const phone = (i) => `5511900${String(i + 1).padStart(6, '0')}`;
const sign = (raw) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

async function send(conv, n) {
  const jid = `${phone(conv)}@s.whatsapp.net`;
  const id = `LOAD${conv}-${n}-${Date.now()}`;
  const raw = JSON.stringify({
    event: 'message.received',
    sessionId,
    timestamp: new Date().toISOString(),
    data: { key: { id, fromMe: false, remoteJid: jid }, from: jid, isGroup: false, chatType: 'PERSONAL', type: 'TEXT', content: SCRIPT[n % SCRIPT.length] },
  });
  const res = await fetch(`${base}/webhooks/wa-akg`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': sign(raw) },
    body: raw,
  });
  return res.status;
}

const started = Date.now();
const statuses = new Map();
let next = 0;
async function worker() {
  while (next < conversations) {
    const conv = next++;
    for (let n = 0; n < messages; n++) {
      const s = await send(conv, n).catch(() => 0);
      statuses.set(s, (statuses.get(s) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(
  JSON.stringify({ conversations, messagesPerConversation: messages, total: conversations * messages, seconds: Math.round((Date.now() - started) / 1000), statuses: Object.fromEntries(statuses) }),
);
