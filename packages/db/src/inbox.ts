import type { Channel } from './generated/prisma/enums';
import type { Db } from './client';
import { Prisma } from './generated/prisma/client';

// Fila de entrada em Postgres (tabela processed_messages). Ordem de prioridade das decisões:
//  1. o webhook nunca perde mensagem: grava e responde (enqueueInbound);
//  2. o mesmo key.id entra uma vez só (índice único), mesmo com reentrega;
//  3. a reserva expira (lockedUntil): se o worker cai, outro retoma;
//  4. mensagens da mesma conversa saem em ordem: enquanto houver uma anterior pendente ou em
//     processamento, as seguintes esperam.

export interface EnqueueInboundArgs {
  channel: Channel;
  sessionId: string;
  externalId: string;
  chatKey: string;
  payload: Prisma.InputJsonValue;
  receivedAt?: Date;
}

export interface InboxItem {
  id: string;
  channel: Channel;
  sessionId: string;
  externalId: string;
  chatKey: string;
  payload: unknown;
  /** Número desta tentativa (1 na primeira). */
  attempts: number;
}

export interface ClaimOptions {
  now?: Date;
  /** Por quanto tempo o worker reserva a mensagem antes de outro poder retomá-la. */
  lockMs: number;
  maxAttempts: number;
}

/** Grava a mensagem na fila. Retorna false se já existia (reentrega): nada é alterado. */
export async function enqueueInbound(db: Db, args: EnqueueInboundArgs): Promise<boolean> {
  const { count } = await db.processedMessage.createMany({
    data: [
      {
        channel: args.channel,
        sessionId: args.sessionId,
        externalId: args.externalId,
        chatKey: args.chatKey,
        payload: args.payload,
        ...(args.receivedAt ? { receivedAt: args.receivedAt, availableAt: args.receivedAt } : {}),
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

/**
 * Reserva a próxima mensagem elegível (ou null). Cada chamada conta uma tentativa. Seguro com
 * vários workers: `FOR UPDATE SKIP LOCKED` evita que dois peguem a mesma linha.
 */
export async function claimNextInbound(db: Db, opts: ClaimOptions): Promise<InboxItem | null> {
  const now = opts.now ?? new Date();
  const lockedUntil = new Date(now.getTime() + opts.lockMs);

  // Reserva vencida de mensagem que já gastou todas as tentativas: encerra como DEAD, senão
  // bloquearia para sempre as mensagens seguintes da mesma conversa.
  await db.$executeRaw`
    UPDATE processed_messages
       SET status = 'DEAD'::"InboxStatus", locked_until = NULL,
           last_error = COALESCE(last_error, 'reserva expirada após esgotar as tentativas')
     WHERE status = 'PROCESSING'::"InboxStatus" AND locked_until < ${now} AND attempts >= ${opts.maxAttempts}`;

  const rows = await db.$queryRaw<
    { id: string; channel: Channel; session_id: string; external_id: string; chat_key: string; payload: unknown; attempts: number }[]
  >`
    UPDATE processed_messages
       SET status = 'PROCESSING'::"InboxStatus", attempts = attempts + 1, locked_until = ${lockedUntil}
     WHERE id = (
       SELECT c.id FROM processed_messages c
        WHERE ((c.status = 'PENDING'::"InboxStatus" AND c.available_at <= ${now})
            OR (c.status = 'PROCESSING'::"InboxStatus" AND c.locked_until < ${now}))
          AND c.attempts < ${opts.maxAttempts}
          AND NOT EXISTS (
                SELECT 1 FROM processed_messages e
                 WHERE e.chat_key = c.chat_key AND e.id <> c.id
                   AND e.status IN ('PENDING'::"InboxStatus", 'PROCESSING'::"InboxStatus")
                   AND (e.received_at, e.id) < (c.received_at, c.id))
        ORDER BY c.received_at, c.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING id, channel, session_id, external_id, chat_key, payload, attempts`;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    sessionId: row.session_id,
    externalId: row.external_id,
    chatKey: row.chat_key,
    payload: row.payload,
    attempts: row.attempts,
  };
}

/** Conclui a mensagem e apaga o conteúdo (payload): só os identificadores permanecem. */
export async function completeInbound(db: Db, id: string, opts: { now?: Date; leadId?: string } = {}): Promise<boolean> {
  const { count } = await db.processedMessage.updateMany({
    where: { id, status: 'PROCESSING' },
    data: {
      status: 'DONE',
      payload: Prisma.DbNull,
      processedAt: opts.now ?? new Date(),
      lockedUntil: null,
      lastError: null,
      ...(opts.leadId ? { leadId: opts.leadId } : {}),
    },
  });
  return count === 1;
}

/** Registra a falha. Com `retryAt` a mensagem volta para a fila; sem ele, vira DEAD. */
export async function failInbound(
  db: Db,
  id: string,
  opts: { error: string; retryAt: Date | null },
): Promise<boolean> {
  const { count } = await db.processedMessage.updateMany({
    where: { id, status: 'PROCESSING' },
    data: {
      status: opts.retryAt ? 'PENDING' : 'DEAD',
      lastError: opts.error.slice(0, 1000),
      lockedUntil: null,
      ...(opts.retryAt ? { availableAt: opts.retryAt } : {}),
    },
  });
  return count === 1;
}
