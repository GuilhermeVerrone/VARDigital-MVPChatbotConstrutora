// Seed idempotente: parâmetros ILUSTRATIVO (só se não houver nenhuma versão), empreendimento,
// unidades e corretores de exemplo.   pnpm --filter @mvp/db db:seed
import { createDb, seedDatabase, todayIso } from '../src';
import { databaseUrl } from './env';

const db = createDb(databaseUrl());
try {
  const summary = await seedDatabase(db, { today: todayIso() });
  console.log(JSON.stringify(summary));
} finally {
  await db.$disconnect();
}
