import type { Db } from './client';
import { seedElevare, type ElevareSeedSummary, type SeedElevareOptions } from './seed-elevare';

// demo-reset: devolve o banco da demo ao estado inicial (os 3 empreendimentos Elevare do seed),
// apagando leads, conversas, simulações, filas, CRM simulado, versões publicadas, usuários e auditoria.
// Idempotente: rodar de novo termina no mesmo estado. DESTRUTIVO por natureza: só roda com
// confirmação explícita e nunca em produção. O TRUNCATE ignora os triggers de imutabilidade (que
// protegem as versões no uso normal), por isso a trava aqui é de quem chama.

export class DemoResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoResetRefusedError';
  }
}

export interface DemoResetOptions extends SeedElevareOptions {
  /** Confirmação explícita de que o banco pode ser apagado. */
  confirm: boolean;
  /** Ambiente (APP_ENV). Em 'production' o reset é recusado. */
  appEnv?: string;
}

export interface DemoResetSummary {
  truncatedTables: number;
  seed: ElevareSeedSummary;
}

export async function resetDemo(db: Db, opts: DemoResetOptions): Promise<DemoResetSummary> {
  if (opts.appEnv === 'production') throw new DemoResetRefusedError('demo-reset não roda com APP_ENV=production');
  if (!opts.confirm) throw new DemoResetRefusedError('demo-reset apaga todos os dados do banco; confirme com --yes');

  const tables = await db.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations' order by 1`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`truncate table ${list} restart identity cascade`);

  const seed = await seedElevare(db, opts);
  return { truncatedTables: tables.length, seed };
}
