import { ChannelError, type InboundMessage } from '@mvp/channel';
import { maskJid, safeError } from './lib/mask';
import type { InboxReader } from './inbox';

export interface WorkerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface WorkerOptions {
  inbox: InboxReader;
  handle(message: InboundMessage): Promise<void>;
  log: WorkerLogger;
  maxAttempts: number;
  pollMs?: number;
  /** Espera antes da próxima tentativa, dado o número da tentativa que falhou. */
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
}

export interface Worker {
  start(): void;
  /** Acorda o worker já (chamado após gravar uma mensagem nova). */
  kick(): void;
  /** Termina a mensagem em andamento e para. */
  stop(): Promise<void>;
}

const defaultBackoff = (attempt: number) => Math.min(5_000 * 2 ** (attempt - 1), 5 * 60_000);

/**
 * Consome a fila de entrada, uma mensagem por vez (suficiente para o MVP com LLM local; a
 * ordem por conversa também é garantida pela fila). Entrega pelo menos uma vez: se o processo
 * cair entre o efeito do handler e `complete`, a mensagem volta e o handler roda de novo.
 */
export function createWorker(opts: WorkerOptions): Worker {
  const pollMs = opts.pollMs ?? 1000;
  const backoff = opts.backoffMs ?? defaultBackoff;
  const now = opts.now ?? (() => new Date());

  let running: Promise<void> | null = null;
  let stopped = false;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        wake = null;
        resolve();
      }
      wake = done;
    });

  async function processOne(): Promise<boolean> {
    const claimed = await opts.inbox.claim();
    if (!claimed) return false;
    const { id, attempts, message } = claimed;
    const ctx = { messageId: message?.externalId, chat: maskJid(message?.chatId), attempt: attempts };

    try {
      await opts.handle(message);
    } catch (err) {
      const error = safeError(err);
      const permanent = err instanceof ChannelError && !err.retryable;
      if (permanent || attempts >= opts.maxAttempts) {
        opts.log.error({ ...ctx, error, permanent }, 'mensagem descartada (DEAD)');
        await opts.inbox.fail(id, error, null);
      } else {
        const delay = backoff(attempts);
        opts.log.warn({ ...ctx, error, retryInMs: delay }, 'falha ao processar; nova tentativa agendada');
        await opts.inbox.fail(id, error, new Date(now().getTime() + delay));
      }
      return true;
    }

    await opts.inbox.complete(id);
    opts.log.info(ctx, 'mensagem processada');
    return true;
  }

  async function loop() {
    while (!stopped) {
      try {
        if (await processOne()) continue;
      } catch (err) {
        // Banco fora, por exemplo: não derruba o processo; tenta de novo no próximo ciclo.
        opts.log.error({ error: safeError(err) }, 'erro no worker');
      }
      if (!stopped) await sleep(pollMs);
    }
  }

  return {
    start() {
      if (running) return;
      stopped = false;
      running = loop();
    },
    kick() {
      wake?.();
    },
    async stop() {
      stopped = true;
      wake?.();
      await running;
      running = null;
    },
  };
}
