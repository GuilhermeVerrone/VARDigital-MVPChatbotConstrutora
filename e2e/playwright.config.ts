import { defineConfig, devices } from '@playwright/test';

// E2E da Fase 16: site → formulário → WhatsApp (canal falso) → bot → painel. A stack inteira sobe em
// globalSetup (e2e/support/stack.ts). Roda sequencial: os roteiros compartilham o mesmo banco.
export default defineConfig({
  testDir: './tests',
  globalSetup: './support/stack.ts',
  outputDir: './.output/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: './.output/report' }]],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
