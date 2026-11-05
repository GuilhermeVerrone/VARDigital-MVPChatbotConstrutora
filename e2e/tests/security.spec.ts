import { expect, test } from '@playwright/test';
import { loginPainel, stackEnv, submitSiteForm, watchCsp } from '../support/journey';
import { sentTo } from '../support/whatsapp';

const PHONES = process.env.E2E_LEAD_PHONES!.split(',');

test('cabeçalhos de segurança e CSP no site e no painel', async ({ request }) => {
  for (const [name, url] of [['site', process.env.E2E_SITE_URL!], ['painel', `${process.env.E2E_PAINEL_URL}/login`]] as const) {
    const res = await request.get(url);
    const h = res.headers();
    expect(h['content-security-policy'], `${name}: CSP`).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-powered-by']).toBeUndefined();
  }
});

test('painel: rotas protegidas sem sessão e login errado não entra', async ({ page, request }) => {
  const painel = process.env.E2E_PAINEL_URL!;
  for (const path of ['/', '/leads', '/fluxo', '/auditoria', '/empreendimentos']) {
    const res = await request.get(`${painel}${path}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308], path).toContain(res.status());
    expect(res.headers().location).toContain('/login');
  }
  const pdf = await request.get(`${painel}/leads/00000000-0000-4000-8000-000000000000/pdf/00000000-0000-4000-8000-000000000001`, { maxRedirects: 0 });
  expect([302, 303, 307, 308, 401]).toContain(pdf.status());

  await page.goto(`${painel}/login`);
  await page.getByLabel('E-mail').fill('admin@elevare.invalid');
  await page.getByLabel('Senha').fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('painel: status do WhatsApp mostra a sessão conectada (chave só no servidor)', async ({ page }) => {
  const csp = watchCsp(page);
  await loginPainel(page);
  await page.goto(`${process.env.E2E_PAINEL_URL}/whatsapp`);
  await expect(page.getByText('Conectado')).toBeVisible();
  expect(await page.content()).not.toContain('e2e-api-key');
  expect(csp).toEqual([]);
});

test('site: spam não vira lead nem mensagem (honeypot)', async ({ page, request }) => {
  const env = stackEnv();
  const phone = PHONES[5]!;
  await page.goto(`${process.env.E2E_SITE_URL}/empreendimentos/lumen-urban`);
  const form = page.locator('form').filter({ has: page.locator('input[name="phone"]') });
  await form.locator('input[name="name"]').fill('Robô Spam');
  await form.locator('input[name="phone"]').fill('(41) 98888-0006');
  await form.locator('input[name="consent"]').check();
  await form.locator('input[name="optin"]').check();
  // O campo é invisível para pessoas; o robô preenche direto no DOM.
  await form.locator('input[name="website"]').evaluate((el) => ((el as unknown as { value: string }).value = 'http://spam.example'));
  await page.waitForTimeout(3500);
  await form.getByRole('button', { name: /Simular minha condição/ }).click();
  await expect(page).toHaveURL(/\/obrigado/);
  // Parece sucesso para o robô, mas sem código e sem mensagem no WhatsApp.
  await expect(page.locator('.code')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(await sentTo(env, phone)).toEqual([]);
  expect((await request.get(`${env.fakeWaUrl}/_sent`)).ok()).toBe(true);
});

test('site: enviar o formulário de novo não duplica o lead nem a mensagem', async ({ page }) => {
  const env = stackEnv();
  const phone = PHONES[3]!;
  const first = await submitSiteForm(page, { slug: 'parc-verde', name: 'Davi Alves', phone });
  await expect.poll(async () => (await sentTo(env, phone)).length, { timeout: 20_000 }).toBe(1);
  const second = await submitSiteForm(page, { slug: 'parc-verde', name: 'Davi Alves', phone });
  expect(second).toBe(first);
  await page.waitForTimeout(2000);
  expect((await sentTo(env, phone)).length).toBe(1);
});

test('WA-AKG fora: o 1º contato é reenviado quando o gateway volta', async ({ page, request }) => {
  test.setTimeout(180_000);
  const env = stackEnv();
  const phone = PHONES[4]!;
  await request.post(`${env.fakeWaUrl}/_outage?n=1`);
  await submitSiteForm(page, { slug: 'altomare', name: 'Elisa Prado', phone });
  await expect.poll(async () => (await sentTo(env, phone)).length, { timeout: 120_000 }).toBe(1);
  expect((await sentTo(env, phone))[0]!.text).toContain('Elisa');
});
