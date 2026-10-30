import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    // Sobe um Postgres descartável (ou usa TEST_DATABASE_URL) e aplica as migrations uma vez.
    globalSetup: ['test/global-setup.ts'],
    // Alguns testes sobem prisma/tsx como subprocesso; com a suíte inteira em paralelo passam de 20 s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
