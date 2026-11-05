import {
  applyInterpretation, bankEstimateOn, enterResult, failSimulation, firstContactText, formSnapshot, initialSnapshot, interpretStep, isPaymentFlow, questionFor, T,
  type Collected, type FlowEnv, type Reply, type Snapshot, type StepResult,
} from '@mvp/conversation';
import { getPublishedFlowConfig, getFlowOverview, isSimulationDataError, PanelValidationError, simulateCollected, todayIso, type StoredFlowConfig } from '@mvp/db/panel';
import { paymentLegalMessage, paymentResultMessages } from '@mvp/presentation';
import type { IncomeType } from '@mvp/simulation';
import { assertCan } from './permissions';
import { buildFlowEnv, toFlowSettings, type ServiceCtx } from './services';

// Simulador de conversa (Fase 15): roda a MESMA máquina de estados do bot (`interpretStep` →
// `applyInterpretation` → `enterResult`) e o MESMO cálculo da simulação, só que sem WhatsApp, sem
// lead, sem gravar nada e sem LLM (só os parsers, como o bot sem chave). O estado da conversa vive no
// navegador e volta a cada mensagem; o servidor não guarda nada. Roda o rascunho ou a versão publicada.

export type SimSource = 'draft' | 'published';
export type SimEntry = 'WHATSAPP' | 'FORM';

export interface SimMessage {
  from: 'bot' | 'lead' | 'system';
  text: string;
  /** Opções numeradas (pergunta em lista). */
  options?: string[];
  /** Bloco legal: texto travado no código, que o editor do fluxo não altera. */
  locked?: boolean;
}

export interface SimTurn {
  snapshot: Snapshot;
  messages: SimMessage[];
  state: string;
  collected: Collected;
  /** Efeitos do turno que no bot real gravariam algo (nada é gravado aqui). */
  effects: string[];
  ended: boolean;
  /** Qual fluxo rodou: 'rascunho', 'v3 (publicada)' ou 'padrão do código'. */
  flowLabel: string;
}

const FORM_LEAD = { name: 'Maria Teste', phone: '5541999990000' } as const;
const TERMINAL = new Set(['DONE', 'HANDOFF', 'OPTED_OUT', 'ERASED', 'LGPD_PENDING']);

function checkSnapshot(raw: unknown): Snapshot {
  const s = raw as Partial<Snapshot> | null;
  if (!s || typeof s !== 'object' || typeof s.state !== 'string' || typeof s.data !== 'object' || s.data === null) {
    throw new PanelValidationError({ _: 'Estado da conversa inválido. Reinicie o simulador.' });
  }
  return { ...initialSnapshot(), ...s, history: Array.isArray(s.history) ? s.history : [] } as Snapshot;
}

async function resolveFlow(ctx: ServiceCtx, source: SimSource): Promise<{ stored: StoredFlowConfig | null; label: string }> {
  if (source === 'draft') {
    const { draft, published } = await getFlowOverview(ctx.db);
    if (draft) return { stored: draft, label: 'rascunho' };
    return published ? { stored: published, label: `v${published.version} (publicada; não há rascunho)` } : { stored: null, label: 'padrão do código' };
  }
  const published = await getPublishedFlowConfig(ctx.db);
  return published ? { stored: published, label: `v${published.version} (publicada)` } : { stored: null, label: 'padrão do código' };
}

const replyMessage = (r: Reply): SimMessage => {
  if ('text' in r) return { from: 'bot', text: r.text };
  if ('list' in r) return { from: 'bot', text: [r.list.title, r.list.footer].filter(Boolean).join('\n'), options: r.list.options };
  return { from: 'bot', text: '[PDF da simulação: gerado só no bot real]' };
};

const EFFECT_LABEL: Record<string, string> = {
  set_lead: 'gravaria dados do lead',
  contact_confirmed: 'confirmaria o contato (double opt-in)',
  lead_status: 'mudaria o status do lead',
  handoff: 'chamaria um corretor (nenhum corretor é avisado no simulador)',
  audit: 'gravaria na auditoria',
  erase: 'apagaria os dados do lead',
  collected: 'gravaria o perfil financeiro',
};

function toTurn(result: StepResult, flowLabel: string, legal: Set<string>): { turn: SimTurn; messages: SimMessage[] } {
  const messages = result.replies.map((r) => {
    const m = replyMessage(r);
    return legal.has(m.text) ? { ...m, locked: true } : m;
  });
  const effects = [...new Set(result.effects.map((e) => EFFECT_LABEL[e.type] ?? e.type))];
  const ended = TERMINAL.has(result.snapshot.state) || result.effects.some((e) => e.type === 'erase');
  return { turn: { snapshot: result.snapshot, messages, state: result.snapshot.state, collected: result.snapshot.data, effects, ended, flowLabel }, messages };
}

/** Calcula a simulação com o que a conversa coletou (nada é gravado) e apresenta o resultado como o bot. */
async function finishSimulation(ctx: ServiceCtx, snap: Snapshot, env: FlowEnv, at: string): Promise<{ result: StepResult; legal: string[] }> {
  const d = snap.data;
  const developmentId = d.developmentId ?? (env.developments?.length === 1 ? env.developments[0]!.id : undefined);
  if (!(isPaymentFlow(env, d) && d.paymentMode) || !d.typology) return { result: failSimulation(snap, at), legal: [] };
  try {
    const adjust = snap.adjust ?? {};
    const mode = d.paymentMode;
    const { view } = await simulateCollected(ctx.db, {
      mode,
      referenceDate: env.today,
      typology: d.typology,
      ...(developmentId ? { developmentId } : {}),
      name: d.name ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      ...(d.birthDate ? { birthDate: d.birthDate } : {}),
      profile: {
        income: d.income ?? 0,
        incomeType: (d.incomeType ?? 'CLT') as IncomeType,
        debts: d.debts ?? 0,
        cashNow: adjust.cashNow ?? d.cashNow ?? d.downPayment ?? 0,
        acceptsBalloons: adjust.acceptsBalloons ?? d.acceptsBalloons ?? null,
        fgtsBalance: d.hasFgts ? (d.fgtsBalance ?? 0) : null,
        fgtsMonths: d.hasFgts ? (d.fgtsMonths ?? 0) : null,
        ownsProperty: d.ownsProperty ?? false,
        firstFinancing: d.firstFinancing ?? true,
      },
      choices: {
        ...(mode !== 'A_VISTA' ? { cashNow: adjust.cashNow ?? d.cashNow ?? 0 } : {}),
        ...(d.desiredInstallment ? { desiredInstallment: d.desiredInstallment } : {}),
        ...(mode === 'ENTRADA_PARCELADA' ? { acceptsBalloons: adjust.acceptsBalloons ?? d.acceptsBalloons ?? false } : {}),
        ...(!bankEstimateOn(env, d) ? { skipBankEstimate: true } : {}),
      },
    });
    const messages = paymentResultMessages(view);
    const legal = paymentLegalMessage(view.generatedAt, view.result.conditionStatus === 'ILUSTRATIVO', view.result.bankEstimate !== null);
    return { result: enterResult(snap, env, { simulationId: 'simulador', messages, brokerAlreadyNotified: false, at, next: mode === 'A_VISTA' ? 'CASH_OFFER' : 'RESULT' }), legal: [legal] };
  } catch (err) {
    if (isSimulationDataError(err)) return { result: failSimulation(snap, at), legal: [] };
    throw err;
  }
}

export interface SimulatorStartInput {
  source: SimSource;
  entry: SimEntry;
  /** Empreendimento da conversa; vazio = o bot pergunta (início pelo WhatsApp com vários empreendimentos). */
  developmentId?: string;
}

/** Começa uma conversa nova: pelo WhatsApp (consentimento simulado como aceito) ou pelo formulário do site. */
export async function simulatorStart(ctx: ServiceCtx, input: SimulatorStartInput): Promise<SimTurn> {
  assertCan(ctx.user, 'simulator:use');
  const today = ctx.today ?? todayIso();
  const { stored, label } = await resolveFlow(ctx, input.source);
  const env = await buildFlowEnv(ctx.db, today, stored ? toFlowSettings(stored.content) : undefined);
  const at = new Date().toISOString();
  const developmentId = input.developmentId || (env.developments?.length === 1 ? env.developments[0]!.id : undefined);
  const dev = env.developments?.find((d) => d.id === developmentId);

  if (input.entry === 'FORM') {
    const snap = formSnapshot({ ...FORM_LEAD, email: null, ...(developmentId ? { developmentId } : {}) });
    const first: Reply = { text: firstContactText(env, { nome: 'Maria', empreendimento: dev?.name ?? env.developmentName }) };
    const messages: SimMessage[] = [{ from: 'system', text: 'O lead preencheu o formulário do site. O bot envia a 1ª mensagem:' }, replyMessage(first)];
    return { snapshot: { ...snap, history: [{ role: 'bot', text: (first as { text: string }).text, at }] }, messages, state: snap.state, collected: snap.data, effects: [], ended: false, flowLabel: label };
  }

  const fresh = initialSnapshot();
  const base: Snapshot = developmentId ? { ...fresh, data: { ...fresh.data, developmentId } } : fresh;
  const greeting = T.greetingAndConsent(dev?.name ?? env.developmentName);
  const question = questionFor(base.state, base, env);
  const messages: SimMessage[] = [
    { from: 'bot', text: greeting, locked: true },
    { from: 'system', text: 'Consentimento simulado como aceito. Nada é gravado.' },
    { from: 'bot', text: T.consentThanks },
    ...question.map(replyMessage),
  ];
  return { snapshot: base, messages, state: base.state, collected: base.data, effects: [], ended: false, flowLabel: label };
}

export interface SimulatorSendInput {
  source: SimSource;
  snapshot: unknown;
  text: string;
}

/** Aplica uma mensagem do lead ao estado da conversa e devolve as respostas do bot. */
export async function simulatorSend(ctx: ServiceCtx, input: SimulatorSendInput): Promise<SimTurn> {
  assertCan(ctx.user, 'simulator:use');
  const text = input.text.trim();
  if (!text) throw new PanelValidationError({ text: 'Digite uma mensagem' });
  if (text.length > 1000) throw new PanelValidationError({ text: 'Mensagem longa demais (máximo 1000 caracteres)' });
  const snap = checkSnapshot(input.snapshot);
  const today = ctx.today ?? todayIso();
  const { stored, label } = await resolveFlow(ctx, input.source);
  const env = await buildFlowEnv(ctx.db, today, stored ? toFlowSettings(stored.content) : undefined, FORM_LEAD.phone);
  const at = new Date().toISOString();
  const meta = { messageId: `sim-${snap.history.length}-${Date.now()}`, input: text, at };

  const it = await interpretStep(text, snap, env, {});
  let result = applyInterpretation(snap, it, env, meta);
  let legal: string[] = [];
  if (result.snapshot.state === 'SIMULATING') {
    const done = await finishSimulation(ctx, result.snapshot, env, at);
    legal = done.legal;
    // O resultado mostra tudo o que o bot responde nesta rodada: as respostas de antes do cálculo (se houver) e o resultado.
    result = { snapshot: done.result.snapshot, replies: [...result.replies.filter((r) => !('text' in r && r.text === T.stillCalculating)), ...done.result.replies], effects: [...result.effects, ...done.result.effects] };
  }
  const { turn, messages } = toTurn(result, label, new Set(legal));
  return { ...turn, messages: [{ from: 'lead', text }, ...messages] };
}
