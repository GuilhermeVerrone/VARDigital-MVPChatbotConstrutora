import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'bot',
    include: ['test/**/*.test.ts'],
    // Os testes de pipeline usam Postgres real, o mesmo mecanismo do pacote db.
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
