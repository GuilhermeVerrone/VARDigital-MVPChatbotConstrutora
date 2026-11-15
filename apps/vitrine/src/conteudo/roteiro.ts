// Roteiro para o visitante testar a demonstração sozinho, com o próprio celular. A mesma sequência roda
// no teste e2e/tests/roteiro-vitrine.spec.ts: se o atendimento mudar e o roteiro deixar de valer, o teste quebra.

export interface EtapaTeste {
  id: string;
  titulo: string;
  passos: string[];
  espera: string;
  /** Link de apoio: 'site', 'whatsapp' ou um caminho deste site. */
  link?: { para: 'site' | 'whatsapp' | string; texto: string };
}

export const ROTEIRO: EtapaTeste[] = [
  {
    id: 'site',
    titulo: 'Abra o site de exemplo',
    passos: ['Abra o site da Elevare, a construtora de exemplo.', 'Entre no Lumen Urban.'],
    espera: 'Três empreendimentos, cada um com fotos, plantas e o preço "a partir de".',
    link: { para: 'site', texto: 'Abrir o site de exemplo' },
  },
  {
    id: 'formulario',
    titulo: 'Peça a sua simulação',
    passos: ['Em "Simule sua condição", escolha uma planta.', 'Preencha com o seu nome e o seu WhatsApp.', 'Marque os dois aceites e envie.'],
    espera: 'A página de confirmação, com o código do seu pedido e um botão para o WhatsApp.',
  },
  {
    id: 'confirmar',
    titulo: 'Confirme no WhatsApp',
    passos: ['Abra a mensagem que chegou no seu WhatsApp.', 'Responda "sim".'],
    espera: '"Perfeito, (seu nome)!" e a primeira pergunta. O atendimento não pede de novo o seu nome nem o seu telefone.',
  },
  {
    id: 'parcelada',
    titulo: 'Simule a entrada parcelada',
    passos: [
      'Escolha a planta pelo número e, na forma de pagamento, responda "3".',
      'Responda como um comprador: renda ("9 mil"), tipo de renda ("clt"), nascimento ("05/03/1990"), se paga outras parcelas ("não") e se compra com alguém ("não").',
      'Diga quanto tem para o ato ("30 mil") e a mensal que cabe no bolso ("2 mil").',
      'Responda sobre reforços, FGTS, outro imóvel e primeiro financiamento.',
    ],
    espera: 'Um resumo, "Conferindo o que anotei", com tudo o que você respondeu. Ainda não confirme.',
  },
  {
    id: 'corrigir',
    titulo: 'Corrija uma resposta',
    passos: ['Escreva "corrigir a renda".', 'Informe outro valor, como "12 mil".', 'Confira o resumo e responda "sim".'],
    espera: 'O atendimento pergunta de novo só a renda, mostra o resumo corrigido e, com o "sim", o plano: ato, mensais, parcela das chaves, saldo a financiar e a estimativa do banco.',
  },
  {
    id: 'ajuste',
    titulo: 'Mude o valor do ato',
    passos: ['No menu, responda "1" (Mudar o valor do ato).', 'Informe outro valor, como "40 mil".'],
    espera: '"Certo, vou refazer as contas" e o plano refeito com o novo ato.',
  },
  {
    id: 'pdf',
    titulo: 'Receba o PDF',
    passos: ['No menu, escolha "Receber o PDF da simulação".'],
    espera: 'O PDF no seu WhatsApp, com o plano e o aviso de que a simulação é indicativa.',
  },
  {
    id: 'a-vista',
    titulo: 'Compare com o pagamento à vista',
    passos: ['No menu, escolha "Ver outra forma de pagamento".', 'Responda "1" (à vista) e confirme o resumo com "sim".'],
    espera: 'O valor de tabela, o desconto à vista e o total a pagar.',
  },
  {
    id: 'corretor',
    titulo: 'Peça um corretor',
    passos: ['Escreva "quero falar com um corretor".'],
    espera: '"Combinado! Vou pedir para um corretor falar com você por aqui." A partir daí, o atendimento automático para de perguntar. Na demonstração, o corretor é de exemplo.',
  },
  {
    id: 'lado-corretor',
    titulo: 'Veja o lado do corretor e do painel',
    passos: ['Veja a mensagem que o corretor recebe e as telas do painel na página de funcionalidades.'],
    espera: 'O resumo do lead com o PDF, a ficha do lead, as condições comerciais e o histórico.',
    link: { para: '/funcionalidades/#corretor', texto: 'Ver o lado do corretor' },
  },
  {
    id: 'apagar',
    titulo: 'Apague os seus dados',
    passos: ['Escreva "apagar meus dados".', 'Confirme com "sim".'],
    espera: '"Pronto, apaguei os seus dados do nosso sistema."',
  },
  {
    id: 'whatsapp',
    titulo: 'Comece de novo, direto pelo WhatsApp',
    passos: ['Agora mande "Oi! Vi o anúncio do Lumen Urban", como quem chegou por um anúncio.'],
    espera: 'A apresentação do atendimento e o pedido de aceite de privacidade, depois o seu nome e o empreendimento.',
    link: { para: 'whatsapp', texto: 'Abrir a conversa' },
  },
];
