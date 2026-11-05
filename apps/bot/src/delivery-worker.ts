import { claimNextJob, completeJob, deferJob, failJob, type Db, type DeliveryJobItem } from '@mvp/db';
import { DeferJobError, isPermanent } from './delivery';
import { safeError } from './lib/mask';
import type { Worker, WorkerLogger } from './worker';

export interface DeliveryWorkerOptions {
  db: Db;
  handle(job: DeliveryJobItem): Promise<void>;
  log: WorkerLogger;
  maxAttempts: number;
  lockMs: number;
  pollMs?: number;
  /** Espera antes da próxima tentativa, dado o número da tentativa que falhou. */
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
}

const defaultBackoff = (attempt: number) => Math.min(5_000 * 2 ** (attempt - 1), 5 * 60_000);

/**
 * Consome a fila de entregas (CRM e corretor). Mesma garantia da fila de entrada: pelo menos uma
 * vez, com espera crescente entre tentativas; esgotadas, o job fica DEAD com o último erro para
 * inspeção. Os logs trazem só ids (nenhum dado pessoal).
 */
export function createDeliveryWorker(opts: DeliveryWorkerOptions): Worker {
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
    const job = await claimNextJob(opts.db, { lockMs: opts.lockMs, maxAttempts: opts.maxAttempts, now: now() });
    if (!job) return false;
    const ctx = { jobId: job.id, kind: job.kind, simulationId: job.simulationId, attempt: job.attempts };
    try {
      await opts.handle(job);
    } catch (err) {
      if (err instanceof DeferJobError) {
        opts.log.info({ ...ctx, until: err.until.toISOString(), reason: err.message }, 'entrega adiada');
        await deferJob(opts.db, job.id, err.until, err.message);
        return true;
      }
      const error = safeError(err);
      const permanent = isPermanent(err);
      if (permanent || job.attempts >= opts.maxAttempts) {
        opts.log.error({ ...ctx, error, permanent }, 'entrega descartada (DEAD): requer atenção');
        await failJob(opts.db, job.id, { error, retryAt: null });
      } else {
        const delay = backoff(job.attempts);
        opts.log.warn({ ...ctx, error, retryInMs: delay }, 'falha na entrega; nova tentativa agendada');
        await failJob(opts.db, job.id, { error, retryAt: new Date(now().getTime() + delay) });
      }
      return true;
    }
    await completeJob(opts.db, job.id, now());
    opts.log.info(ctx, 'entrega concluída');
    return true;
  }

  async function loop() {
    while (!stopped) {
      try {
        if (await processOne()) continue;
      } catch (err) {
        opts.log.error({ error: safeError(err) }, 'erro no worker de entregas');
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
