import { expect, type Page } from '@playwright/test';
import { joined, say, sentTo, stackEnv, waitFor, type StackEnv } from './whatsapp';

export const ADMIN = { email: 'admin@elevare.invalid', password: process.env.DEMO_ADMIN_PASSWORD ?? 'elevare-demo-2026' };

/** Erros de CSP no console do navegador (a política precisa deixar o app funcionar). */
export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (/content security policy/i.test(e.message)) violations.push(e.message);
  });
  return violations;
}

/** Preenche e envia o "Simule sua condição" da página do empreendimento. Devolve o código ELV-xxxx. */
export async function submitSiteForm(page: Page, o: { slug: string; name: string; phone: string; typology?: string }): Promise<string> {
  const site = process.env.E2E_SITE_URL!;
  await page.goto(`${site}/empreendimentos/${o.slug}`);
  const form = page.locator('form').filter({ has: page.locator('input[name="phone"]') });
  await form.locator('input[name="name"]').fill(o.name);
  await form.locator('input[name="phone"]').fill(o.phone.replace(/^55(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3'));
  if (o.typology) await form.locator('select[name="typology"]').selectOption({ label: o.typology });
  await form.locator('input[name="consent"]').check();
  await form.locator('input[name="optin"]').check();
  // Tempo mínimo de preenchimento (anti-robô): o servidor recusa o envio antes de 3 s.
  await page.waitForTimeout(3500);
  await form.getByRole('button', { name: /Simular minha condição/ }).click();
  await expect(page).toHaveURL(/\/obrigado\?/);
  await expect(page.getByRole('heading', { name: 'Recebemos o seu pedido.' })).toBeVisible();
  const code = (await page.locator('.code').innerText()).trim();
  expect(code).toMatch(/^ELV-\d{4,6}$/);
  return code;
}

/** 1º contato do bot (job FIRST_CONTACT) chegando no WhatsApp do lead, com o nome e o pedido de confirmação. */
export async function expectFirstContact(env: StackEnv, phone: string, firstName: string): Promise<void> {
  const first = await waitFor('1º contato no WhatsApp', async () => (await sentTo(env, phone))[0]);
  expect(first.text).toContain(firstName);
  expect(first.text.toLowerCase()).toContain('sim');
}

/** Roteiro de conversa: cada resposta do lead, em ordem. A última rodada devolve as mensagens finais. */
export async function converse(env: StackEnv, phone: string, answers: string[]): Promise<string> {
  let last = '';
  for (const a of answers) last = joined(await say(env, phone, a));
  return last;
}

export async function loginPainel(page: Page, who: { email: string; password: string } = ADMIN): Promise<void> {
  await page.goto(`${process.env.E2E_PAINEL_URL}/login`);
  await page.getByLabel('E-mail').fill(who.email);
  await page.getByLabel('Senha').fill(who.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(`${process.env.E2E_PAINEL_URL}/`);
}

export { stackEnv };
