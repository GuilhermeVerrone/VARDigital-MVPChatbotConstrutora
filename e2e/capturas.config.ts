import { defineConfig, devices } from '@playwright/test';

// Capturas do site de vendas (apps/vitrine): sobe a mesma stack do e2e (dados ILUSTRATIVOS do seed),
// percorre o site, conversa com o bot como as personas de exemplo e tira os prints do painel.
// Saída: apps/vitrine/public/produto/*.webp e apps/vitrine/src/conteudo/conversas.json.
export default defineConfig({
  testDir: './capturas',
  globalSetup: './support/stack.ts',
  outputDir: './.output/capturas',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
});
