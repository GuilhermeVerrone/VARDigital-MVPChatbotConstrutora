import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type Db = PrismaClient;
/** Cliente dentro de uma transação interativa (`db.$transaction(async (tx) => ...)`). */
export type DbTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Cliente Prisma sobre o driver `pg` (Prisma 7 usa driver adapter, sem engine binária). */
export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
