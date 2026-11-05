import type { OptionDef } from '@mvp/parsers';

/** Estados com pergunta ao lead (depois do consentimento). */
export type QuestionState =
  | 'NAME' | 'PHONE_CONFIRM' | 'PHONE' | 'EMAIL' | 'INTEREST'
  | 'INCOME' | 'INCOME_TYPE' | 'BIRTH' | 'DEBTS'
  | 'CO_ASK' | 'CO_INCOME' | 'CO_INCOME_TYPE' | 'CO_BIRTH' | 'CO_DEBTS'
  | 'DOWN' | 'INSTALLMENT' | 'FGTS_ASK' | 'FGTS_BALANCE' | 'FGTS_MONTHS'
  | 'OWNS' | 'FIRST' | 'CONFIRM' | 'CORRECTION_MENU' | 'HANDOFF_OFFER' | 'LGPD_CONFIRM'
  /** Depois do resultado: menu e ajustes de entrada/prazo (Fase 6). */
  | 'RESULT' | 'ADJUST_DOWN' | 'ADJUST_TERM'
  /** V2: início pelo formulário do site (double opt-in) e escolha do empreendimento (início pelo WhatsApp). */
  | 'CONTACT_CONFIRM' | 'DEVELOPMENT'
  /** V2: forma de pagamento e os ramos dos três modos. */
  | 'PAYMENT_MODE' | 'DOWN_CASH' | 'CASH_NOW' | 'DESIRED_INSTALLMENT' | 'BALLOONS'
  /** V2: oferta do pagamento à vista e ajustes do resultado dos modos novos. */
  | 'CASH_OFFER' | 'ADJUST_ACT' | 'ADJUST_BALLOONS' | 'ADJUST_UNIT';

/**
 * Estados em que o bot não pergunta nada. SIMULATING é transitório: o orquestrador calcula e
 * apresenta o resultado (e retoma de onde parou se o processo cair no meio).
 */
export type TerminalState = 'DONE' | 'HANDOFF' | 'OPTED_OUT' | 'LGPD_PENDING' | 'SIMULATING' | 'ERASED';
export type StateName = QuestionState | TerminalState;

/** Formas de pagamento (espelha PAYMENT_MODES do motor). */
export type PaymentModeId = 'A_VISTA' | 'ENTRADA_A_VISTA' | 'ENTRADA_PARCELADA';

export interface Collected {
  name?: string;
  /** E.164 só com dígitos. */
  phone?: string;
  /** null = o lead pulou (campo opcional, RF-14). */
  email?: string | null;
  typology?: string;
  income?: number;
  incomeType?: string;
  birthDate?: string;
  debts?: number;
  hasCoApplicant?: boolean;
  coIncome?: number;
  coIncomeType?: string;
  coBirthDate?: string;
  coDebts?: number;
  downPayment?: number;
  /** Parcela mensal que o lead quer pagar; 0 = sem preferência. */
  desiredInstallment?: number;
  hasFgts?: boolean;
  fgtsBalance?: number;
  fgtsMonths?: number;
  ownsProperty?: boolean;
  firstFinancing?: boolean;
  /** V2: empreendimento (id) escolhido no chat ou vindo do formulário. */
  developmentId?: string;
  /** V2: forma de pagamento escolhida. */
  paymentMode?: PaymentModeId;
  /** V2: dinheiro disponível hoje (entrada à vista ou ato). */
  cashNow?: number;
  /** V2: aceita reforços na entrada parcelada. */
  acceptsBalloons?: boolean;
}

export type Reply =
  | { text: string }
  | { list: { title: string; options: string[]; footer?: string } }
  /** PDF da simulação, gerado no envio a partir da simulação gravada. */
  | { pdf: { simulationId: string; caption: string } };

/** Ajustes pedidos pelo lead depois do primeiro resultado (RF-27). Valem só para a simulação. */
export interface Adjust {
  /** Entrada em dinheiro que o lead diz conseguir (fora o FGTS). */
  downPayment?: number;
  /** Prazo desejado, em meses. */
  termMonths?: number;
  /** V2: dinheiro disponível hoje que o lead informou no ajuste (ato ou entrada à vista). */
  cashNow?: number;
  /** V2: aceitar ou recusar reforços, pedido no ajuste. */
  acceptsBalloons?: boolean;
}

export interface HistoryEntry {
  role: 'lead' | 'bot';
  text: string;
  at: string;
}

/** Tudo o que a conversa precisa para ser retomada. Serializável (vai em conversations.context). */
export interface Snapshot {
  state: StateName;
  data: Collected;
  /** Depois de corrigir/voltar, para onde seguir quando nada mais faltar. */
  returnTo: QuestionState | null;
  /** Respostas não entendidas seguidas na etapa atual. */
  failures: number;
  /** Etapa a retomar ao sair do menu de correção ou ao recusar o handoff oferecido. */
  resumeTo: QuestionState | null;
  /** Último id de mensagem do canal já aplicado (idempotência da reentrega). */
  lastInboundId: string | null;
  /** Ajustes de entrada/prazo em vigor (vazio até o lead pedir). */
  adjust: Adjust;
  /** Última simulação apresentada ao lead (id em `simulations`). */
  simulationId: string | null;
  /** Estado em que o lead estava ao pedir a exclusão dos dados (para onde voltar se desistir). */
  lgpdFrom: StateName | null;
  /** Estado em que o lead estava ao pedir o corretor (para onde voltar se o corretor devolver a conversa). */
  handoffFrom: StateName | null;
  /** Respostas decididas e ainda não confirmadas como enviadas. */
  outbox: Reply[];
  history: HistoryEntry[];
}

/** Regras comerciais do empreendimento que mudam as perguntas (da condição vigente). */
export interface DevelopmentSales {
  /** Formas de pagamento oferecidas, na ordem de apresentação. */
  modes: readonly PaymentModeId[];
  /** Estimativa do financiamento do saldo ligada: pede nascimento, FGTS e elegibilidade. */
  bankEstimate: boolean;
  /** Intervalo dos reforços, em meses; null = a condição não oferece reforços. */
  balloonIntervalMonths: number | null;
}

export interface DevelopmentInfo {
  id: string;
  name: string;
  typologies: readonly OptionDef[];
  /** Ausente = sem condição comercial vigente: o empreendimento segue o fluxo de financiamento do MVP. */
  sales?: DevelopmentSales;
}

/** Fluxo publicado (FlowConfig): textos por chave e etapas opcionais. Ausente = padrões do código. */
export interface FlowSettings {
  texts?: Readonly<Record<string, string>>;
  optionalSteps?: Readonly<Record<string, boolean>>;
  firstContact?: string | null;
}

export interface FlowEnv {
  /** AAAA-MM-DD. */
  today: string;
  developmentName: string;
  typologies: readonly OptionDef[];
  /** Telefone do próprio chat (E.164), se o canal informou; null para LID. */
  channelPhone: string | null;
  /** V2: empreendimentos ativos com tipologias e regras comerciais. Ausente = um só, fluxo do MVP. */
  developments?: readonly DevelopmentInfo[];
  /** V2: textos e etapas opcionais do fluxo publicado. */
  flow?: FlowSettings;
}

export type Effect =
  | {
      type: 'set_lead';
      fields: { name?: string; phone?: string; email?: string | null; birthDate?: string; developmentId?: string; paymentMode?: PaymentModeId };
    }
  /** Double opt-in: o lead do formulário confirmou que pediu a simulação. */
  | { type: 'contact_confirmed' }
  | { type: 'lead_status'; status: 'HANDOFF' | 'OPTED_OUT' | 'IN_PROGRESS' | 'CLOSED' }
  | { type: 'handoff' }
  | { type: 'audit'; action: 'optout' | 'lgpd_request' | 'handoff_requested' | 'contact_declined' }
  /** O lead confirmou a exclusão: o orquestrador apaga tudo em vez de gravar o turno. */
  | { type: 'erase' }
  /** Todos os dados coletados e confirmados: gravar o perfil financeiro. */
  | { type: 'collected' };

export interface StepResult {
  snapshot: Snapshot;
  replies: Reply[];
  effects: Effect[];
}
