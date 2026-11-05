import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

// Banco de teste real (as garantias de vigência e imutabilidade estão em constraints/triggers,
// que só um Postgres de verdade exercita):
//   - TEST_DATABASE_URL definido → usa esse servidor (precisa de permissão para CREATE DATABASE);
//   - senão, se initdb/pg_ctl existirem no PATH → cluster descartável em diretório temporário;
//   - senão → falha com instrução (não pula: teste de banco ausente não pode passar em silêncio).
// As migrations do repositório são aplicadas UMA vez num banco-modelo; cada arquivo de teste
// clona o modelo (CREATE DATABASE ... TEMPLATE), isolado dos demais.

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
    pgTemplateDb: string;
  }
}

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function has(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
}

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export default async function setup(project: TestProject) {
  let adminUrl = process.env.TEST_DATABASE_URL;
  let stop = () => {};

  if (!adminUrl) {
    if (!has('initdb') || !has('pg_ctl')) {
      throw new Error(
        'testes do @mvp/db precisam de PostgreSQL: defina TEST_DATABASE_URL (ex.: postgresql://postgres:senha@127.0.0.1:5432/postgres) ' +
          'ou instale os binários do PostgreSQL (initdb/pg_ctl) no PATH.',
      );
    }
    const dir = mkdtempSync(join(tmpdir(), 'mvp-db-test-'));
    const port = await freePort();
    execFileSync('initdb', ['-D', join(dir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'log'), '-w', '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'], {
      stdio: 'ignore',
    });
    adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    stop = () => {
      spawnSync('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const templateDb = `mvp_test_template_${process.pid}`;
  try {
    await admin(adminUrl, async (c) => {
      await c.query(`drop database if exists ${templateDb}`);
      await c.query(`create database ${templateDb}`);
    });
    const win = process.platform === 'win32';
    execFileSync(join(PKG_DIR, 'node_modules/.bin', win ? 'prisma.CMD' : 'prisma'), ['migrate', 'deploy'], {
      cwd: PKG_DIR,
      shell: win,
      env: { ...process.env, BOT_DATABASE_URL: withDb(adminUrl, templateDb) },
      stdio: 'pipe',
    });
  } catch (e) {
    stop();
    throw e;
  }

  project.provide('pgAdminUrl', adminUrl);
  project.provide('pgTemplateDb', templateDb);

  return async () => {
    if (process.env.TEST_DATABASE_URL) {
      await admin(adminUrl, (c) => c.query(`drop database if exists ${templateDb}`));
    }
    stop();
  };
}
