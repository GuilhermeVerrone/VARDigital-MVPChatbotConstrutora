import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseWaAkgWebhook, type PhoneAllowlist, verifyWaAkgSignature } from '@mvp/channel';
import type { InboxWriter } from '../inbox';
import { maskJid } from '../lib/mask';

export const WA_AKG_WEBHOOK_PATH = '/webhooks/wa-akg';

// Envelope comum a todos os eventos do WA-AKG (src/lib/webhook.ts → WebhookPayload).
const envelopeSchema = z.object({
  event: z.string().min(1),
  sessionId: z.string(),
  timestamp: z.string(),
  data: z.unknown(),
});

export interface WaAkgWebhookOptions {
  secret: string;
  inbox: InboxWriter;
  /** Só mensagens desta sessão do WA-AKG entram na fila. */
  sessionId: string;
  /** Só quem está na lista entra na fila; os demais são descartados sem gravar nada. */
  allowlist: PhoneAllowlist;
  /** Chamado depois de gravar uma mensagem nova (acorda o worker). */
  onEnqueued?: (() => void) | undefined;
  captureDir?: string | undefined;
}

export function waAkgWebhookRoutes(app: FastifyInstance, opts: WaAkgWebhookOptions) {
  // Mantém o corpo bruto: a assinatura HMAC é calculada sobre os bytes exatos enviados.
  app.removeContentTypeParser(['application/json']);
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post(WA_AKG_WEBHOOK_PATH, async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!verifyWaAkgSignature(raw, req.headers['x-webhook-signature'], opts.secret)) {
      req.log.warn({ hasSignature: Boolean(req.headers['x-webhook-signature']) }, 'webhook rejeitado: assinatura inválida');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    let envelope: z.infer<typeof envelopeSchema>;
    try {
      envelope = envelopeSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      req.log.warn('webhook rejeitado: corpo inválido');
      return reply.code(400).send({ error: 'invalid payload' });
    }

    req.log.info({ event: envelope.event, sessionId: envelope.sessionId, ...summarize(envelope) }, 'webhook recebido');

    if (opts.captureDir) await capture(opts.captureDir, envelope.event, raw);

    const parsed = parseWaAkgWebhook(envelope);
    if (!parsed.ok) {
      // Eventos que não são mensagem (connection.update, message.sent…) são esperados: 200 sem fila.
      if (parsed.reason === 'invalid_payload') req.log.warn('message.received com formato inesperado; ignorado');
      return reply.code(200).send({ received: true, ignored: parsed.reason });
    }
    if (parsed.message.sessionId !== opts.sessionId) {
      return reply.code(200).send({ received: true, ignored: 'other_session' });
    }

    if (!opts.allowlist.isAllowed(parsed.message.chatId)) {
      req.log.warn({ chat: maskJid(parsed.message.chatId) }, 'remetente fora da lista de permitidos; descartado');
      return reply.code(200).send({ received: true, ignored: 'not_allowed' });
    }

    // Grava e responde. Se a gravação falhar, 500: o WA-AKG não reenvia (uma tentativa), então o
    // erro precisa ficar visível no log.
    let created: boolean;
    try {
      created = await opts.inbox.enqueue(parsed.message);
    } catch (err) {
      req.log.error({ err, messageId: parsed.message.externalId }, 'falha ao gravar mensagem na fila');
      return reply.code(500).send({ error: 'enqueue failed' });
    }
    if (created) opts.onEnqueued?.();
    else req.log.info({ messageId: parsed.message.externalId }, 'reentrega ignorada (já na fila)');
    return reply.code(200).send({ received: true, queued: created, duplicate: !created });
  });
}

/** Resumo seguro para log: nunca inclui conteúdo da mensagem nem telefone em claro. */
function summarize(envelope: z.infer<typeof envelopeSchema>): Record<string, unknown> {
  if (envelope.event !== 'message.received' || typeof envelope.data !== 'object' || envelope.data === null) return {};
  const d = envelope.data as Record<string, unknown>;
  const key = (d.key ?? {}) as Record<string, unknown>;
  return {
    messageId: key.id,
    fromMe: key.fromMe,
    from: maskJid(d.from),
    remoteJid: maskJid(key.remoteJid),
    type: d.type,
    isGroup: d.isGroup,
  };
}

async function capture(dir: string, event: string, raw: Buffer) {
  await mkdir(dir, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, '-')}_${event.replace(/[^a-z0-9.]/gi, '_')}.json`;
  await writeFile(path.join(dir, file), raw);
}
