// Volta o banco da demo ao estado inicial (3 empreendimentos Elevare, ILUSTRATIVO). DESTRUTIVO.
//   APP_ENV=demo pnpm --filter @mvp/db demo-reset -- --yes
import { parseArgs } from 'node:util';
import { createDb, resetDemo, todayIso } from '../src';
import { databaseUrl } from './env';

const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });

// Trava extra: o banco de produção usa as mesmas credenciais, então o reset só roda quando o ambiente
// diz, de forma explícita, que é demo ou desenvolvimento (APP_ENV ausente não basta).
const ALLOWED_ENVS = ['demo', 'development', 'test'];
if (!ALLOWED_ENVS.includes(process.env.APP_ENV ?? '')) {
  console.error(`demo-reset exige APP_ENV=${ALLOWED_ENVS.join('|')} (valor atual: ${process.env.APP_ENV ?? 'vazio'})`);
  process.exit(2);
}

const db = createDb(databaseUrl());
try {
  const summary = await resetDemo(db, { today: todayIso(), confirm: values.yes === true, appEnv: process.env.APP_ENV });
  console.log(JSON.stringify(summary));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
