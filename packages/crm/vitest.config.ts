import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'crm',
    include: ['test/**/*.test.ts'],
    // O SimulatedCrm grava no Postgres: mesmo mecanismo de banco descartável do pacote db.
    globalSetup: ['../db/test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
