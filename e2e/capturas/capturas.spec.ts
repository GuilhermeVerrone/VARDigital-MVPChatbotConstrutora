import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from '../support/stack';
import { ADMIN, expectFirstContact, loginPainel, stackEnv, submitSiteForm } from '../support/journey';
import { say, sentTo, waitFor, type StackEnv } from '../support/whatsapp';
import type { SentMessage } from '../support/fake-wa-akg';

// Gera o material real do site de vendas. Nada aqui é desenhado à mão: os prints são das telas de verdade
// e as conversas são as mensagens que o bot mandou, com os dados ILUSTRATIVOS do seed.

const SHOTS = join(ROOT, 'apps/vitrine/public/produto');
const CONTENT = join(ROOT, 'apps/vitrine/src/conteudo');
const PHONES = process.env.E2E_LEAD_PHONES!.split(',');
const SITE = () => process.env.E2E_SITE_URL!;
const PAINEL = () => process.env.E2E_PAINEL_URL!;

test.describe.configure({ mode: 'serial' });

/** Salva o print em WebP (menor) e apaga o PNG intermediário. */
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  const png = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: png, fullPage: opts.fullPage ?? false, animations: 'disabled', caret: 'hide' });
  execFileSync('cwebp', ['-quiet', '-q', '84', png, '-o', join(SHOTS, `${name}.webp`)]);
  rmSync(png);
}

interface Mensagem { de: 'bot' | 'lead'; texto: string; arquivo?: string }
interface Conversa { id: string; nome: string; modo: string; resumo: string; mensagens: Mensagem[]; corretor?: Mensagem[] }

const toMsg = (m: SentMessage): Mensagem => ({ de: 'bot', texto: m.text, ...(m.fileName ? { arquivo: m.fileName } : {}) });

/** Conversa registrada: cada resposta do lead seguida do que o bot mandou naquela rodada. */
async function talk(env: StackEnv, phone: string, answers: string[], log: Mensagem[]): Promise<void> {
  for (const a of answers) {
    log.push({ de: 'lead', texto: a });
    for (const m of await say(env, phone, a)) log.push(toMsg(m));
  }
}

const PROFILE = ['9 mil', 'clt', '05/03/1990', 'não', 'não'];
const ELIGIBILITY = ['não', 'não', 'sim'];
const PERSONAS = [
  { id: 'ana', nome: 'Ana Souza', modo: 'À vista', resumo: 'Quer pagar tudo de uma vez.', phone: () => PHONES[0]!, answers: ['1', '1', 'sim'] },
  { id: 'bruno', nome: 'Bruno Lima', modo: 'Entrada de uma vez + financiamento', resumo: 'Tem R$ 120 mil e financia o saldo.', phone: () => PHONES[1]!, answers: ['1', '2', '120 mil', ...PROFILE, ...ELIGIBILITY, 'sim'] },
  { id: 'carla', nome: 'Carla Dias', modo: 'Entrada parcelada com a construtora', resumo: 'Parcela a entrada e financia nas chaves.', phone: () => PHONES[2]!, answers: ['1', '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim'] },
];

const conversas: Conversa[] = [];
const codes: Record<string, string> = {};

test.beforeAll(() => {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(CONTENT, { recursive: true });
});

test('site de exemplo: home, empreendimento e formulário', async ({ browser }) => {
  for (const [suffix, viewport] of [['', { width: 1440, height: 900 }], ['-celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(SITE());
    await shot(page, `site-home${suffix}`);
    await page.goto(`${SITE()}/empreendimentos/lumen-urban`);
    await shot(page, `site-empreendimento${suffix}`);
    const form = page.locator('form').filter({ has: page.locator('input[name="phone"]') });
    await form.scrollIntoViewIfNeeded();
    await form.locator('input[name="name"]').fill('Ana Souza');
    await form.locator('input[name="phone"]').fill('(41) 98888-0001');
    await form.locator('input[name="consent"]').check();
    await form.locator('input[name="optin"]').check();
    await form.screenshot({ path: join(SHOTS, `site-formulario${suffix}.png`), animations: 'disabled' });
    execFileSync('cwebp', ['-quiet', '-q', '84', join(SHOTS, `site-formulario${suffix}.png`), '-o', join(SHOTS, `site-formulario${suffix}.webp`)]);
    rmSync(join(SHOTS, `site-formulario${suffix}.png`));
    await ctx.close();
  }
});

for (const p of PERSONAS) {
  test(`conversa: ${p.nome} (${p.modo})`, async ({ page }) => {
    const env = stackEnv();
    const phone = p.phone();
    codes[p.id] = await submitSiteForm(page, { slug: 'lumen-urban', name: p.nome, phone });
    if (p.id === 'ana') await shot(page, 'site-obrigado');
    await expectFirstContact(env, phone, p.nome.split(' ')[0]!);
    const log: Mensagem[] = (await sentTo(env, phone)).map(toMsg);
    await talk(env, phone, ['sim', ...p.answers], log);

    // Aviso ao corretor (card + PDF), que sai pela fila de entregas.
    const first = p.nome.split(' ')[0]!;
    const corretor = await waitFor('aviso ao corretor', async () => {
      const all = (await (await fetch(`${env.fakeWaUrl}/_sent`)).json()) as SentMessage[];
      const card = all.filter((m) => m.to.startsWith('55009000000') && m.text.includes(first));
      return card.length ? all.filter((m) => m.to === card[0]!.to && m.at >= card[0]!.at - 50).map(toMsg) : null;
    }, 60_000);
    conversas.push({ id: p.id, nome: p.nome, modo: p.modo, resumo: p.resumo, mensagens: log, corretor });
  });
}

test('conversa: começo direto pelo WhatsApp', async () => {
  const env = stackEnv();
  const log: Mensagem[] = [];
  await talk(env, PHONES[3]!, ['Oi! Vi o anúncio do Lumen Urban', 'sim', 'Davi Rocha'], log);
  conversas.push({ id: 'davi', nome: 'Davi Rocha', modo: 'Começo pelo WhatsApp', resumo: 'Chamou direto, sem passar pelo site.', mensagens: log });
  writeFileSync(join(CONTENT, 'conversas.json'), `${JSON.stringify(conversas, null, 2)}\n`);
});

test('painel: telas da gestão e do corretor', async ({ page }) => {
  await page.goto(`${PAINEL()}/login`);
  await shot(page, 'painel-login');
  await loginPainel(page);
  // O admin do seed entra com a senha de demonstração: troca antes, para o aviso de senha provisória não sair nos prints.
  await page.goto(`${PAINEL()}/conta`);
  await shot(page, 'painel-conta');
  const conta = page.getByRole('form', { name: 'Trocar senha' });
  await conta.getByLabel('Senha atual').fill(ADMIN.password);
  await conta.getByLabel('Nova senha', { exact: true }).fill('senha-das-capturas-2026');
  await conta.getByLabel('Repita a nova senha').fill('senha-das-capturas-2026');
  await conta.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.getByText('Senha trocada.')).toBeVisible();
  await page.goto(PAINEL());
  await shot(page, 'painel-inicio');

  await page.goto(`${PAINEL()}/leads`);
  await shot(page, 'painel-leads');

  // Lead da Carla (entrada parcelada): o detalhe mais completo, com o plano da entrada.
  await page.goto(`${PAINEL()}/leads?q=${encodeURIComponent(codes.carla!)}`);
  await page.getByRole('link', { name: /Carla Dias/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Carla Dias' })).toBeVisible();
  await shot(page, 'painel-lead');
  await shot(page, 'painel-lead-completo', { fullPage: true });

  // PDF da simulação, primeira página como imagem.
  const href = await page.locator('a[href*="/pdf/"]').first().getAttribute('href');
  const pdf = await page.request.get(new URL(href!, PAINEL()).toString());
  const pdfPath = join(SHOTS, 'simulacao.pdf');
  writeFileSync(pdfPath, await pdf.body());
  execFileSync('sips', ['-s', 'format', 'png', '-Z', '1800', pdfPath, '--out', join(SHOTS, 'pdf-simulacao.png')], { stdio: 'ignore' });
  execFileSync('cwebp', ['-quiet', '-q', '86', join(SHOTS, 'pdf-simulacao.png'), '-o', join(SHOTS, 'pdf-simulacao.webp')]);
  rmSync(join(SHOTS, 'pdf-simulacao.png'));
  rmSync(pdfPath);

  await page.goto(`${PAINEL()}/empreendimentos`);
  await shot(page, 'painel-empreendimentos');
  await page.getByRole('row', { name: /Lumen Urban/ }).locator('a[href$="/condicoes"]').click();
  await page.getByRole('button', { name: 'Calcular prévia' }).click();
  await expect(page.locator('.editor-preview .preview h3').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'painel-condicoes');

  for (const [path, name] of [['/financiamento', 'painel-financiamento'], ['/corretores', 'painel-corretores'], ['/usuarios', 'painel-usuarios'], ['/fluxo', 'painel-fluxo'], ['/whatsapp', 'painel-whatsapp'], ['/auditoria', 'painel-auditoria']] as const) {
    await page.goto(`${PAINEL()}${path}`);
    await shot(page, name);
  }

  // Simulador: a mesma conversa do bot, sem WhatsApp, com o estado ao lado.
  await page.goto(`${PAINEL()}/simulador`);
  const start = page.getByRole('form', { name: 'Iniciar conversa' });
  await start.getByLabel('Começar por').selectOption('FORM');
  await start.getByRole('button', { name: 'Iniciar conversa' }).click();
  const input = page.getByRole('form', { name: 'Enviar mensagem' }).getByRole('textbox');
  for (const a of ['sim', '1', '3', '9 mil']) {
    await expect(input).toBeEnabled();
    await input.fill(a);
    await input.press('Enter');
    await expect(page.getByRole('log', { name: 'Conversa simulada' }).getByText(a, { exact: true }).last()).toBeVisible();
  }
  await page.waitForTimeout(400);
  await shot(page, 'painel-simulador');
  execFileSync('node', [join(ROOT, 'apps/vitrine/scripts/medidas.mjs')], { stdio: 'inherit' });
});
