// Volta o banco da demo ao estado inicial (3 empreendimentos Elevare, ILUSTRATIVO). DESTRUTIVO.
//   pnpm --filter @mvp/db demo-reset -- --yes
import { parseArgs } from 'node:util';
import { createDb, resetDemo, todayIso } from '../src';
import { databaseUrl } from './env';

const { values } = parseArgs({ options: { yes: { type: 'boolean', default: false } } });

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
