import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    // Sobe um Postgres descartável (ou usa TEST_DATABASE_URL) e aplica as migrations uma vez.
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
