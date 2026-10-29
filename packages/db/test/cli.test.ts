import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeParameters } from '@mvp/simulation';
import { getParametersInForce, listParameterAudit, listParameterSets, seedDatabase } from '../src';
import { runParamsCli } from '../src/cli/params-cli';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-10-27';
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
let t: TestDb;
let tmp: string;

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runParamsCli(argv, { db: t.db, today: TODAY, out: (l) => out.push(l), err: (l) => err.push(l), cwd: tmp });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

beforeEach(async () => {
  t = await createTestDb();
  tmp = mkdtempSync(join(tmpdir(), 'params-cli-'));
  await seedDatabase(t.db, { today: TODAY });
});
afterEach(async () => {
  rmSync(tmp, { recursive: true, force: true });
  await t.drop();
});

describe('CLI de parâmetros', () => {
  it('set cria nova versão, ajusta a vigência e grava histórico consultável', async () => {
    const r = await cli('set', '--set', 'lines.sbpe.annualInterestRate=0.1199', '--from', '2026-11-01', '--by', 'ana.financeiro', '--reason', 'tabela nov/26');
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toContain('nova versão v2-2026-11-01 [ILUSTRATIVO] vigente 2026-11-01 → sem fim');
    expect(r.out).toContain(`versão ${illustrativeParameters.version} agora vigente 2026-01-01 → 2026-10-31`);
    expect(r.out).toContain('lines.sbpe.annualInterestRate: 0.1149 → 0.1199');

    const h = await cli('history');
    expect(h.code).toBe(0);
    expect(h.out).toContain('2 versão(ões)');
    expect(h.out).toMatch(/PARAMETERS_CHANGED por ana\.financeiro: tabela nov\/26/);
    expect(h.out).toContain('lines.sbpe.annualInterestRate: 0.1149 → 0.1199');
    expect(h.out).toMatch(/PARAMETERS_CLOSED por ana\.financeiro/);

    expect((await listParameterAudit(t.db)).length).toBe(3);
  });

  it('show lê a versão vigente na data pedida', async () => {
    await cli('set', '--set', 'lines.sbpe.annualInterestRate=0.1199', '--from', '2026-11-01', '--by', 'ana', '--reason', 'x');
    expect((await cli('show', '--date', '2026-10-31')).out).toMatch(/versão 2026-10-ILUSTRATIVO-v1 .*2026-01-01 → 2026-10-31/);
    const nov = await cli('show', '--date', '2026-11-01');
    expect(nov.out).toMatch(/versão v2-2026-11-01/);
    expect(nov.out).toContain('taxa 11,99% a.a. EFFECTIVE');
    const json = await cli('show', '--version', 'v2-2026-11-01', '--json');
    expect(JSON.parse(json.out).creditLines.find((l: { id: string }) => l.id === 'sbpe').annualInterestRate).toBe(0.1199);
  });

  it('import publica a tabela completa de um arquivo (ex.: exportada com show --json e editada)', async () => {
    const exported = JSON.parse((await cli('show', '--json')).out);
    exported.status = 'VALIDADO';
    exported.creditLines[0].maxLtv = 0.75;
    const file = join(tmp, 'tabela-financeiro.json');
    writeFileSync(file, JSON.stringify(exported));

    const r = await cli('import', 'tabela-financeiro.json', '--version', 'financeiro-2026-12', '--from', '2026-12-01', '--by', 'financeiro', '--reason', 'tabela validada');
    expect(r.code).toBe(0);
    expect(r.out).toContain('nova versão financeiro-2026-12 [VALIDADO]');
    const dec = await getParametersInForce(t.db, '2026-12-01', { rejectIllustrative: true });
    expect(dec.params.creditLines[0]!.maxLtv).toBe(0.75);
    expect((await listParameterAudit(t.db)).at(-2)!.action).toBe('PARAMETERS_IMPORTED');
  });

  it('erros: uso → código 2; regra violada → código 1; nada gravado', async () => {
    expect((await cli()).code).toBe(2);
    expect((await cli('apagar')).code).toBe(2);
    const missing = await cli('set', '--set', 'lines.sbpe.maxLtv=0.7', '--from', '2026-11-01');
    expect(missing).toMatchObject({ code: 2 });
    expect(missing.err).toContain('faltam opções: --by, --reason');
    const bad = await cli('set', '--set', 'lines.sbpe.maxLtv=2', '--from', '2026-11-01', '--by', 'x', '--reason', 'y');
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/^erro: .*maxLtv/);
    expect(await listParameterSets(t.db)).toHaveLength(1);
  });

  it('o script real (tsx scripts/params.ts) funciona contra o banco', async () => {
    const run = promisify(execFile);
    const env = { ...process.env, BOT_DATABASE_URL: t.url, PARAMS_TODAY: TODAY };
    const tsx = join(PKG_DIR, 'node_modules/.bin/tsx');
    const set = await run(tsx, ['scripts/params.ts', 'set', '--set', 'adjustmentToleranceRatio=0.12', '--from', '2026-11-01', '--by', 'cli', '--reason', 'teste'], { cwd: PKG_DIR, env });
    expect(set.stdout).toContain('adjustmentToleranceRatio: 0.1 → 0.12');
    const show = await run(tsx, ['scripts/params.ts', 'show', '--date', '2026-11-01'], { cwd: PKG_DIR, env });
    expect(show.stdout).toContain('tolerância de ajuste 12%');
    await expect(run(tsx, ['scripts/params.ts', 'show'], { cwd: PKG_DIR, env: { ...env, BOT_DATABASE_URL: '' } })).rejects.toMatchObject({ code: 2 });
  });
});
