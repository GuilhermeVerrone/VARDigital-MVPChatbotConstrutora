// Guia das funcionalidades: o que cada parte faz, quem usa, o passo a passo e os prints reais.

export interface PrintRef { arquivo: string; alt: string; legenda: string }
export interface Funcionalidade {
  id: string;
  titulo: string;
  quem: string[];
  resumo: string;
  passos: string[];
  prints?: PrintRef[];
  /** Mensagens reais de uma conversa (id da persona e trecho). */
  conversa?: { id: string; de?: number; ate?: number; legenda: string; corretor?: boolean };
  dica?: string;
}

export const FUNCIONALIDADES: Funcionalidade[] = [
  {
    id: 'site',
    titulo: 'Site e formulário',
    quem: ['Comprador', 'Marketing'],
    resumo: 'Cada empreendimento tem a sua página, com o preço "a partir de" e a situação vindos do painel, e o formulário "Simule sua condição".',
    passos: [
      'O interessado abre a página do empreendimento, vinda do anúncio ou do site da construtora.',
      'Em "Simule sua condição", escolhe a planta e informa nome e WhatsApp (o e-mail é opcional).',
      'Marca os dois aceites, de privacidade e de contato, que sempre vêm desmarcados.',
      'Ao enviar, vê a página de confirmação com o código do pedido e um botão para abrir o WhatsApp.',
    ],
    prints: [
      { arquivo: 'site-empreendimento', alt: 'Página do empreendimento Lumen Urban no site de exemplo.', legenda: 'Página do empreendimento' },
      { arquivo: 'site-formulario-celular', alt: 'Formulário Simule sua condição no celular, preenchido.', legenda: 'Formulário no celular' },
      { arquivo: 'site-obrigado', alt: 'Página de confirmação com o código do pedido e o botão do WhatsApp.', legenda: 'Confirmação do pedido' },
    ],
    dica: 'Se a pessoa enviar o formulário duas vezes, o ConstruBot reconhece o telefone: não cria outro lead nem manda a mensagem de novo.',
  },
  {
    id: 'whatsapp',
    titulo: 'Atendimento no WhatsApp',
    quem: ['Comprador'],
    resumo: 'Perguntas curtas, uma de cada vez, em linguagem de gente. O comprador responde do jeito que escreve no dia a dia.',
    passos: [
      'Quem veio do site recebe uma mensagem com o próprio nome e só confirma com "sim". Não precisa repetir nome nem telefone.',
      'Quem chama direto pelo WhatsApp aceita a política de privacidade, diz o nome e escolhe o empreendimento.',
      'O ConstruBot entende respostas como "9 mil", "clt" ou "05/03/1990", e pergunta de novo quando não entende.',
      'Antes de calcular, mostra tudo o que anotou para o comprador conferir. Para mudar algo, basta escrever, por exemplo, "corrigir a renda".',
      'A qualquer momento o comprador pode escrever "quero falar com um corretor", "voltar" ou "parar".',
    ],
    conversa: { id: 'davi', legenda: 'Começo direto pelo WhatsApp (conversa real)' },
  },
  {
    id: 'formas',
    titulo: 'As três formas de pagamento',
    quem: ['Comprador', 'Gerente'],
    resumo: 'O ConstruBot faz a conta em cada uma das formas que a construtora oferece, com as condições publicadas no painel.',
    passos: [
      'À vista: preço da unidade, desconto à vista e o total a pagar.',
      'Entrada de uma vez e financiamento do saldo: a entrada aceita pela construtora, o saldo e a estimativa do financiamento do banco.',
      'Entrada parcelada com a construtora: ato, mensais, reforços (se o comprador aceitar), parcela das chaves e o saldo a financiar.',
      'Depois do resultado, o comprador pode mudar o ato, aceitar ou recusar reforços, ver outra planta, outra forma de pagamento, receber o PDF ou chamar um corretor.',
    ],
    conversa: { id: 'bruno', de: -6, legenda: 'Resultado da entrada de uma vez + financiamento (conversa real)' },
    dica: 'Cada empreendimento pode oferecer só algumas das formas. O que não está ligado nas condições comerciais não aparece para o comprador.',
  },
  {
    id: 'corretor',
    titulo: 'O que o corretor recebe',
    quem: ['Corretor'],
    resumo: 'O lead chega no WhatsApp do corretor com tudo o que ele precisa para a primeira ligação.',
    passos: [
      'Resumo do cliente, interesse, plano de pagamento, parecer, pontos de atenção e um próximo passo sugerido.',
      'O PDF da simulação vem junto, o mesmo que o cliente pode receber.',
      'No painel, o corretor vê só os próprios leads, com a conversa e as simulações.',
      'Quando o cliente pede um corretor, o atendimento automático para naquela conversa. O corretor assume e, se quiser, devolve a conversa ao ConstruBot.',
    ],
    conversa: { id: 'carla', corretor: true, legenda: 'Mensagem real recebida pelo corretor' },
    prints: [{ arquivo: 'pdf-simulacao', alt: 'PDF da simulação da Carla.', legenda: 'PDF da simulação' }],
  },
  {
    id: 'inicio',
    titulo: 'Início',
    quem: ['Gerente', 'Administrador'],
    resumo: 'O resumo do dia na primeira tela do painel.',
    passos: [
      'Leads que chegaram hoje, pelo site e pelo WhatsApp, e conversas esperando corretor.',
      'O funil do formulário: quem preencheu, confirmou o contato, fez a simulação e já está com corretor.',
      'Quantas simulações saíram em cada forma de pagamento e quais condições estão valendo.',
    ],
    prints: [{ arquivo: 'painel-inicio', alt: 'Tela inicial do painel.', legenda: 'Início do painel' }],
  },
  {
    id: 'leads',
    titulo: 'Leads e ficha do lead',
    quem: ['Gerente', 'Corretor'],
    resumo: 'Todos os leads em uma lista, e tudo sobre cada um em uma ficha.',
    passos: [
      'Filtre por empreendimento, forma de pagamento, parecer, situação, corretor ou origem.',
      'Abra a ficha para ver os dados, a conversa, as simulações, o plano da entrada, o aceite de privacidade e o histórico.',
      'Baixe o PDF de qualquer simulação.',
      'Troque o corretor responsável, assuma ou devolva a conversa e, se o cliente pedir, solicite a exclusão dos dados.',
    ],
    prints: [
      { arquivo: 'painel-leads', alt: 'Lista de leads com filtros.', legenda: 'Lista de leads' },
      { arquivo: 'painel-lead', alt: 'Ficha da lead Carla Dias.', legenda: 'Ficha do lead' },
    ],
    dica: 'O corretor só vê e só abre os próprios leads. Atribuir corretor e pedir exclusão ficam com gerente e administrador.',
  },
  {
    id: 'empreendimentos',
    titulo: 'Empreendimentos e unidades',
    quem: ['Gerente', 'Administrador'],
    resumo: 'O cadastro que alimenta o site e as simulações.',
    passos: [
      'Cadastre o empreendimento com cidade, endereço, descrição, previsão de entrega e destaques.',
      'Inclua as unidades com planta, área, preço e situação: disponível, reservada ou vendida.',
      'Publique no site quando estiver pronto. O preço "a partir de" é calculado das unidades disponíveis.',
    ],
    prints: [{ arquivo: 'painel-empreendimentos', alt: 'Lista de empreendimentos do painel.', legenda: 'Empreendimentos' }],
  },
  {
    id: 'condicoes',
    titulo: 'Condições comerciais',
    quem: ['Gerente', 'Administrador'],
    resumo: 'As regras da venda de cada empreendimento, com prévia do cálculo antes de publicar.',
    passos: [
      'Em Empreendimentos, abra "Condições" do empreendimento.',
      'Ajuste entrada mínima e máxima, desconto à vista, ato, número de mensais, reforços e juros da construtora.',
      'Escolha uma unidade e um perfil de exemplo e clique em "Calcular prévia" para ver as três formas de pagamento com a regra nova.',
      'Publique com a data de início e o motivo. A próxima simulação já usa a condição nova.',
      'Consulte o histórico e compare duas versões lado a lado.',
    ],
    prints: [{ arquivo: 'painel-condicoes', alt: 'Tela de condições comerciais com a prévia.', legenda: 'Condições comerciais e prévia' }],
  },
  {
    id: 'financiamento',
    titulo: 'Financiamento simulado',
    quem: ['Administrador'],
    resumo: 'A linha de crédito usada para estimar o financiamento do saldo.',
    passos: [
      'Defina a taxa, o prazo máximo, o sistema de amortização e o limite de comprometimento da renda.',
      'Ao salvar, a estimativa das próximas simulações passa a usar os valores novos.',
      'O gerente consulta; só o administrador altera.',
    ],
    prints: [{ arquivo: 'painel-financiamento', alt: 'Tela de financiamento simulado.', legenda: 'Financiamento simulado' }],
  },
  {
    id: 'corretores',
    titulo: 'Corretores',
    quem: ['Gerente', 'Administrador'],
    resumo: 'Quem recebe os leads e em qual WhatsApp.',
    passos: [
      'Cadastre o nome, o WhatsApp que recebe o aviso do lead, o e-mail e a equipe.',
      'Desative quem saiu: deixa de receber leads novos, e o histórico continua.',
    ],
    prints: [{ arquivo: 'painel-corretores', alt: 'Tela de corretores.', legenda: 'Corretores' }],
  },
  {
    id: 'usuarios',
    titulo: 'Equipe e acessos',
    quem: ['Administrador', 'Todos'],
    resumo: 'Cada pessoa com o seu acesso e só o que precisa ver.',
    passos: [
      'O administrador cria o acesso com nome, e-mail, papel e uma senha inicial. Para o corretor, vincula o cadastro de corretor.',
      'Na primeira entrada, o painel pede para a pessoa trocar a senha em "Minha conta".',
      'Desativar, mudar o papel ou redefinir a senha encerra na hora os acessos abertos daquela pessoa.',
      'Depois de várias senhas erradas seguidas, o acesso fica bloqueado por alguns minutos.',
    ],
    prints: [
      { arquivo: 'painel-usuarios', alt: 'Tela de usuários do painel.', legenda: 'Usuários' },
      { arquivo: 'painel-conta', alt: 'Tela Minha conta com a troca de senha.', legenda: 'Minha conta' },
    ],
  },
  {
    id: 'textos',
    titulo: 'Textos do atendimento',
    quem: ['Gerente', 'Administrador'],
    resumo: 'O jeito de falar do atendimento é da sua construtora.',
    passos: [
      'Edite a mensagem de cada etapa, usando o nome do cliente e do empreendimento onde quiser.',
      'Ligue ou desligue as etapas opcionais e edite a mensagem do primeiro contato.',
      'Salve como rascunho, confira no simulador e publique. Se não gostar, volte à versão anterior.',
      'O aviso legal fica travado, e palavras proibidas, como "garantido", impedem a publicação.',
    ],
    prints: [{ arquivo: 'painel-fluxo', alt: 'Editor dos textos do atendimento.', legenda: 'Textos do atendimento' }],
  },
  {
    id: 'simulador',
    titulo: 'Simulador de conversa',
    quem: ['Gerente', 'Administrador'],
    resumo: 'Uma conversa de teste dentro do painel, sem WhatsApp e sem gravar nada.',
    passos: [
      'Escolha o rascunho ou a versão publicada, o início (pelo site ou pelo WhatsApp) e o empreendimento.',
      'Responda como um comprador. Ao lado aparece o que o atendimento já entendeu.',
      'Use para conferir um texto antes de publicar ou para treinar a equipe.',
    ],
    prints: [{ arquivo: 'painel-simulador', alt: 'Simulador de conversa do painel.', legenda: 'Simulador de conversa' }],
  },
  {
    id: 'conexao',
    titulo: 'WhatsApp conectado',
    quem: ['Gerente', 'Administrador'],
    resumo: 'Mostra se o número do atendimento está conectado.',
    passos: [
      'A tela mostra a situação do número do atendimento.',
      'Se a conexão cair, as mensagens ficam guardadas e saem quando ela voltar.',
    ],
    prints: [{ arquivo: 'painel-whatsapp', alt: 'Tela de situação do WhatsApp.', legenda: 'Situação do WhatsApp' }],
  },
  {
    id: 'historico',
    titulo: 'Histórico de alterações',
    quem: ['Gerente', 'Administrador'],
    resumo: 'Quem mudou o quê, e quando.',
    passos: [
      'Toda mudança de cadastro, condição, texto, corretor ou acesso fica registrada, com o antes e o depois.',
      'Filtre por tipo, ação, pessoa e período.',
    ],
    prints: [{ arquivo: 'painel-auditoria', alt: 'Histórico de alterações.', legenda: 'Histórico' }],
  },
  {
    id: 'privacidade',
    titulo: 'Privacidade do comprador',
    quem: ['Gerente', 'Jurídico'],
    resumo: 'Cuidado com os dados desde o formulário até a exclusão.',
    passos: [
      'No formulário, os aceites de privacidade e de contato vêm desmarcados, e o texto aceito fica guardado na ficha do lead.',
      'No WhatsApp, a conversa só continua depois do "sim" do comprador.',
      'O comprador pode escrever "apagar meus dados" a qualquer momento. O ConstruBot confirma e apaga.',
      'Pelo painel, o gerente também pode pedir a exclusão de um lead.',
      'Quem escreve "parar" não recebe mais mensagens.',
    ],
  },
];
