import { closeUnconfirmedFormLeads, purgeExpiredSessions, purgeInactive, type Db } from '@mvp/db';
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
  sweep(): Promise<{ leads: number; sessions: number; messages: number; unconfirmed: number }>;
  start(): void;
  stop(): void;
}

export function createRetention(opts: RetentionOptions): Retention {
  const now = opts.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;

  async function sweep() {
    const at = now();
    const out = await purgeInactive(opts.db, { inactiveSince: new Date(at.getTime() - opts.days * DAY), now: at });
    // Double opt-in: quem preencheu o formulário e não confirmou em 48 h é encerrado, sem mais mensagens.
    const unconfirmed = await closeUnconfirmedFormLeads(opts.db, at);
    // Sessões do painel vencidas não servem para nada: saem junto com a rotina.
    await purgeExpiredSessions(opts.db, at);
    const result = { ...out, unconfirmed };
    if (out.leads + out.sessions + out.messages + unconfirmed > 0) opts.log.info(result, 'retenção aplicada: dados inativos apagados');
    return result;
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
