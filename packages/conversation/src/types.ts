import type { OptionDef } from '@mvp/parsers';

/** Estados com pergunta ao lead (depois do consentimento). */
export type QuestionState =
  | 'NAME' | 'PHONE_CONFIRM' | 'PHONE' | 'EMAIL' | 'INTEREST'
  | 'INCOME' | 'INCOME_TYPE' | 'BIRTH' | 'DEBTS'
  | 'CO_ASK' | 'CO_INCOME' | 'CO_INCOME_TYPE' | 'CO_BIRTH' | 'CO_DEBTS'
  | 'DOWN' | 'FGTS_ASK' | 'FGTS_BALANCE' | 'FGTS_MONTHS'
  | 'OWNS' | 'FIRST' | 'CONFIRM' | 'CORRECTION_MENU' | 'HANDOFF_OFFER';

/** Estados finais: o bot não pergunta mais nada. */
export type TerminalState = 'DONE' | 'HANDOFF' | 'OPTED_OUT' | 'LGPD_PENDING';
export type StateName = QuestionState | TerminalState;

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
  hasFgts?: boolean;
  fgtsBalance?: number;
  fgtsMonths?: number;
  ownsProperty?: boolean;
  firstFinancing?: boolean;
}

export type Reply = { text: string } | { list: { title: string; options: string[]; footer?: string } };

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
  /** Respostas decididas e ainda não confirmadas como enviadas. */
  outbox: Reply[];
  history: HistoryEntry[];
}

export interface FlowEnv {
  /** AAAA-MM-DD. */
  today: string;
  developmentName: string;
  typologies: readonly OptionDef[];
  /** Telefone do próprio chat (E.164), se o canal informou; null para LID. */
  channelPhone: string | null;
}

export type Effect =
  | { type: 'set_lead'; fields: { name?: string; phone?: string; email?: string | null; birthDate?: string } }
  | { type: 'lead_status'; status: 'HANDOFF' | 'OPTED_OUT' | 'IN_PROGRESS' | 'CLOSED' }
  | { type: 'handoff' }
  | { type: 'audit'; action: 'optout' | 'lgpd_request' | 'handoff_requested' }
  /** Todos os dados coletados e confirmados: gravar o perfil financeiro. */
  | { type: 'collected' };

export interface StepResult {
  snapshot: Snapshot;
  replies: Reply[];
  effects: Effect[];
}
