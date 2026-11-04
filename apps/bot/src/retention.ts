import { purgeInactive, type Db } from '@mvp/db';
import { safeError } from './lib/mask';

// Retenção configurável (LGPD, spec §7.3): de tempos em tempos apaga os leads sem atividade há mais
// de N dias, com o mesmo procedimento da exclusão a pedido do titular. O log traz só contagens.

const DAY = 24 * 60 * 60 * 1000;

export interface RetentionOptions {
  db: Db;
  /** Dias sem atividade até apagar o lead. 0 desliga a rotina. */
  days: number;
  intervalMs: number;
  log: { info(obj: object, msg: string): void; error(obj: object, msg: string): void };
  now?: () => Date;
}

export interface Retention {
  /** Uma passada; devolve o que foi apagado. */
  sweep(): Promise<{ leads: number; sessions: number; messages: number }>;
  start(): void;
  stop(): void;
}

export function createRetention(opts: RetentionOptions): Retention {
  const now = opts.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;

  async function sweep() {
    const at = now();
    const out = await purgeInactive(opts.db, { inactiveSince: new Date(at.getTime() - opts.days * DAY), now: at });
    if (out.leads + out.sessions + out.messages > 0) opts.log.info(out, 'retenção aplicada: dados inativos apagados');
    return out;
  }

  const safeSweep = () => sweep().catch((err: unknown) => void opts.log.error({ error: safeError(err) }, 'falha na rotina de retenção'));

  return {
    sweep,
    start() {
      if (opts.days <= 0 || timer) return;
      void safeSweep();
      timer = setInterval(() => void safeSweep(), opts.intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
