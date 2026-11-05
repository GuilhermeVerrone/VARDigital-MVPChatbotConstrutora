import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'site',
    include: ['test/**/*.test.ts'],
    // O envio do formulário é testado contra Postgres real, o mesmo mecanismo dos outros pacotes.
    globalSetup: ['../../packages/db/test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
