import type { Db } from './client';
import type { Prisma } from './generated/prisma/client';

// Fila de entregas de saída (tabela delivery_jobs): sincronização com o CRM e aviso ao corretor.
// Mesmas decisões da fila de entrada: o job é gravado antes de tentar entregar, a reserva expira
// (lockedUntil) para outro worker retomar, e `dedupeKey` impede enfileirar a mesma entrega duas vezes.

export type JobKind = 'CRM_SYNC' | 'BROKER_NOTIFY';

export interface EnqueueJobArgs {
  kind: JobKind;
  simulationId: string;
  /** Padrão: "<kind>:<simulationId>". Use um sufixo para permitir reenvios (ex.: após ajuste). */
  dedupeKey?: string;
  payload?: Prisma.InputJsonValue;
  availableAt?: Date;
}

export interface DeliveryJobItem {
  id: string;
  kind: JobKind;
  simulationId: string;
  payload: unknown;
  /** Número desta tentativa (1 na primeira). */
  attempts: number;
}

export interface ClaimJobOptions {
  now?: Date;
  lockMs: number;
  maxAttempts: number;
  /** Só reserva estes tipos (padrão: todos). */
  kinds?: JobKind[];
}

/** Enfileira a entrega. Retorna false se já existia (nada é alterado). */
export async function enqueueJob(db: Pick<Db, 'deliveryJob'>, a: EnqueueJobArgs): Promise<boolean> {
  const { count } = await db.deliveryJob.createMany({
    data: [
      {
        kind: a.kind,
        simulationId: a.simulationId,
        dedupeKey: a.dedupeKey ?? `${a.kind}:${a.simulationId}`,
        payload: a.payload ?? {},
        ...(a.availableAt ? { availableAt: a.availableAt } : {}),
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

/** Reserva o próximo job elegível (ou null). Cada chamada conta uma tentativa. */
export async function claimNextJob(db: Db, opts: ClaimJobOptions): Promise<DeliveryJobItem | null> {
  const now = opts.now ?? new Date();
  const lockedUntil = new Date(now.getTime() + opts.lockMs);
  const kinds = opts.kinds ?? ['CRM_SYNC', 'BROKER_NOTIFY'];

  // Reserva vencida de job que já gastou todas as tentativas: encerra como DEAD.
  await db.$executeRaw`
    UPDATE delivery_jobs
       SET status = 'DEAD'::"JobStatus", locked_until = NULL,
           last_error = COALESCE(last_error, 'reserva expirada após esgotar as tentativas')
     WHERE status = 'PROCESSING'::"JobStatus" AND locked_until < ${now} AND attempts >= ${opts.maxAttempts}`;

  const rows = await db.$queryRaw<{ id: string; kind: JobKind; simulation_id: string; payload: unknown; attempts: number }[]>`
    UPDATE delivery_jobs
       SET status = 'PROCESSING'::"JobStatus", attempts = attempts + 1, locked_until = ${lockedUntil}
     WHERE id = (
       SELECT c.id FROM delivery_jobs c
        WHERE ((c.status = 'PENDING'::"JobStatus" AND c.available_at <= ${now})
            OR (c.status = 'PROCESSING'::"JobStatus" AND c.locked_until < ${now}))
          AND c.attempts < ${opts.maxAttempts}
          AND c.kind = ANY(${kinds})
        ORDER BY c.available_at, c.created_at, c.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, simulation_id, payload, attempts`;

  const row = rows[0];
  return row ? { id: row.id, kind: row.kind, simulationId: row.simulation_id, payload: row.payload, attempts: row.attempts } : null;
}

export async function completeJob(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await db.deliveryJob.updateMany({
    where: { id, status: 'PROCESSING' },
    data: { status: 'DONE', processedAt: now, lockedUntil: null, lastError: null },
  });
  return count === 1;
}

/** Registra a falha. Com `retryAt` o job volta para a fila; sem ele, vira DEAD. */
export async function failJob(db: Db, id: string, opts: { error: string; retryAt: Date | null }): Promise<boolean> {
  const { count } = await db.deliveryJob.updateMany({
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

/** Devolve um job DEAD para a fila (reenvio manual depois de corrigir a causa). */
export async function requeueDeadJob(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await db.deliveryJob.updateMany({
    where: { id, status: 'DEAD' },
    data: { status: 'PENDING', attempts: 0, availableAt: now, lockedUntil: null },
  });
  return count === 1;
}
