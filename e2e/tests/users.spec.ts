import { expect, test } from '@playwright/test';
import { loginPainel, watchCsp } from '../support/journey';

// Onboarding de um corretor pelo painel: o admin cria o acesso vinculado a um cadastro de corretor, e o
// corretor entra e vê só o Início e os próprios leads.

const CORRETOR = { email: 'corretor.e2e@elevare.invalid', password: 'senha-inicial-e2e' };

test('admin cria um usuário corretor, que entra e só vê início e leads', async ({ page, browser }) => {
  const painel = process.env.E2E_PAINEL_URL!;
  const csp = watchCsp(page);
  await loginPainel(page);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();

  const row = page.getByRole('form', { name: 'Novo usuário' });
  await row.getByLabel('Nome').fill('Corretor E2E');
  await row.getByLabel('E-mail').fill(CORRETOR.email);
  await row.getByLabel('Papel').selectOption('CORRETOR');
  // Sem corretor vinculado o servidor recusa.
  await row.getByLabel('Senha inicial').fill(CORRETOR.password);
  await row.getByRole('button', { name: 'Adicionar' }).click();
  await expect(row.getByText('Usuário corretor precisa de um corretor vinculado')).toBeVisible();

  await row.getByLabel('Corretor vinculado').selectOption({ index: 1 });
  await row.getByLabel('Senha inicial').fill(CORRETOR.password);
  await row.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('form', { name: 'Usuário Corretor E2E' })).toBeVisible();

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await loginPainel(other, CORRETOR);
  const nav = other.getByRole('navigation', { name: 'Principal' }).getByRole('link');
  await expect(nav).toHaveText(['Início', 'Leads']);
  await other.goto(`${painel}/usuarios`);
  await expect(other).toHaveURL(/\/acesso-negado$/);
  await ctx.close();

  await page.goto(`${painel}/auditoria?entity=User&action=USER_CREATED`);
  await expect(page.locator('tbody tr').first()).toContainText('USER_CREATED');
  expect(csp).toEqual([]);
});
