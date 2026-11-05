import { expect, test } from '@playwright/test';
import { converse, expectFirstContact, loginPainel, stackEnv, submitSiteForm, watchCsp } from '../support/journey';
import { joined, sentTo, waitFor } from '../support/whatsapp';

// Jornada completa da demo, em produção local: site → formulário → 1º contato no WhatsApp (canal falso)
// → conversa até o resultado → lead com o plano no painel. Um roteiro por forma de pagamento.
// O lead vem do formulário, então o "sim" ao 1º contato é o double opt-in e a conversa começa na tipologia.

const PHONES = process.env.E2E_LEAD_PHONES!.split(',');

/** Perfil do bot (renda, tipo de renda, nascimento, dívidas, co-proponente) e elegibilidade (FGTS, imóvel, 1º financiamento). */
const PROFILE = ['9 mil', 'clt', '05/03/1990', 'não', 'não'];
const ELIGIBILITY = ['não', 'não', 'sim'];

interface Scenario {
  title: string;
  phone: string;
  name: string;
  /** Respostas depois do "sim" ao 1º contato: tipologia (1 = primeira opção do Lumen Urban), forma de pagamento e o que o ramo pedir. */
  answers: string[];
  /** O que o lead deve ler no resultado. */
  result: string[];
  /** Selo da forma de pagamento no painel. */
  modeLabel: string;
  /** Texto do plano que o painel mostra. */
  panelPlan: string[];
}

const SCENARIOS: Scenario[] = [
  {
    title: 'modo 1: pagamento à vista',
    phone: PHONES[0]!,
    name: 'Ana Souza',
    answers: ['1', '1', 'sim'],
    result: ['Desconto à vista', 'Total a pagar'],
    modeLabel: 'À vista',
    panelPlan: ['Simulações e plano', 'Condição comercial'],
  },
  {
    title: 'modo 2: entrada de uma vez e financiamento do saldo',
    phone: PHONES[1]!,
    name: 'Bruno Lima',
    answers: ['1', '2', '120 mil', ...PROFILE, ...ELIGIBILITY, 'sim'],
    result: ['Entrada', 'Estimativa do financiamento do saldo nas chaves'],
    modeLabel: 'Entrada à vista',
    panelPlan: ['Plano da entrada', 'Entrada total'],
  },
  {
    title: 'modo 3: entrada parcelada com a construtora',
    phone: PHONES[2]!,
    name: 'Carla Dias',
    answers: ['1', '3', ...PROFILE, '30 mil', '2 mil', 'sim', ...ELIGIBILITY, 'sim'],
    result: ['Como fica a entrada', 'Ato, hoje: R$ 30.000', 'Saldo para financiar nas chaves'],
    modeLabel: 'Entrada parcelada',
    panelPlan: ['Plano da entrada', 'Ato'],
  },
];

for (const s of SCENARIOS) {
  test(s.title, async ({ page, browser }) => {
    const env = stackEnv();
    const csp = watchCsp(page);

    // 1. Site: formulário com consentimento e opt-in → página de obrigado com o código do lead.
    const code = await submitSiteForm(page, { slug: 'lumen-urban', name: s.name, phone: s.phone });

    // 2. O bot manda o 1º contato; o "sim" confirma o pedido (double opt-in) e a conversa segue sem repetir nome nem telefone.
    await expectFirstContact(env, s.phone, s.name.split(' ')[0]!);
    const start = joined(await converse(env, s.phone, ['sim']).then(async () => (await sentTo(env, s.phone)).slice(1)));
    expect(start).toContain(`Perfeito, ${s.name.split(' ')[0]}`);
    expect(start).not.toMatch(/concorda|nome completo|Qual empreendimento/i);

    // 3. Conversa até o resultado do motor.
    const result = await converse(env, s.phone, s.answers);
    const all = joined(await sentTo(env, s.phone));
    for (const piece of s.result) expect(all, `resultado do lead deve conter "${piece}"`).toContain(piece);
    expect(result.length).toBeGreaterThan(0);

    // 4. Painel: o lead aparece pelo código, com a forma de pagamento e o plano.
    await loginPainel(page);
    await page.goto(`${process.env.E2E_PAINEL_URL}/leads?q=${encodeURIComponent(code)}`);
    await page.getByRole('link', { name: new RegExp(s.name) }).first().click();
    await expect(page.getByRole('heading', { name: s.name })).toBeVisible();
    await expect(page.getByText(code).first()).toBeVisible();
    await expect(page.locator('.badge', { hasText: new RegExp(`^${s.modeLabel}$`) }).first()).toBeVisible();
    for (const piece of s.panelPlan) await expect(page.getByText(piece).first()).toBeVisible();

    // PDF da simulação, refeito pelo painel a partir da simulação gravada.
    const pdfHref = await page.locator('a[href*="/pdf/"]').first().getAttribute('href');
    expect(pdfHref).toBeTruthy();
    const pdf = await page.request.get(new URL(pdfHref!, process.env.E2E_PAINEL_URL).toString());
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

    // Sem violação de CSP em nenhuma das duas telas.
    expect(csp, 'violações de CSP').toEqual([]);

    // 5. O corretor recebeu o dossiê com o modo (aviso ao corretor sai por delivery_jobs).
    await waitFor('aviso ao corretor', async () => {
      const brokers = (await (await fetch(`${env.fakeWaUrl}/_sent`)).json()) as { to: string; text: string }[];
      return brokers.find((m) => m.to.startsWith('55009000000') && m.text.includes(s.name.split(' ')[0]!));
    });
    await browser.contexts()[0]?.clearCookies();
  });
}
