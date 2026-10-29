import { claimNextInbound, completeInbound, enqueueInbound, failInbound, type Db } from '@mvp/db';
import type { InboundMessage } from '@mvp/channel';

/** O que o webhook precisa da fila. */
export interface InboxWriter {
  /** false = já estava na fila (reentrega). */
  enqueue(message: InboundMessage): Promise<boolean>;
}

export interface ClaimedMessage {
  id: string;
  /** Número desta tentativa (1 na primeira). */
  attempts: number;
  message: InboundMessage;
}

/** O que o worker precisa da fila. */
export interface InboxReader {
  claim(): Promise<ClaimedMessage | null>;
  complete(id: string): Promise<void>;
  /** retryAt null = desiste (DEAD). */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
}

export interface InboxOptions {
  lockMs: number;
  maxAttempts: number;
}

/** Fila persistida no Postgres do bot (tabela processed_messages). */
export function createDbInbox(db: Db, opts: InboxOptions): InboxWriter & InboxReader {
  return {
    enqueue: (message) =>
      enqueueInbound(db, {
        channel: message.channel,
        sessionId: message.sessionId,
        externalId: message.externalId,
        chatKey: message.chatId,
        payload: { ...message },
      }),

    async claim() {
      const item = await claimNextInbound(db, { lockMs: opts.lockMs, maxAttempts: opts.maxAttempts });
      if (!item) return null;
      return { id: item.id, attempts: item.attempts, message: item.payload as InboundMessage };
    },

    async complete(id) {
      await completeInbound(db, id);
    },

    async fail(id, error, retryAt) {
      await failInbound(db, id, { error, retryAt });
    },
  };
}
