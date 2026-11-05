import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFakeWaAkg, type FakeWaAkg } from './fake-wa-akg';

// Sobe a stack inteira para o e2e, sem Docker: Postgres descartável (initdb), bot, site e painel (builds
// de produção, com a CSP e os cabeçalhos reais) e o WA-AKG falso. Mede a memória (RSS) de cada processo
// durante a execução e grava em e2e/.output/memory.json. E2E_SKIP_BUILD=1 reaproveita os builds do .next.

export const ROOT = resolve(import.meta.dirname, '../..');
export const OUT = join(ROOT, 'e2e/.output');

/** Telefones usados nos roteiros; todos precisam estar em ALLOWED_PHONES do bot. */
export const LEAD_PHONES = ['5541988880001', '5541988880002', '5541988880003', '5541988880004', '5541988880005', '5541988880006'];
const BROKER_PHONES = ['5500900000011', '5500900000012', '5500900000013'];

const WEBHOOK_SECRET = 'e2e-webhook-secret-0123456789';
const FAKE_KEY = 'e2e-api-key';
const SESSION = 'piloto';

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
}

async function waitForHttp(url: string, ms = 90_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`não respondeu a tempo: ${url} (veja e2e/.output/*.log)`);
}

interface Proc {
  label: string;
  child: ChildProcess;
}

function run(label: string, cmd: string, args: string[], cwd: string, env: Record<string, string>): Proc {
  const fd = openSync(join(OUT, `${label}.log`), 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return { label, child };
}

function sh(cmd: string, args: string[], cwd: string, env: Record<string, string>, label: string): void {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  writeFileSync(join(OUT, `${label}.log`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  if (r.status !== 0) throw new Error(`${label} falhou (veja e2e/.output/${label}.log)`);
}

/** RSS (MiB) somado da árvore de processos de cada raiz. */
function sampleRss(roots: Record<string, number>): Record<string, number> {
  const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).stdout;
  const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number, number]);
  const kids = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const [pid, ppid, kb] of rows) {
    rss.set(pid, kb);
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  const total = (pid: number): number => (rss.get(pid) ?? 0) + (kids.get(pid) ?? []).reduce((s, k) => s + total(k), 0);
  return Object.fromEntries(Object.entries(roots).map(([label, pid]) => [label, Math.round((total(pid) / 1024) * 10) / 10]));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const bin of ['initdb', 'pg_ctl']) {
    if (spawnSync(bin, ['--version'], { stdio: 'ignore' }).status !== 0) throw new Error(`o e2e precisa do PostgreSQL no PATH (${bin} não encontrado)`);
  }

  const procs: Proc[] = [];
  let fake: FakeWaAkg | undefined;
  const pgDir = mkdtempSync(join(tmpdir(), 'mvp-e2e-pg-'));
  const [pgPort, botPort, sitePort, painelPort, fakePort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
  let sampler: NodeJS.Timeout | undefined;
  const peak: Record<string, number> = {};
  let idle: Record<string, number> = {};

  const teardown = async () => {
    if (sampler) clearInterval(sampler);
    writeFileSync(join(OUT, 'memory.json'), JSON.stringify({ unit: 'MiB (RSS, árvore de processos)', platform: process.platform, idle, peak }, null, 2));
    for (const p of procs) {
      try {
        process.kill(-p.child.pid!, 'SIGTERM');
      } catch {
        /* já saiu */
      }
    }
    await fake?.close();
    spawnSync('pg_ctl', ['-D', join(pgDir, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
    rmSync(pgDir, { recursive: true, force: true });
  };

  try {
    // 1. Banco
    execFileSync('initdb', ['-D', join(pgDir, 'data'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
    execFileSync('pg_ctl', ['-D', join(pgDir, 'data'), '-l', join(pgDir, 'log'), '-w', '-o', `-p ${pgPort} -k ${pgDir} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'], { stdio: 'ignore' });
    execFileSync('psql', ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', '-c', 'create database bot'], { stdio: 'ignore' });
    const dbUrl = `postgresql://postgres@127.0.0.1:${pgPort}/bot`;
    const dbPkg = join(ROOT, 'packages/db');
    sh(join(dbPkg, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], dbPkg, { BOT_DATABASE_URL: dbUrl }, 'migrate');
    sh(join(dbPkg, 'node_modules/.bin/tsx'), ['scripts/seed.ts'], dbPkg, { BOT_DATABASE_URL: dbUrl, APP_ENV: 'test' }, 'seed');

    // 2. WA-AKG falso
    fake = await startFakeWaAkg(fakePort, FAKE_KEY);

    // 3. Builds de produção do site e do painel
    const siteEnv = { SITE_DATABASE_URL: dbUrl, SITE_FORM_SECRET: 'e2e-form-secret-0123456789', SITE_WHATSAPP_NUMBER: '5541900000000', NEXT_TELEMETRY_DISABLED: '1' };
    const painelEnv = {
      PANEL_DATABASE_URL: dbUrl,
      PANEL_INSECURE_COOKIES: 'true', // o e2e roda em http local
      WA_AKG_BASE_URL: `http://127.0.0.1:${fakePort}`,
      WA_AKG_API_KEY: FAKE_KEY,
      WA_AKG_SESSION_ID: SESSION,
      NEXT_TELEMETRY_DISABLED: '1',
    };
    if (process.env.E2E_SKIP_BUILD !== '1' || !existsSync(join(ROOT, 'apps/site/.next/BUILD_ID')) || !existsSync(join(ROOT, 'apps/painel/.next/BUILD_ID'))) {
      sh('pnpm', ['--filter', '@mvp/site', 'build'], ROOT, { ...siteEnv, NODE_ENV: 'production' }, 'build-site');
      sh('pnpm', ['--filter', '@mvp/painel', 'build'], ROOT, { ...painelEnv, NODE_ENV: 'production' }, 'build-painel');
    }
    // Nada de segredo ou dado pessoal no que vai ao navegador (aceite "Nenhum dado pessoal ou segredo no bundle do cliente").
    sh('pnpm', ['--filter', '@mvp/site', 'check-bundle'], ROOT, siteEnv, 'check-bundle');

    // 4. Processos
    const botEnv = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      BOT_HOST: '127.0.0.1',
      BOT_PORT: String(botPort),
      BOT_DATABASE_URL: dbUrl,
      WA_AKG_WEBHOOK_SECRET: WEBHOOK_SECRET,
      WA_AKG_BASE_URL: `http://127.0.0.1:${fakePort}`,
      WA_AKG_API_KEY: FAKE_KEY,
      WA_AKG_SESSION_ID: SESSION,
      ALLOWED_PHONES: [...LEAD_PHONES, ...BROKER_PHONES].join(','),
      CHAT_HASH_SECRET: 'e2e-chat-hash-secret-0123456789',
      LLM_ENABLED: 'false', // os roteiros usam só os parsers: resultado igual em qualquer máquina, sem chave nem custo
      TYPING_MAX_MS: '0',
      INBOX_POLL_MS: '200',
      DELIVERY_POLL_MS: '200',
      FIRST_CONTACT_START: '00:00',
      FIRST_CONTACT_END: '23:59',
      FIRST_CONTACT_DAYS: '0-6',
      RATE_LIMIT_PER_MIN: '0',
      PROMPTS_DIR: join(ROOT, 'prompts'),
    };
    procs.push(run('bot', join(ROOT, 'apps/bot/node_modules/.bin/tsx'), ['src/main.ts'], join(ROOT, 'apps/bot'), botEnv));
    procs.push(run('site', join(ROOT, 'apps/site/node_modules/.bin/next'), ['start', '-p', String(sitePort), '-H', '127.0.0.1'], join(ROOT, 'apps/site'), { ...siteEnv, NODE_ENV: 'production' }));
    procs.push(run('painel', join(ROOT, 'apps/painel/node_modules/.bin/next'), ['start', '-p', String(painelPort), '-H', '127.0.0.1'], join(ROOT, 'apps/painel'), { ...painelEnv, NODE_ENV: 'production' }));

    const botUrl = `http://127.0.0.1:${botPort}`;
    await Promise.all([waitForHttp(`${botUrl}/health`), waitForHttp(`http://127.0.0.1:${sitePort}/`), waitForHttp(`http://127.0.0.1:${painelPort}/login`)]);

    // 5. Memória: amostra a cada 2 s; "idle" é a primeira leitura com tudo no ar, antes dos testes.
    const roots: Record<string, number> = { bot: procs[0]!.child.pid!, site: procs[1]!.child.pid!, painel: procs[2]!.child.pid!, 'fake-wa-akg': process.pid };
    const pidFile = join(pgDir, 'data/postmaster.pid');
    if (existsSync(pidFile)) roots.postgres = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
    delete roots['fake-wa-akg']; // roda dentro do processo do runner; não entra na medição da stack
    await new Promise((r) => setTimeout(r, 3000));
    idle = sampleRss(roots);
    sampler = setInterval(() => {
      for (const [k, v] of Object.entries(sampleRss(roots))) peak[k] = Math.max(peak[k] ?? 0, v);
    }, 2000);
    sampler.unref();

    Object.assign(process.env, {
      E2E_BOT_URL: botUrl,
      E2E_SITE_URL: `http://127.0.0.1:${sitePort}`,
      E2E_PAINEL_URL: `http://127.0.0.1:${painelPort}`,
      E2E_FAKE_WA_URL: `http://127.0.0.1:${fakePort}`,
      E2E_WEBHOOK_SECRET: WEBHOOK_SECRET,
      E2E_WA_SESSION: SESSION,
      E2E_DATABASE_URL: dbUrl,
      E2E_LEAD_PHONES: LEAD_PHONES.join(','),
    });
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
