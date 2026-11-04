// Mensagens ao lead (RF-03, spec §5.1): curtas, cordiais, uma pergunta por vez. O LLM não escreve
// nenhuma delas; os únicos números que aparecem vêm do que o próprio lead informou.

export const CONSENT_TEXT_VERSION = 'ilustrativo-1';

export const brl = (v: number): string =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;

export const formatDateBr = (iso: string): string => iso.split('-').reverse().join('/');

export const formatPhone = (e164: string): string => {
  const n = e164.replace(/^55/, '');
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
};

export const T = {
  greetingAndConsent: (development: string) =>
    `Olá! Sou o assistente virtual da construtora e vou te ajudar a fazer uma simulação de financiamento do ${development}. É rápido, leva uns 5 minutos.\n\n` +
    'Para isso, preciso guardar as informações que você me passar (nome, contato e dados financeiros) e compartilhá-las com um corretor da construtora, só para atender a sua simulação. Nunca peço CPF, RG, senha ou dados de cartão.\n\n' +
    'Você concorda? Responda *sim* ou *não*.',
  consentReask: 'Para continuar, preciso saber se você concorda em eu guardar seus dados para a simulação. Responda *sim* ou *não*.',
  consentDeclined: 'Tudo bem, sem problema! Não guardei nenhum dado seu. Se mudar de ideia, é só mandar uma mensagem. 😊',
  consentNeededForHuman: 'Posso chamar um corretor para você, mas antes preciso do seu OK para guardar seu contato. Você concorda? Responda *sim* ou *não*.',
  consentThanks: 'Obrigado! Vamos começar.',
  nothingStored: 'Você não tem dados guardados comigo, já que ainda não aceitou a coleta. Se quiser, é só me chamar para começar.',

  askName: 'Qual é o seu nome completo?',
  askPhoneConfirm: (phone: string) => `Posso usar este número, ${phone}, para o corretor falar com você? (sim/não)`,
  askPhone: 'Qual o seu telefone com DDD? Pode ser assim: (13) 98126-4295',
  askEmail: 'Qual o seu e-mail? É opcional: se preferir pular, responda *pular*.',
  askInterest: (development: string) => ({ title: `Qual tipo de unidade do ${development} você procura?`, footer: 'Responda com o número.' }),
  askIncome: 'Para simular, qual é a renda bruta mensal da família? Pode somar a de quem vai comprar junto.',
  askIncomeType: { title: 'Qual é o seu tipo de renda?', footer: 'Responda com o número.' },
  askBirth: 'Qual a sua data de nascimento? Ex.: 05/03/1990',
  askDebts: 'Hoje você paga alguma parcela todo mês (financiamento, empréstimo, cartão parcelado)? Se pagar, me diga quanto dá por mês, somando tudo. Se não, é só responder *não*.',
  askCoApplicant: 'Vai comprar junto com mais alguém (cônjuge, familiar) e somar renda? (sim/não)',
  askCoIncome: 'Qual a renda bruta mensal dessa outra pessoa?',
  askCoIncomeType: { title: 'E o tipo de renda dela?', footer: 'Responda com o número.' },
  askCoBirth: 'Qual a data de nascimento dela? Ex.: 05/03/1990',
  askCoDebts: 'E ela paga alguma parcela todo mês (financiamento, empréstimo, cartão parcelado)? Se pagar, quanto dá por mês, somando tudo? Se não, é só responder *não*.',
  askDown: 'Quanto você tem disponível para a entrada, sem contar o FGTS? Se nada por enquanto, responda *0*.',
  askInstallment: 'Qual valor da sua renda você gostaria de destinar para pagar a parcela do financiamento? Se não tiver um valor em mente, responda *não sei*.',
  askFgts: 'Você tem saldo de FGTS para usar? (sim/não)',
  askFgtsBalance: 'Qual o saldo aproximado do seu FGTS?',
  askFgtsMonths: 'Há quanto tempo você trabalha com carteira assinada (FGTS)? Ex.: 3 anos',
  askOwns: 'Você possui algum imóvel residencial em seu nome? (sim/não)',
  askFirst: 'Esse seria o seu primeiro imóvel financiado? (sim/não)',
  confirmIntro: 'Conferindo o que anotei:',
  confirmAsk: 'Está tudo certo? (sim/não)',
  correctionMenu: { title: 'O que você quer corrigir?', footer: 'Responda com o número ou o nome do item.' },
  handoffOffer: 'Estou com dificuldade de entender. Quer que eu chame um corretor para te ajudar? (sim/não)',

  ack: (text: string) => `Certo, ${text}.`,
  reask: (hint: string) => `Não consegui entender. ${hint}`,
  incomeZero: 'A renda precisa ser maior que zero. Qual a renda bruta mensal?',
  underage: 'Para financiar, é preciso ter 18 anos ou mais. Confere a data de nascimento? Ex.: 05/03/1990',
  tooOld: 'Essa data parece muito antiga. Pode conferir? Ex.: 05/03/1990',
  futureDate: 'Essa data ainda não chegou. Pode conferir? Ex.: 05/03/1990',
  faqRedirect: 'Boa pergunta! Não tenho essa informação aqui, vou deixar anotada para o corretor responder com precisão. Vamos continuar a simulação:',
  offTopic: 'Posso ajudar só com a simulação de financiamento. Vamos continuar:',
  textOnly: 'Por enquanto só consigo ler mensagens de texto. Pode digitar sua resposta?',
  injection: 'Não posso fazer isso. Vamos continuar a simulação:',
  notYet: 'Ainda não chegamos nessa pergunta, mas já vou anotar quando chegarmos. Vamos continuar:',
  noPrevious: 'Essa já é a primeira pergunta. Vamos em frente:',
  wentBack: 'Sem problema, vamos refazer:',
  paused: 'Tudo bem! Deixei sua simulação guardada. Quando quiser continuar, é só me mandar uma mensagem.',
  resume: 'Que bom te ver de novo! Vamos continuar de onde paramos:',
  handoff: 'Combinado! Vou pedir para um corretor falar com você por aqui. Enquanto isso, não vou mais enviar perguntas.',
  handoffDeclined: 'Certo, vamos tentar de novo:',
  optout: 'Entendido, não vou mais te enviar mensagens. Obrigado pela atenção!',
  lgpdConfirm:
    'Entendi: você quer que eu apague os seus dados. Isso inclui o seu cadastro, o que você me contou e as simulações, e o atendimento termina aqui. Não dá para desfazer.\n\nPosso apagar tudo? (sim/não)',
  lgpdKept: 'Tudo bem, não apaguei nada.',
  erased:
    'Pronto, apaguei os seus dados do nosso sistema. Se algum corretor já tinha recebido o seu resumo, vou avisá-lo para apagar também. Se quiser simular de novo um dia, é só me chamar. 😊',
  handoffReturned: 'O corretor me devolveu a conversa. Vamos continuar de onde paramos:',
  calculating: 'Prontinho, anotei tudo! 🙌 Já estou fazendo as contas, é rapidinho.',
  recalculating: 'Certo, vou refazer as contas com essa mudança.',
  brokerInformed: 'Já passei o seu resumo para um corretor da nossa equipe. Ele deve te chamar por aqui em breve.',
  brokerUpdated: 'Atualizei o resumo do corretor com essa nova simulação.',
  resultMenu: {
    title: 'E agora, o que você prefere?',
    footer: 'Responda com o número. Se quiser conversar com um corretor agora, é só pedir.',
  },
  askAdjustDown: (current: number) =>
    `Quanto você consegue colocar de entrada? Hoje considerei ${brl(current)}, fora o FGTS. Pode responder, por exemplo, *80 mil*.`,
  askAdjustTerm: 'Em quanto tempo você gostaria de pagar o financiamento? Por exemplo, *30 anos* ou *360 meses*. Respeito o limite permitido pela sua idade e pelo banco.',
  termRange: 'O prazo precisa ficar entre 1 e 50 anos. Por exemplo, *30 anos* ou *360 meses*.',
  backToMenu: 'Sem problema, voltando às opções:',
  pdfCaption: 'Aqui está o PDF da sua simulação. Lembre-se: é indicativa e não é aprovação de crédito.',
  finished: 'Perfeito! O seu resumo já está com o corretor, que vai entrar em contato por aqui. Foi um prazer te ajudar! 😊',
  simulationFailed: 'Não consegui fechar a simulação agora. Vou pedir para um corretor te ajudar com isso, tudo bem?',
  doneAgain: 'Seu atendimento já está com a nossa equipe. Se quiser falar com um corretor agora, é só pedir.',
  stillCalculating: 'Só um instante, ainda estou fazendo as contas.',
};
