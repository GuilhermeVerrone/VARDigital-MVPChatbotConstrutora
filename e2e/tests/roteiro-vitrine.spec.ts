import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectFirstContact, submitSiteForm } from '../support/journey';
import { OUT } from '../support/stack';
import { joined, say, stackEnv } from '../support/whatsapp';

// O roteiro "Teste com o seu celular" do site de vendas (apps/vitrine/src/conteudo/roteiro.ts), passo a
// passo, como o visitante faria. Se o atendimento mudar e o roteiro deixar de valer, este teste quebra.

const PHONE = process.env.E2E_LEAD_PHONES!.split(',')[4]!;

test('roteiro de teste do site de vendas funciona como está escrito', async ({ page }) => {
  const env = stackEnv();
  const log: string[] = [];
  const step = async (text: string, expectText?: string | RegExp) => {
    const reply = joined(await say(env, PHONE, text));
    log.push(`> ${text}\n${reply}`);
    if (expectText) expect(reply, `resposta a "${text}"`).toMatch(expectText);
    return reply;
  };

  // 1-2. Site e formulário → página de confirmação com o código.
  await submitSiteForm(page, { slug: 'lumen-urban', name: 'Visitante Teste', phone: PHONE });
  // 3. Confirmar no WhatsApp.
  await expectFirstContact(env, PHONE, 'Visitante');
  await step('sim', /Visitante/);

  // 4. Entrada parcelada até o resumo.
  await step('1');
  await step('3');
  for (const a of ['9 mil', 'clt', '05/03/1990', 'não', 'não', '30 mil', '2 mil', 'sim', 'não', 'não']) await step(a);
  await step('sim', /Conferindo o que anotei/);

  // 5. Corrigir a renda antes de confirmar.
  await step('corrigir a renda');
  await step('12 mil', /Conferindo o que anotei[\s\S]*R\$ 12\.000/);
  const result = await step('sim', /Como fica a entrada/);
  expect(result).toMatch(/Ato, hoje/);
  expect(result).toMatch(/Mudar o valor do ato/);

  // 6. Mudar o valor do ato.
  await step('1');
  await step('40 mil', /Ato, hoje: R\$ 40\.000/);

  // 7. Receber o PDF.
  const pdf = await say(env, PHONE, 'Receber o PDF da simulação');
  log.push(`> PDF\n${joined(pdf)}`);
  expect(pdf.some((m) => m.kind === 'document')).toBe(true);

  // 8. Ver outra forma de pagamento: à vista.
  await step('Ver outra forma de pagamento');
  await step('1', /Conferindo o que anotei/);
  await step('sim', /Total a pagar/);

  // 9. Pedir um corretor.
  await step('quero falar com um corretor', /corretor/i);

  // 11. Apagar os dados.
  await step('apagar meus dados', /apague os seus dados/);
  await step('sim', /apaguei os seus dados/);

  // 12. Começar do zero direto pelo WhatsApp.
  await step('Oi! Vi o anúncio do Lumen Urban', /privacidade|dados|informações/i);

  writeFileSync(join(OUT, 'roteiro-vitrine.txt'), log.join('\n\n'));
});
