import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'painel',
    include: ['test/**/*.test.ts'],
    // Os serviços do painel são testados contra Postgres real, o mesmo mecanismo dos outros pacotes.
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
