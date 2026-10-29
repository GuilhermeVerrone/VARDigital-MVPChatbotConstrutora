import { z } from 'zod';
import type { InboundMessage, InboundType, ParsedWebhook } from './types';

// Formato confirmado no código do WA-AKG v1.7.0 (src/lib/webhook.ts → onMessageReceived).
// Tolerante de propósito: campos além dos usados aqui são ignorados.
const envelopeSchema = z.object({
  event: z.string(),
  sessionId: z.string().min(1),
  timestamp: z.string(),
  data: z.unknown(),
});

const dataSchema = z.object({
  key: z.object({
    id: z.string().min(1),
    remoteJid: z.string().min(1),
    fromMe: z.boolean().optional().default(false),
  }),
  pushName: z.string().nullish(),
  isGroup: z.boolean().optional().default(false),
  chatType: z.string().optional(),
  type: z.string().optional(),
  content: z.unknown().optional(),
  caption: z.string().nullish(),
});

const TYPES: Record<string, InboundType> = {
  TEXT: 'text',
  AUDIO: 'audio',
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
  STICKER: 'sticker',
  LOCATION: 'location',
  CONTACT: 'contact',
  INTERACTIVE_RESPONSE: 'interactive_response',
  BUTTON_RESPONSE: 'interactive_response',
  LIST_RESPONSE: 'interactive_response',
};

/**
 * Converte o envelope do webhook em mensagem normalizada ou diz por que ignorar.
 * Ignora: eventos que não são `message.received`, mensagens do próprio número (`fromMe`),
 * grupos, status/canais (qualquer conversa que não seja individual).
 */
export function parseWaAkgWebhook(envelope: unknown): ParsedWebhook {
  const env = envelopeSchema.safeParse(envelope);
  if (!env.success) return { ok: false, reason: 'invalid_payload' };
  if (env.data.event !== 'message.received') return { ok: false, reason: 'not_message_event' };

  const data = dataSchema.safeParse(env.data.data);
  if (!data.success) return { ok: false, reason: 'invalid_payload' };
  const d = data.data;

  const jid = d.key.remoteJid;
  if (d.key.fromMe) return { ok: false, reason: 'from_me' };
  if (d.isGroup || d.chatType === 'GROUP' || jid.endsWith('@g.us')) return { ok: false, reason: 'group' };
  if (d.chatType !== undefined && d.chatType !== 'PERSONAL') return { ok: false, reason: 'not_personal_chat' };
  if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return { ok: false, reason: 'not_personal_chat' };

  const type = TYPES[(d.type ?? '').toUpperCase()] ?? 'unknown';
  const content = typeof d.content === 'string' ? d.content : null;
  const text = type === 'text' || type === 'interactive_response' ? content : (d.caption ?? null);

  const message: InboundMessage = {
    channel: 'WHATSAPP',
    sessionId: env.data.sessionId,
    externalId: d.key.id,
    chatId: jid,
    phone: phoneFromJid(jid),
    pushName: d.pushName ?? null,
    type,
    text: text === '' ? null : text,
    receivedAt: env.data.timestamp,
  };
  return { ok: true, message };
}

/** "5511987654321@s.whatsapp.net" → "5511987654321". LID e outros formatos → null. */
export function phoneFromJid(jid: string): string | null {
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m?.[1] ?? null;
}
