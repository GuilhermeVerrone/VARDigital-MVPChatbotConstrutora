import { expect, test } from '@playwright/test';
import { loginPainel, stackEnv } from '../support/journey';
import { leadsSay } from '../support/load';

// Carga da demo para a medição de memória (relatório da Fase 16): várias conversas simultâneas entrando
// pelo webhook assinado, enquanto o painel e o site são navegados. A memória é amostrada pelo stack.ts
// (e2e/.output/memory.json). Roda por último (ordem alfabética: journey, load, security).

const PHONES = process.env.E2E_LOAD_PHONES!.split(',');

test('carga: conversas simultâneas com o painel e o site em uso', async ({ page, request }) => {
  test.setTimeout(240_000);
  const env = stackEnv();
  await loginPainel(page);

  const started = Date.now();
  const load = leadsSay(env, PHONES, { messages: 20, concurrency: 8 });

  // Enquanto isso, navegação no painel e no site (o que a equipe faz durante a demo).
  let pages = 0;
  while (Date.now() - started < 25_000) {
    for (const path of ['/', '/leads', '/fluxo', '/auditoria']) {
      const res = await page.goto(`${process.env.E2E_PAINEL_URL}${path}`);
      expect(res?.status()).toBeLessThan(400);
      pages += 1;
    }
    expect((await request.get(`${process.env.E2E_SITE_URL}/empreendimentos/altomare`)).ok()).toBe(true);
  }

  const result = await load;
  expect(result.rejected).toBe(0);
  expect(result.accepted).toBe(PHONES.length * 20);
  expect(pages).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'carga', description: `${result.accepted} mensagens em ${Math.round(result.ms / 1000)} s; ${pages} páginas do painel` });

  // O bot responde a todas as conversas (a fila de entrada esvazia).
  await expect
    .poll(async () => {
      const sent = (await (await fetch(`${env.fakeWaUrl}/_sent`)).json()) as { to: string }[];
      return PHONES.every((p) => sent.some((m) => m.to === `${p}@s.whatsapp.net`));
    }, { timeout: 90_000 })
    .toBe(true);
});
