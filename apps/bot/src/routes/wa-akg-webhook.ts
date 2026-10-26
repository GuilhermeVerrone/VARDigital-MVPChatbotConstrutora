import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyWaAkgSignature } from '@mvp/channel';
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

    // Fase 0: só confirma recebimento. Fila/idempotência entram na Fase 3.
    return reply.code(200).send({ received: true });
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
