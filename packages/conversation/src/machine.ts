import { interpretReply, type FieldDef, type FieldValue, type InterpretDeps, type Interpretation } from '@mvp/llm';
import { parseCommand, parseOption, type CommandName } from '@mvp/parsers';
import {
  correctionOptions, fieldsFor, isAnswerState, resolveCorrectionTarget, resultOptions, STEPS, summaryLines,
  type AnswerState, type ResultChoice,
} from './steps';
import { T } from './templates';
import type { Collected, Effect, FlowEnv, QuestionState, Reply, Snapshot, StateName, StepResult } from './types';

export const MAX_FAILURES = 3;
const TERMINAL = new Set<StateName>(['DONE', 'HANDOFF', 'OPTED_OUT', 'LGPD_PENDING', 'SIMULATING', 'ERASED']);

/**
 * Nos estados finais o bot não pergunta nada, mas o lead continua podendo exercer seus direitos e
 * pedir um corretor: apagar os dados vale em qualquer um (menos no cálculo, que dura segundos),
 * parar de receber vale para quem ainda está sendo atendido e o corretor, para quem já terminou.
 */
const TERMINAL_COMMANDS: Partial<Record<StateName, readonly CommandName[]>> = {
  DONE: ['human', 'optout', 'lgpd_request'],
  HANDOFF: ['optout', 'lgpd_request'],
  OPTED_OUT: ['lgpd_request'],
  LGPD_PENDING: ['lgpd_request'],
};
const MAX_HISTORY = 60;

export function initialSnapshot(): Snapshot {
  return {
    state: 'NAME', data: {}, returnTo: null, failures: 0, resumeTo: null, lastInboundId: null, adjust: {}, simulationId: null, lgpdFrom: null, outbox: [], history: [],
  };
}

const text = (t: string): Reply => ({ text: t });
const num = (v: FieldValue | null | undefined): number => v as number;

/** Texto curto de uma resposta (histórico e log). */
export function replyPreview(r: Reply): string {
  if ('text' in r) return r.text;
  if ('pdf' in r) return '[PDF da simulação]';
  return [r.list.title, ...r.list.options.map((o, i) => `${i + 1}. ${o}`)].join(' | ');
}

const RESULT_FAMILY = new Set<StateName>(['RESULT', 'ADJUST_DOWN', 'ADJUST_TERM']);
const isResultState = (s: StateName): boolean => RESULT_FAMILY.has(s);

/** Junta um texto de abertura à pergunta, numa mensagem só quando a pergunta é texto. */
function withLead(lead: string | null, question: Reply): Reply[] {
  if (!lead) return [question];
  if ('text' in question) return [text(`${lead}\n\n${question.text}`)];
  return [text(lead), question];
}

/** A pergunta do estado atual (usada na retomada e ao repetir a pergunta). */
export function questionFor(state: StateName, snap: Snapshot, env: FlowEnv): Reply[] {
  switch (state) {
    case 'CONFIRM':
      return [text([T.confirmIntro, ...summaryLines(snap.data, env), '', T.confirmAsk].join('\n'))];
    case 'CORRECTION_MENU':
      return [{ list: { ...T.correctionMenu, options: correctionOptions().map((o) => o.label) } }];
    case 'HANDOFF_OFFER':
      return [text(T.handoffOffer)];
    case 'LGPD_CONFIRM':
      return [text(T.lgpdConfirm)];
    case 'DONE':
      return [text(T.doneAgain)];
    case 'SIMULATING':
      return [text(T.stillCalculating)];
    case 'RESULT':
      return [{ list: { ...T.resultMenu, options: resultOptions().map((o) => o.label) } }];
    case 'ADJUST_DOWN':
      return [text(T.askAdjustDown(snap.adjust?.downPayment ?? snap.data.downPayment ?? 0))];
    case 'ADJUST_TERM':
      return [text(T.askAdjustTerm)];
    default:
      return isAnswerState(state) ? [STEPS[state].question(env, snap.data)] : [];
  }
}

function fieldsOf(state: QuestionState, env: FlowEnv): readonly FieldDef[] {
  switch (state) {
    case 'CONFIRM': return [{ key: 'confirmed', kind: 'boolean' }];
    case 'HANDOFF_OFFER': return [{ key: 'wantsHuman', kind: 'boolean' }];
    case 'LGPD_CONFIRM': return [{ key: 'confirmErase', kind: 'boolean' }];
    case 'CORRECTION_MENU': return [{ key: 'item', kind: 'option', options: correctionOptions() }];
    case 'RESULT': return [{ key: 'item', kind: 'option', options: resultOptions() }];
    case 'ADJUST_DOWN': return [{ key: 'downPayment', kind: 'money' }];
    case 'ADJUST_TERM': return [{ key: 'termMonths', kind: 'months' }];
    default: return fieldsFor(state, env);
  }
}

const questionText = (state: QuestionState, snap: Snapshot, env: FlowEnv): string =>
  questionFor(state, snap, env).map((r) => ('list' in r ? r.list.title : replyPreview(r))).join(' ');

/** Lê a resposta do lead para a etapa atual: comando → filtro → parser → LLM (fallback). */
export async function interpretStep(
  input: string,
  snap: Snapshot,
  env: FlowEnv,
  deps: InterpretDeps,
): Promise<Interpretation> {
  // Estados finais não interpretam nada (e não gastam LLM), só os comandos que ainda valem.
  if (TERMINAL.has(snap.state)) {
    const cmd = parseCommand(input);
    if (cmd && TERMINAL_COMMANDS[snap.state]?.includes(cmd.command)) return { kind: 'command', command: cmd.command, source: 'parser' };
    return { kind: 'off_topic' };
  }
  const state = snap.state as QuestionState;
  if (isAnswerState(state)) {
    const pre = STEPS[state].preParse?.(input);
    if (pre) return { kind: 'answer', fields: pre, source: 'parser' };
  }
  return interpretReply(
    input,
    { state, question: questionText(state, snap, env), fields: fieldsOf(state, env) },
    { ...deps, today: env.today },
  );
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

/** Caminho natural de perguntas (NAME até `target`), conforme os dados atuais. */
function pathUntil(target: StateName, data: Collected, env: FlowEnv): AnswerState[] | null {
  const path: AnswerState[] = [];
  let s: StateName = 'NAME';
  for (let i = 0; i < 40 && isAnswerState(s); i++) {
    if (s === target) return path;
    path.push(s);
    s = STEPS[s].next(data, env);
  }
  return s === target ? path : null;
}

/** Depois de responder `from`: a próxima pergunta, pulando o que já foi respondido numa correção. */
function advance(from: AnswerState, data: Collected, env: FlowEnv, returnTo: QuestionState | null) {
  let next: StateName = STEPS[from].next(data, env);
  if (!returnTo) return { next, returnTo: null };
  for (let i = 0; i < 40 && next !== returnTo && isAnswerState(next) && STEPS[next].answered(data); i++) {
    next = STEPS[next].next(data, env);
  }
  return { next, returnTo: next === returnTo ? null : returnTo };
}

function leadFieldEffects(state: AnswerState, d: Collected): Effect[] {
  switch (state) {
    case 'NAME': return d.name ? [{ type: 'set_lead', fields: { name: d.name } }] : [];
    case 'PHONE_CONFIRM':
    case 'PHONE': return d.phone ? [{ type: 'set_lead', fields: { phone: d.phone } }] : [];
    case 'EMAIL': return [{ type: 'set_lead', fields: { email: d.email ?? null } }];
    case 'BIRTH': return d.birthDate ? [{ type: 'set_lead', fields: { birthDate: d.birthDate } }] : [];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Transição
// ---------------------------------------------------------------------------

export interface TurnMeta {
  messageId: string;
  /** Texto do lead (ou null para mídia). */
  input: string | null;
  at: string;
}

function record(snap: Snapshot, meta: TurnMeta, replies: Reply[]): Snapshot {
  const bot = replies.map((r) => ({ role: 'bot' as const, text: replyPreview(r), at: meta.at }));
  const lead = meta.input ? [{ role: 'lead' as const, text: meta.input, at: meta.at }] : [];
  return { ...snap, lastInboundId: meta.messageId, outbox: replies, history: [...snap.history, ...lead, ...bot].slice(-MAX_HISTORY) };
}

/** Mensagem sem texto (áudio, imagem…): não avança, não conta como erro. */
export function handleNonText(snap: Snapshot, env: FlowEnv, meta: TurnMeta): StepResult {
  const state = snap.state;
  const replies = isAnswerState(state) || state === 'CONFIRM' || state === 'CORRECTION_MENU' || state === 'HANDOFF_OFFER' || state === 'LGPD_CONFIRM' || isResultState(state)
    ? withLead(T.textOnly, questionFor(state, snap, env)[0]!)
    : state === 'DONE' ? [text(T.doneAgain)] : [];
  return { snapshot: record(snap, meta, replies), replies, effects: [] };
}

/** Prefixo de retomada: a conversa ficou parada e o lead voltou. */
export function withResume(result: StepResult, env: FlowEnv, snapBefore: Snapshot): StepResult {
  void env;
  void snapBefore;
  const [first, ...rest] = result.replies;
  if (!first || !('text' in first)) return result;
  const replies = [text(`${T.resume}\n\n${first.text}`), ...rest];
  return { ...result, replies, snapshot: { ...result.snapshot, outbox: replies } };
}

export function applyInterpretation(snap: Snapshot, it: Interpretation, env: FlowEnv, meta: TurnMeta): StepResult {
  const done = (next: Snapshot, replies: Reply[], effects: Effect[] = []): StepResult => ({
    snapshot: record(next, meta, replies), replies, effects,
  });
  const state = snap.state;

  // Estados finais: só os comandos liberados em TERMINAL_COMMANDS passam; o resto é silêncio (ou a lembrança de que já terminou).
  if (state === 'SIMULATING') return done(snap, [text(T.stillCalculating)]);
  const allowed = it.kind === 'command' && TERMINAL_COMMANDS[state]?.includes(it.command);
  if (!allowed) {
    if (state === 'DONE') return done(snap, [text(T.doneAgain)]);
    if (TERMINAL.has(state)) return done(snap, []);
  }

  const qs = state as QuestionState;
  const again = (lead: string | null, next: Snapshot = snap) => withLead(lead, questionFor(next.state, next, env)[0]!);
  const fail = (lead: string): StepResult => {
    const failures = snap.failures + 1;
    // Sem resposta clara sobre apagar, nada é apagado.
    if (failures >= MAX_FAILURES && qs === 'LGPD_CONFIRM') return declineErase();
    if (failures >= MAX_FAILURES && qs !== 'HANDOFF_OFFER') {
      return done({ ...snap, state: 'HANDOFF_OFFER', failures: 0, resumeTo: qs }, [text(T.handoffOffer)]);
    }
    if (failures >= MAX_FAILURES) return handoff(snap);
    const next = { ...snap, failures };
    return done(next, again(lead, next));
  };
  const handoff = (s: Snapshot): StepResult =>
    done({ ...s, state: 'HANDOFF', failures: 0 }, [text(T.handoff)], [
      { type: 'handoff' }, { type: 'lead_status', status: 'HANDOFF' }, { type: 'audit', action: 'handoff_requested' },
    ]);

  switch (it.kind) {
    case 'command':
      switch (it.command) {
        case 'human': return handoff(snap);
        case 'optout':
          return done({ ...snap, state: 'OPTED_OUT' }, [text(T.optout)], [
            { type: 'lead_status', status: 'OPTED_OUT' }, { type: 'audit', action: 'optout' },
          ]);
        case 'lgpd_request':
          // Apagar é irreversível: o bot confirma antes. Se o lead desistir, volta para onde estava.
          return done(
            { ...snap, state: 'LGPD_CONFIRM', failures: 0, lgpdFrom: qs === 'LGPD_CONFIRM' ? snap.lgpdFrom : state },
            [text(T.lgpdConfirm)],
            [{ type: 'audit', action: 'lgpd_request' }],
          );
        case 'exit':
          return done(snap, [text(T.paused)]);
        case 'back': {
          // No resultado "voltar" volta ao menu; para mexer nos dados, o caminho é "corrigir".
          if (isResultState(qs)) return done({ ...snap, state: 'RESULT', failures: 0 }, withLead(T.backToMenu, questionFor('RESULT', snap, env)[0]!));
          const prev = backTarget(snap, env);
          if (!prev) return done(snap, again(T.noPrevious));
          const next: Snapshot = { ...snap, state: prev, failures: 0, returnTo: returnPointOf(snap) };
          return done(next, again(T.wentBack, next));
        }
        case 'correct': {
          // "mudar a entrada"/"mudar o prazo" no resultado são os ajustes, não a correção dos dados.
          const pick = isResultState(qs) && it.target ? parseOption(it.target, resultOptions()) : null;
          if (pick && (pick.id === 'down' || pick.id === 'term')) return chooseResult(pick.id);
          const target = it.target ? resolveCorrectionTarget(it.target, snap.data) : null;
          if (!target) {
            const next: Snapshot = { ...snap, state: 'CORRECTION_MENU', failures: 0, resumeTo: returnPointOf(snap) };
            return done(next, questionFor('CORRECTION_MENU', next, env));
          }
          return jumpTo(target, returnPointOf(snap));
        }
      }
      break;
    case 'skip':
      return answer({ email: null });
    case 'faq':
      return done(snap, again(T.faqRedirect));
    case 'off_topic':
      return fail(T.offTopic);
    case 'reask': {
      if (it.reason === 'suspected_injection') return fail(T.injection);
      return fail(T.reask(hintFor(qs)));
    }
    case 'answer':
      return answer(it.fields);
  }

  function declineErase(): StepResult {
    const back = snap.lgpdFrom ?? 'DONE';
    const next: Snapshot = { ...snap, state: back, failures: 0, lgpdFrom: null };
    return done(next, TERMINAL.has(back) ? [text(T.lgpdKept)] : withLead(T.lgpdKept, questionFor(back, next, env)[0]!));
  }

  function chooseResult(choice: ResultChoice): StepResult {
    switch (choice) {
      case 'down':
      case 'term': {
        const next: Snapshot = { ...snap, state: choice === 'down' ? 'ADJUST_DOWN' : 'ADJUST_TERM', failures: 0 };
        return done(next, questionFor(next.state, next, env));
      }
      case 'pdf': {
        const menu = questionFor('RESULT', snap, env);
        if (!snap.simulationId) return done({ ...snap, state: 'RESULT', failures: 0 }, menu);
        return done({ ...snap, state: 'RESULT', failures: 0 }, [{ pdf: { simulationId: snap.simulationId, caption: T.pdfCaption } }, ...menu]);
      }
      case 'finish':
        return done({ ...snap, state: 'DONE', failures: 0 }, [text(T.finished)]);
    }
  }

  function jumpTo(target: AnswerState, returnTo: QuestionState | null): StepResult {
    if (!STEPS[target].answered(snap.data)) return done(snap, again(T.notYet));
    const next: Snapshot = { ...snap, state: target, failures: 0, returnTo, resumeTo: null };
    return done(next, again(T.wentBack, next));
  }

  function answer(values: Record<string, FieldValue | null>): StepResult {
    if (qs === 'CONFIRM') {
      if (values.confirmed === true) {
        // Dados confirmados: grava o perfil e vai calcular. Uma conversa nova começa sem ajustes.
        return done({ ...snap, state: 'SIMULATING', failures: 0, adjust: {}, simulationId: null }, [text(T.calculating)], [{ type: 'collected' }]);
      }
      const next: Snapshot = { ...snap, state: 'CORRECTION_MENU', failures: 0, resumeTo: 'CONFIRM' };
      return done(next, questionFor('CORRECTION_MENU', next, env));
    }
    if (qs === 'RESULT') return chooseResult(String(values.item) as ResultChoice);
    if (qs === 'ADJUST_DOWN') {
      const adjust = { ...snap.adjust, downPayment: num(values.downPayment) };
      return done({ ...snap, state: 'SIMULATING', failures: 0, adjust }, [text(T.recalculating)]);
    }
    if (qs === 'ADJUST_TERM') {
      const months = num(values.termMonths);
      if (months < 12 || months > 600) return fail(T.termRange);
      const adjust = { ...snap.adjust, termMonths: months };
      return done({ ...snap, state: 'SIMULATING', failures: 0, adjust }, [text(T.recalculating)]);
    }
    if (qs === 'LGPD_CONFIRM') {
      if (values.confirmErase === true) return done({ ...snap, state: 'ERASED', failures: 0, lgpdFrom: null }, [text(T.erased)], [{ type: 'erase' }]);
      return declineErase();
    }
    if (qs === 'HANDOFF_OFFER') {
      if (values.wantsHuman === true) return handoff(snap);
      const back = snap.resumeTo ?? 'NAME';
      const next: Snapshot = { ...snap, state: back, failures: 0, resumeTo: null };
      return done(next, again(T.handoffDeclined, next));
    }
    if (qs === 'CORRECTION_MENU') {
      const target = String(values.item) as AnswerState;
      const returnTo = snap.resumeTo;
      const base = { ...snap, resumeTo: null };
      const next: Snapshot = { ...base, state: target, failures: 0, returnTo };
      return done(next, again(T.wentBack, next));
    }

    const step = STEPS[qs as AnswerState];
    const err = step.validate?.(values, env);
    if (err) return fail(err);
    const data = step.apply(snap.data, values, env);
    const { next, returnTo } = advance(qs as AnswerState, data, env, snap.returnTo);
    const nextSnap: Snapshot = { ...snap, state: next, data, failures: 0, returnTo };
    const ack = step.ack?.(values, data) ?? null;
    return done(nextSnap, withLead(ack, questionFor(next, nextSnap, env)[0]!), leadFieldEffects(qs as AnswerState, data));
  }

  // alcançável só se `it` for um tipo novo não tratado
  return done(snap, again(null));
}

/** Dica de formato para quando a resposta não é entendida. */
function hintFor(state: QuestionState): string {
  if (isAnswerState(state)) return STEPS[state].hint;
  switch (state) {
    case 'CORRECTION_MENU': return 'Responda com o número ou o nome do item.';
    case 'RESULT': return 'Responda com o número de uma das opções.';
    case 'ADJUST_DOWN': return 'Informe o valor. Ex.: 80 mil ou 80000.';
    case 'ADJUST_TERM': return 'Diga o prazo com a unidade. Ex.: 30 anos ou 360 meses.';
    default: return 'Responda *sim* ou *não*.';
  }
}

/** Para onde voltar depois de uma correção/voltar: a etapa atual (ou a confirmação). */
function returnPointOf(snap: Snapshot): QuestionState | null {
  const s = snap.state;
  if (s === 'CORRECTION_MENU' || s === 'HANDOFF_OFFER') return snap.resumeTo;
  // Corrigir um dado depois do resultado leva de volta à confirmação, que recalcula.
  if (isResultState(s)) return 'CONFIRM';
  return isAnswerState(s) || s === 'CONFIRM' ? (s as QuestionState) : null;
}

function backTarget(snap: Snapshot, env: FlowEnv): AnswerState | null {
  const s = snap.state;
  const from = s === 'CORRECTION_MENU' || s === 'HANDOFF_OFFER' ? snap.resumeTo : s;
  if (!from) return null;
  const path = pathUntil(from, snap.data, env);
  return path && path.length > 0 ? path[path.length - 1]! : null;
}



export interface ResultArgs {
  simulationId: string;
  /** Mensagens do resultado já formatadas (resultado e aviso legal). */
  messages: string[];
  /** true quando o corretor já tinha recebido uma simulação deste lead (esta é uma atualização). */
  brokerAlreadyNotified: boolean;
  at: string;
}

/** Resultado apresentado: o lead vê o menu de ajustes e o PDF. Fecha a fase SIMULATING. */
export function enterResult(snap: Snapshot, env: FlowEnv, a: ResultArgs): StepResult {
  const next: Snapshot = { ...snap, state: 'RESULT', failures: 0, simulationId: a.simulationId };
  const replies: Reply[] = [
    ...a.messages.map(text),
    text(a.brokerAlreadyNotified ? T.brokerUpdated : T.brokerInformed),
    ...questionFor('RESULT', next, env),
  ];
  return { snapshot: record(next, { messageId: snap.lastInboundId ?? '', input: null, at: a.at }, replies), replies, effects: [] };
}

/** Não foi possível simular (sem unidade, dados incompletos): oferece o corretor, sem dado nenhum inventado. */
export function failSimulation(snap: Snapshot, at: string): StepResult {
  const replies = [text(T.simulationFailed)];
  const next: Snapshot = { ...snap, state: 'HANDOFF', failures: 0 };
  return {
    snapshot: record(next, { messageId: snap.lastInboundId ?? '', input: null, at }, replies),
    replies,
    effects: [{ type: 'handoff' }, { type: 'lead_status', status: 'HANDOFF' }, { type: 'audit', action: 'handoff_requested' }],
  };
}
