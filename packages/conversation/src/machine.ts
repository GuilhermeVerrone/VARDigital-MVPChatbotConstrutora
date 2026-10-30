import { interpretReply, type FieldDef, type FieldValue, type InterpretDeps, type Interpretation } from '@mvp/llm';
import {
  correctionOptions, fieldsFor, isAnswerState, resolveCorrectionTarget, STEPS, summaryLines, type AnswerState,
} from './steps';
import { T } from './templates';
import type { Collected, Effect, FlowEnv, QuestionState, Reply, Snapshot, StateName, StepResult } from './types';

export const MAX_FAILURES = 3;
const MAX_HISTORY = 60;

export function initialSnapshot(): Snapshot {
  return { state: 'NAME', data: {}, returnTo: null, failures: 0, resumeTo: null, lastInboundId: null, outbox: [], history: [] };
}

const text = (t: string): Reply => ({ text: t });

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
    case 'DONE':
      return [text(T.doneAgain)];
    default:
      return isAnswerState(state) ? [STEPS[state].question(env, snap.data)] : [];
  }
}

function fieldsOf(state: QuestionState, env: FlowEnv): readonly FieldDef[] {
  switch (state) {
    case 'CONFIRM': return [{ key: 'confirmed', kind: 'boolean' }];
    case 'HANDOFF_OFFER': return [{ key: 'wantsHuman', kind: 'boolean' }];
    case 'CORRECTION_MENU': return [{ key: 'item', kind: 'option', options: correctionOptions() }];
    default: return fieldsFor(state, env);
  }
}

const questionText = (state: QuestionState, snap: Snapshot, env: FlowEnv): string =>
  questionFor(state, snap, env).map((r) => ('text' in r ? r.text : r.list.title)).join(' ');

/** Lê a resposta do lead para a etapa atual: comando → filtro → parser → LLM (fallback). */
export async function interpretStep(
  input: string,
  snap: Snapshot,
  env: FlowEnv,
  deps: InterpretDeps,
): Promise<Interpretation> {
  // Estados finais não interpretam nada (e não gastam LLM).
  if (snap.state === 'DONE' || snap.state === 'HANDOFF' || snap.state === 'OPTED_OUT' || snap.state === 'LGPD_PENDING') {
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
  const bot = replies.map((r) => ({ role: 'bot' as const, text: 'text' in r ? r.text : [r.list.title, ...r.list.options.map((o, i) => `${i + 1}. ${o}`)].join(' | '), at: meta.at }));
  const lead = meta.input ? [{ role: 'lead' as const, text: meta.input, at: meta.at }] : [];
  return { ...snap, lastInboundId: meta.messageId, outbox: replies, history: [...snap.history, ...lead, ...bot].slice(-MAX_HISTORY) };
}

/** Mensagem sem texto (áudio, imagem…): não avança, não conta como erro. */
export function handleNonText(snap: Snapshot, env: FlowEnv, meta: TurnMeta): StepResult {
  const state = snap.state;
  const replies = isAnswerState(state) || state === 'CONFIRM' || state === 'CORRECTION_MENU' || state === 'HANDOFF_OFFER'
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

  // Estados finais
  if (state === 'DONE') return done(snap, [text(T.doneAgain)]);
  if (state === 'HANDOFF' || state === 'OPTED_OUT' || state === 'LGPD_PENDING') return done(snap, []);

  const qs = state as QuestionState;
  const again = (lead: string | null, next: Snapshot = snap) => withLead(lead, questionFor(next.state, next, env)[0]!);
  const fail = (lead: string): StepResult => {
    const failures = snap.failures + 1;
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
          return done({ ...snap, state: 'LGPD_PENDING' }, [text(T.lgpd)], [{ type: 'audit', action: 'lgpd_request' }]);
        case 'exit':
          return done(snap, [text(T.paused)]);
        case 'back': {
          const prev = backTarget(snap, env);
          if (!prev) return done(snap, again(T.noPrevious));
          const next: Snapshot = { ...snap, state: prev, failures: 0, returnTo: returnPointOf(snap) };
          return done(next, again(T.wentBack, next));
        }
        case 'correct': {
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
      const hint = isAnswerState(qs) ? STEPS[qs].hint : 'Responda *sim* ou *não*.';
      return fail(T.reask(hint));
    }
    case 'answer':
      return answer(it.fields);
  }

  function jumpTo(target: AnswerState, returnTo: QuestionState | null): StepResult {
    if (!STEPS[target].answered(snap.data)) return done(snap, again(T.notYet));
    const next: Snapshot = { ...snap, state: target, failures: 0, returnTo, resumeTo: null };
    return done(next, again(T.wentBack, next));
  }

  function answer(values: Record<string, FieldValue | null>): StepResult {
    if (qs === 'CONFIRM') {
      if (values.confirmed === true) {
        return done({ ...snap, state: 'DONE', failures: 0 }, [text(T.done)], [{ type: 'collected' }]);
      }
      const next: Snapshot = { ...snap, state: 'CORRECTION_MENU', failures: 0, resumeTo: 'CONFIRM' };
      return done(next, questionFor('CORRECTION_MENU', next, env));
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

/** Para onde voltar depois de uma correção/voltar: a etapa atual (ou a confirmação). */
function returnPointOf(snap: Snapshot): QuestionState | null {
  const s = snap.state;
  if (s === 'CORRECTION_MENU' || s === 'HANDOFF_OFFER') return snap.resumeTo;
  return isAnswerState(s) || s === 'CONFIRM' ? (s as QuestionState) : null;
}

function backTarget(snap: Snapshot, env: FlowEnv): AnswerState | null {
  const s = snap.state;
  const from = s === 'CORRECTION_MENU' || s === 'HANDOFF_OFFER' ? snap.resumeTo : s;
  if (!from) return null;
  const path = pathUntil(from, snap.data, env);
  return path && path.length > 0 ? path[path.length - 1]! : null;
}

