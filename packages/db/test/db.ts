import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createDb, type Db } from '../src';

export interface TestDb {
  db: Db;
  url: string;
  /** Cliente pg cru, para testar as garantias do banco com SQL direto. */
  sql: (text: string, values?: unknown[]) => Promise<pg.QueryResult>;
  drop: () => Promise<void>;
}

/** Banco novo, clonado do modelo já migrado (isolado por arquivo de teste). */
export async function createTestDb(): Promise<TestDb> {
  const adminUrl = inject('pgAdminUrl');
  const name = `mvp_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name} template ${inject('pgTemplateDb')}`);
  await admin.end();

  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = createDb(url);
  const raw = new pg.Client({ connectionString: url });
  await raw.connect();

  return {
    db,
    url,
    sql: (text, values) => raw.query(text, values as unknown[]),
    drop: async () => {
      await db.$disconnect();
      await raw.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
