import { createHmac } from 'node:crypto';
import type { ChannelAdapter, InboundMessage } from '@mvp/channel';
import {
  applyInterpretation, CONSENT_TEXT_VERSION, handleNonText, initialSnapshot, interpretStep, questionFor, T, withResume,
  type Collected, type Effect, type FlowEnv, type Reply, type Snapshot, type StepResult,
} from '@mvp/conversation';
import {
  deleteSession, listActiveTypologies, loadChat, saveSession, saveTurn, startConversation, todayIso,
  type ChatIdentity, type Db, type LoadedChat, type TurnWrites,
} from '@mvp/db';
import type { InterpretDeps } from '@mvp/llm';
import { parseCommand, parseYesNo } from '@mvp/parsers';

export interface OrchestratorOptions {
  db: Db;
  channel: ChannelAdapter;
  /** HMAC da conversa antes do consentimento (nenhum telefone legível em chat_sessions). */
  hashSecret: string;
  llm?: InterpretDeps;
  now?: () => Date;
  /** Sem consulta ao LLM/espera: testes. */
  sleep?: (ms: number) => Promise<void>;
  maxTypingMs?: number;
  /** Depois deste tempo sem falar, a retomada vem com "Que bom te ver de novo". */
  resumeGapMs?: number;
  /** Depois deste tempo a conversa expira e o lead precisa consentir de novo (RF-08: 7 dias). */
  retentionMs?: number;
  /** Chamado quando a coleta termina e é confirmada (Fase 6 liga o motor aqui). */
  onCollected?: (args: { leadId: string; conversationId: string; data: Collected }) => Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_CONSENT_ATTEMPTS = 3;
const TERMINAL = new Set(['HANDOFF', 'OPTED_OUT', 'LGPD_PENDING']);

type ConversationChat = Extract<LoadedChat, { kind: 'conversation' }>;

function restore(chat: ConversationChat): Snapshot {
  const ctx = chat.context as Partial<Snapshot> | null;
  if (!ctx || typeof ctx !== 'object' || typeof chat.state !== 'string') {
    throw new Error(`contexto da conversa ${chat.conversationId} inválido`);
  }
  return {
    ...initialSnapshot(),
    ...ctx,
    state: chat.state as Snapshot['state'],
    history: Array.isArray(chat.history) ? (chat.history as Snapshot['history']) : [],
  };
}

const persistable = (s: Snapshot) => {
  const { history, ...context } = s;
  return { context: context as object, history: history as object[] };
};

/** Última atividade da conversa: a data da última mensagem registrada (cai para updatedAt). */
function lastActivity(snap: Snapshot, fallback: Date): number {
  const at = snap.history[snap.history.length - 1]?.at;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : fallback.getTime();
}

const phoneOf = (msg: InboundMessage): string | null => msg.phone;

function toWrites(effects: Effect[], data: Collected): TurnWrites {
  const w: TurnWrites = {};
  for (const e of effects) {
    if (e.type === 'set_lead') w.lead = { ...w.lead, ...e.fields };
    else if (e.type === 'lead_status') w.status = e.status;
    else if (e.type === 'handoff') w.handoff = true;
    else if (e.type === 'audit') (w.audit ??= []).push(e.action);
    else if (e.type === 'collected') {
      w.profile = {
        income: data.income!, incomeType: data.incomeType as never, debts: data.debts ?? 0, downPayment: data.downPayment ?? 0,
        fgtsBalance: data.hasFgts ? (data.fgtsBalance ?? 0) : null, fgtsMonths: data.hasFgts ? (data.fgtsMonths ?? 0) : null,
        ownsProperty: data.ownsProperty ?? false, firstFinancing: data.firstFinancing ?? true,
        co: data.hasCoApplicant
          ? { income: data.coIncome!, incomeType: data.coIncomeType as never, birthDate: data.coBirthDate!, debts: data.coDebts ?? 0 }
          : null,
      };
    }
  }
  return w;
}

/**
 * Orquestrador da conversa (Fase 5): lê a mensagem, aplica a máquina de estados, persiste o estado
 * e só então responde. A ordem "gravar, depois enviar" torna a reentrega segura: se o processo cair
 * no meio, a mensagem volta e as respostas pendentes (`outbox`) são enviadas sem reaplicar a etapa.
 */
export function createOrchestrator(opts: OrchestratorOptions) {
  const { db, channel } = opts;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxTyping = opts.maxTypingMs ?? 2_000;
  const resumeGap = opts.resumeGapMs ?? 6 * 60 * 60 * 1000;
  const retention = opts.retentionMs ?? 7 * DAY;
  const bestEffort = (p: Promise<unknown>) => p.catch(() => undefined);

  let devCache: { at: number; value: Awaited<ReturnType<typeof listActiveTypologies>> } | null = null;
  async function development() {
    if (!devCache || Date.now() - devCache.at > 60_000) devCache = { at: Date.now(), value: await listActiveTypologies(db) };
    return devCache.value;
  }

  async function envFor(msg: InboundMessage): Promise<FlowEnv> {
    const dev = await development();
    return {
      today: todayIso(now()),
      developmentName: dev.developmentName,
      typologies: dev.typologies.map((t) => ({ id: t, label: t })),
      channelPhone: phoneOf(msg),
    };
  }

  const replyText = (r: Reply) => ('text' in r ? r.text : r.list.title);

  async function send(chatId: string, r: Reply): Promise<void> {
    await bestEffort(channel.setPresence(chatId, 'composing'));
    await sleep(Math.min(maxTyping, 400 + replyText(r).length * 20));
    if ('text' in r) await channel.sendText(chatId, r.text);
    else await channel.sendList(chatId, { title: r.list.title, options: r.list.options.map((title) => ({ title })), ...(r.list.footer ? { footer: r.list.footer } : {}) });
  }

  /** Envia as respostas em ordem; depois de cada uma grava o que ainda falta (outbox). */
  async function flush(chat: { conversationId: string; leadId: string }, snap: Snapshot, chatId: string): Promise<void> {
    let pending = snap.outbox;
    try {
      while (pending.length > 0) {
        await send(chatId, pending[0]!);
        pending = pending.slice(1);
        const next = { ...snap, outbox: pending };
        await saveTurn(db, { conversationId: chat.conversationId, leadId: chat.leadId, state: next.state, ...persistable(next) });
      }
    } finally {
      await bestEffort(channel.setPresence(chatId, 'paused'));
    }
  }

  // ---------- antes do consentimento ----------

  async function preConsent(msg: InboundMessage, who: ChatIdentity, loaded: LoadedChat, env: FlowEnv): Promise<void> {
    const say = async (t: string) => {
      await send(msg.chatId, { text: t });
      await bestEffort(channel.setPresence(msg.chatId, 'paused'));
    };
    const asked = loaded.kind === 'session' && loaded.state === 'CONSENT_ASKED';
    if (loaded.kind === 'session' && loaded.state === 'OPTED_OUT') return;

    const cmd = msg.type === 'text' && msg.text ? parseCommand(msg.text) : null;
    if (cmd?.command === 'optout') {
      await saveSession(db, who.chatHash, 'OPTED_OUT');
      return say(T.optout);
    }
    if (cmd?.command === 'lgpd_request') return say(T.nothingStored);

    if (!asked) {
      // Envia antes de gravar: se cair no meio, a reentrega cumprimenta de novo em vez de cobrar "sim/não".
      await say(T.greetingAndConsent(env.developmentName));
      return saveSession(db, who.chatHash, 'CONSENT_ASKED', 0);
    }
    if (msg.type !== 'text' || !msg.text) return say(`${T.textOnly}\n\n${T.consentReask}`);
    if (cmd?.command === 'human') return say(T.consentNeededForHuman);
    if (cmd?.command === 'exit') {
      await deleteSession(db, who.chatHash);
      return say(T.consentDeclined);
    }

    const answer = parseYesNo(msg.text);
    if (answer === false) {
      await deleteSession(db, who.chatHash);
      return say(T.consentDeclined);
    }
    if (answer === null) {
      const attempts = (loaded.kind === 'session' ? loaded.attempts : 0) + 1;
      if (attempts >= MAX_CONSENT_ATTEMPTS) {
        await deleteSession(db, who.chatHash);
        return say(T.consentDeclined);
      }
      await saveSession(db, who.chatHash, 'CONSENT_ASKED', attempts);
      return say(T.consentReask);
    }

    // Aceitou: a partir daqui há lead, consentimento versionado e conversa.
    const at = now();
    const base = initialSnapshot();
    const q = questionFor(base.state, base, env);
    const replies: Reply[] = [{ text: T.consentThanks }, ...q];
    const snap: Snapshot = {
      ...base,
      lastInboundId: msg.externalId,
      outbox: replies,
      history: replies.map((r) => ({ role: 'bot' as const, text: replyText(r), at: at.toISOString() })),
    };
    const ids = await startConversation(db, {
      ...who, textVersion: CONSENT_TEXT_VERSION, state: snap.state, at, ...persistable(snap),
    });
    await flush(ids, snap, msg.chatId);
  }

  // ---------- conversa em andamento ----------

  async function inConversation(msg: InboundMessage, chat: ConversationChat, env: FlowEnv): Promise<void> {
    const snap = restore(chat);

    // Reentrega: a etapa já foi aplicada; só termina de enviar o que faltou.
    if (snap.lastInboundId === msg.externalId) {
      await flush(chat, snap, msg.chatId);
      return;
    }

    // Passou da retenção: o lead precisa consentir de novo.
    if (!TERMINAL.has(snap.state) && now().getTime() - lastActivity(snap, chat.updatedAt) > retention) {
      const expired = { ...snap, lastInboundId: msg.externalId, outbox: [] as Reply[] };
      await saveTurn(db, { conversationId: chat.conversationId, leadId: chat.leadId, state: 'EXPIRED', ...persistable(expired) });
      await saveSession(db, hashOf(msg), 'CONSENT_ASKED', 0);
      await send(msg.chatId, { text: T.greetingAndConsent(env.developmentName) });
      await bestEffort(channel.setPresence(msg.chatId, 'paused'));
      return;
    }

    const meta = { messageId: msg.externalId, input: msg.type === 'text' ? msg.text : null, at: msg.receivedAt };
    let result: StepResult;
    if (msg.type !== 'text' || !msg.text) {
      result = handleNonText(snap, env, meta);
    } else {
      const it = await interpretStep(msg.text, snap, env, opts.llm ?? {});
      result = applyInterpretation(snap, it, env, meta);
      const gap = now().getTime() - lastActivity(snap, chat.updatedAt);
      const wasQuestion = !TERMINAL.has(snap.state) && snap.state !== 'DONE';
      if (gap > resumeGap && wasQuestion && it.kind !== 'command') result = withResume(result, env, snap);
    }

    await saveTurn(db, {
      conversationId: chat.conversationId, leadId: chat.leadId, state: result.snapshot.state,
      ...persistable(result.snapshot), writes: toWrites(result.effects, result.snapshot.data),
    });
    await flush(chat, result.snapshot, msg.chatId);

    if (result.effects.some((e) => e.type === 'collected')) {
      await opts.onCollected?.({ leadId: chat.leadId, conversationId: chat.conversationId, data: result.snapshot.data });
    }
  }

  const hashOf = (msg: InboundMessage) => createHmac('sha256', opts.hashSecret).update(msg.chatId).digest('hex');

  return async function handle(msg: InboundMessage): Promise<void> {
    const who: ChatIdentity = { chatHash: hashOf(msg), chatId: msg.chatId, phone: phoneOf(msg) };
    const [loaded, env] = await Promise.all([loadChat(db, who), envFor(msg)]);
    await bestEffort(channel.markRead(msg.chatId, [msg.externalId]));
    if (loaded.kind === 'conversation') return inConversation(msg, loaded, env);
    return preConsent(msg, who, loaded, env);
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
