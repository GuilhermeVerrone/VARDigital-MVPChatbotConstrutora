// Seed idempotente. Padrão (V2): os 3 empreendimentos Elevare, condições comerciais ILUSTRATIVO,
// corretores fictícios e o admin de demo. SEED_CATALOG=exemplo usa o catálogo do MVP (Residencial Exemplo).
//   pnpm --filter @mvp/db db:seed
import { createDb, seedDatabase, seedElevare, todayIso } from '../src';
import { databaseUrl } from './env';

const db = createDb(databaseUrl());
try {
  const summary =
    process.env.SEED_CATALOG === 'exemplo' ? await seedDatabase(db, { today: todayIso() }) : await seedElevare(db, { today: todayIso() });
  console.log(JSON.stringify(summary));
} finally {
  await db.$disconnect();
}
