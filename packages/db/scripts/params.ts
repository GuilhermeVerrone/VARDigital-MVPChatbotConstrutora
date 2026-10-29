// CLI de parâmetros financeiros com vigência e auditoria.
//   pnpm --filter @mvp/db params show
//   pnpm --filter @mvp/db params set --set lines.sbpe.annualInterestRate=0.1199 --from 2026-11-01 --by ana --reason "tabela nov/26"
// Caminhos de arquivo relativos ao diretório de onde o comando foi chamado.
import { createDb, todayIso } from '../src';
import { runParamsCli } from '../src/cli/params-cli';
import { databaseUrl } from './env';

const db = createDb(databaseUrl());
try {
  process.exitCode = await runParamsCli(process.argv.slice(2), {
    db,
    today: process.env.PARAMS_TODAY ?? todayIso(),
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    cwd: process.env.INIT_CWD ?? process.cwd(),
  });
} finally {
  await db.$disconnect();
}
