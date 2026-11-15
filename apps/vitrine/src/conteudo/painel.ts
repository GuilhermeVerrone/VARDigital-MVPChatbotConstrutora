import type { TelaPainel } from '@/componentes/QuadroPainel';

// Telas do painel mostradas na página principal (os prints vêm de `pnpm vitrine:capturas`).
export const TELAS_PAINEL: TelaPainel[] = [
  {
    arquivo: 'painel-condicoes',
    titulo: 'Condições comerciais',
    resumo: 'Ato, mensais, reforços e desconto à vista, por empreendimento.',
    texto: 'Mudou o ato mínimo ou o número de mensais? A equipe altera aqui, confere a prévia ao lado com uma unidade e um perfil de exemplo, e publica. A próxima simulação no WhatsApp já sai com a regra nova, sem esperar programador.',
    alt: 'Tela de condições comerciais do Lumen Urban, com o formulário da condição à esquerda e a prévia do cálculo das três formas de pagamento à direita.',
  },
  {
    arquivo: 'painel-inicio',
    titulo: 'Início',
    resumo: 'Leads do dia, funil do formulário e quem está esperando corretor.',
    texto: 'A primeira tela mostra quantos leads chegaram hoje, quantos confirmaram o contato, simularam e já estão com corretor, e quais condições estão valendo em cada empreendimento.',
    alt: 'Tela inicial do painel com leads do dia, funil do formulário do site e simulações por forma de pagamento.',
  },
  {
    arquivo: 'painel-lead',
    titulo: 'Ficha do lead',
    resumo: 'A conversa, a simulação, o plano da entrada e o PDF.',
    texto: 'Tudo o que o comprador respondeu e a simulação que ele recebeu, na mesma tela: dados, corretor responsável, plano da entrada, aceite de privacidade e o histórico. Dá para trocar o corretor e assumir a conversa.',
    alt: 'Ficha da lead Carla Dias com dados de contato, corretor responsável e a simulação de entrada parcelada.',
  },
  {
    arquivo: 'painel-leads',
    titulo: 'Leads',
    resumo: 'Filtros por empreendimento, forma de pagamento, parecer e corretor.',
    texto: 'A lista de todos os leads, com filtros por empreendimento, forma de pagamento, parecer, situação, corretor e origem. O corretor só enxerga os próprios leads.',
    alt: 'Lista de leads do painel com filtros e as três leads de exemplo.',
  },
  {
    arquivo: 'painel-fluxo',
    titulo: 'Textos do atendimento',
    resumo: 'O tom das mensagens é seu; o texto jurídico fica travado.',
    texto: 'A equipe ajusta as mensagens do atendimento, liga ou desliga etapas opcionais e publica. Palavras proibidas (como "garantido") e o aviso legal ficam protegidos, e dá para voltar à versão anterior com um clique.',
    alt: 'Editor dos textos do atendimento, com as mensagens de cada etapa.',
  },
  {
    arquivo: 'painel-simulador',
    titulo: 'Simulador de conversa',
    resumo: 'Teste o atendimento antes de publicar, sem WhatsApp.',
    texto: 'Uma conversa de teste dentro do painel, com o mesmo cálculo do atendimento de verdade, mostrando ao lado o que já foi entendido. Serve para conferir um texto novo ou treinar a equipe.',
    alt: 'Simulador de conversa do painel com as mensagens do atendimento e o estado da conversa ao lado.',
  },
  {
    arquivo: 'painel-auditoria',
    titulo: 'Histórico',
    resumo: 'Toda alteração, com quem fez e quando.',
    texto: 'Cada mudança de preço, condição, texto, corretor ou acesso fica registrada com o nome de quem fez, a data e o que mudou.',
    alt: 'Histórico de alterações do painel, com data, usuário, ação e detalhes.',
  },
  {
    arquivo: 'painel-usuarios',
    titulo: 'Equipe e acessos',
    resumo: 'Administrador, gerente e corretor, cada um com o que precisa.',
    texto: 'O administrador cria os acessos da equipe. O gerente cuida de leads, condições e textos; o corretor vê só os leads dele. Ninguém precisa compartilhar senha.',
    alt: 'Tela de usuários do painel com o administrador e o formulário para adicionar um novo acesso.',
  },
];
