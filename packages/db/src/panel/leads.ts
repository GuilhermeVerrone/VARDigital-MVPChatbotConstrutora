import type { Db } from '../client';
import type { Prisma } from '../generated/prisma/client';
import type { LeadSource, LeadStatus, PaymentMode, ScoreClass, Verdict } from '../generated/prisma/enums';
import { LEAD_ENTITY, recordStatusChange } from '../lead-status';
import { resolveActorNames } from './audit';
import { PanelNotFoundError, PanelValidationError, requireActor } from './errors';

// Leads no painel (Fase 15): lista com filtros, detalhe, atribuição de corretor e assumir/devolver o
// handoff. Toda leitura e toda escrita passam pelo ESCOPO: o corretor só enxerga e mexe nos leads
// dele (brokerId do usuário); gestão e admin enxergam todos. Lead fora do escopo é "não encontrado",
// sem revelar que existe.

/** Quem pode ver: `undefined` = todos; `{ brokerId }` = só os leads daquele corretor (null = nenhum). */
export type LeadScope = { brokerId: string | null } | undefined;

/** Parecer do lead = o da última simulação. O `scoreClass` do lead guarda exatamente isso (1:1). */
const CLASS_OF: Record<Verdict, ScoreClass> = { VIAVEL: 'HOT', VIAVEL_COM_AJUSTES: 'WARM', INVIAVEL: 'COLD' };
const VERDICT_OF: Record<ScoreClass, Verdict> = { HOT: 'VIAVEL', WARM: 'VIAVEL_COM_AJUSTES', COLD: 'INVIAVEL' };
export const verdictOfClass = (c: ScoreClass | null): Verdict | null => (c ? VERDICT_OF[c] : null);

const NOBODY = '00000000-0000-0000-0000-000000000000';

function scopeWhere(scope: LeadScope): Prisma.LeadWhereInput {
  if (!scope) return {};
  return { brokerId: scope.brokerId ?? NOBODY };
}

export interface LeadFilter {
  developmentId?: string;
  mode?: PaymentMode;
  verdict?: Verdict;
  status?: LeadStatus;
  /** id do corretor, ou 'none' para leads sem corretor. */
  brokerId?: string;
  source?: LeadSource;
  /** Busca por nome, telefone ou código ELV-xxxx. */
  q?: string;
  page?: number;
}

export const LEADS_PAGE_SIZE = 25;

export interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  development: string | null;
  mode: PaymentMode | null;
  verdict: Verdict | null;
  status: LeadStatus;
  broker: { id: string; name: string } | null;
  source: LeadSource;
  createdAt: Date;
  /** Conversa esperando (ou nas mãos de) um corretor. */
  handoff: 'WAITING' | 'TAKEN' | null;
}

export function leadWhere(f: LeadFilter, scope: LeadScope): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [scopeWhere(scope)];
  if (f.developmentId) and.push({ developmentId: f.developmentId });
  if (f.mode) and.push({ paymentMode: f.mode });
  if (f.verdict) and.push({ scoreClass: CLASS_OF[f.verdict] });
  if (f.status) and.push({ status: f.status });
  if (f.source) and.push({ source: f.source });
  if (f.brokerId) and.push(f.brokerId === 'none' ? { brokerId: null } : { brokerId: f.brokerId });
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { contactCode: { contains: q.toUpperCase() } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  return { AND: and };
}

export async function listPanelLeads(db: Db, f: LeadFilter = {}, scope?: LeadScope): Promise<{ rows: LeadRow[]; total: number; page: number; pages: number }> {
  const where = leadWhere(f, scope);
  const total = await db.lead.count({ where });
  const pages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(f.page ?? 1)), pages);
  const found = await db.lead.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * LEADS_PAGE_SIZE,
    take: LEADS_PAGE_SIZE,
    include: {
      broker: { select: { id: true, name: true } },
      development: { select: { name: true } },
      conversations: { where: { handoff: true }, select: { takenByBrokerId: true }, take: 1 },
    },
  });
  const rows: LeadRow[] = found.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    development: l.development?.name ?? null,
    mode: l.paymentMode,
    verdict: verdictOfClass(l.scoreClass),
    status: l.status,
    broker: l.broker,
    source: l.source,
    createdAt: l.createdAt,
    handoff: l.conversations[0] ? (l.conversations[0].takenByBrokerId ? 'TAKEN' : 'WAITING') : null,
  }));
  return { rows, total, page, pages };
}

export interface TimelineEvent {
  at: Date;
  kind: 'status' | 'event';
  action: string;
  actor: string;
  actorName: string;
  before: unknown;
  after: unknown;
}

export interface LeadHistoryEntry {
  role: 'lead' | 'bot';
  text: string;
  at: string;
}

export interface LeadDetail {
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    contactCode: string | null;
    source: LeadSource;
    utm: unknown;
    status: LeadStatus;
    mode: PaymentMode | null;
    verdict: Verdict | null;
    createdAt: Date;
    formSubmittedAt: Date | null;
    contactConfirmedAt: Date | null;
    development: { id: string; name: string } | null;
    broker: { id: string; name: string; active: boolean } | null;
  };
  consents: { id: string; textVersion: string; channel: string; textSnapshot: string | null; acceptedAt: Date; revokedAt: Date | null }[];
  conversation: {
    id: string;
    state: string;
    startedAt: Date;
    handoff: { code: string | null; since: Date | null; takenBy: { id: string; name: string } | null; takenAt: Date | null } | null;
    history: LeadHistoryEntry[];
    /** Dados coletados na conversa (campos que o bot guarda no contexto). */
    collected: Record<string, unknown>;
    /** Contexto cru da máquina de estados (a Fase 15 só devolve; o painel decide o que mostra). */
    context: unknown;
  } | null;
  profile: { income: number; incomeType: string; debts: number; cashNow: number | null; acceptsBalloons: boolean | null } | null;
  simulations: {
    id: string;
    generatedAt: Date;
    mode: PaymentMode | null;
    verdict: Verdict;
    unit: { code: string; typology: string; development: string } | null;
    propertyValue: number;
    conditionVersion: string | null;
    parametersVersion: string | null;
    plan: unknown;
    bankEstimate: unknown;
    result: unknown;
    input: unknown;
  }[];
  timeline: TimelineEvent[];
}

/** O lead do escopo ou `PanelNotFoundError`. */
export async function requireLeadInScope(db: Pick<Db, 'lead'>, id: string, scope: LeadScope): Promise<{ id: string; brokerId: string | null; status: LeadStatus }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lead = uuid.test(id) ? await db.lead.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: { id: true, brokerId: true, status: true } }) : null;
  if (!lead) throw new PanelNotFoundError('lead');
  return lead;
}

const num = (d: { toNumber(): number }) => d.toNumber();

export async function getPanelLead(db: Db, id: string, scope?: LeadScope): Promise<LeadDetail> {
  await requireLeadInScope(db, id, scope);
  const l = await db.lead.findUniqueOrThrow({
    where: { id },
    include: {
      broker: { select: { id: true, name: true, active: true } },
      development: { select: { id: true, name: true } },
      consents: { orderBy: { acceptedAt: 'asc' } },
      financialProfile: true,
      conversations: { orderBy: { startedAt: 'desc' }, take: 1, include: { takenBy: { select: { id: true, name: true } } } },
      simulations: {
        orderBy: { generatedAt: 'desc' },
        include: { unit: { include: { development: { select: { name: true } } } }, salesCondition: { select: { version: true } } },
      },
    },
  });
  const audit = await db.auditLog.findMany({ where: { entity: LEAD_ENTITY, entityId: id }, orderBy: { id: 'asc' } });
  const names = await resolveActorNames(db, audit.map((a) => a.actor));
  const conv = l.conversations[0];
  const ctx = (conv?.context ?? {}) as { data?: Record<string, unknown> };
  const history = (Array.isArray(conv?.history) ? conv!.history : []) as unknown as LeadHistoryEntry[];
  const fp = l.financialProfile;

  return {
    lead: {
      id: l.id, name: l.name, phone: l.phone, email: l.email, contactCode: l.contactCode, source: l.source, utm: l.utm, status: l.status,
      mode: l.paymentMode, verdict: verdictOfClass(l.scoreClass), createdAt: l.createdAt, formSubmittedAt: l.formSubmittedAt,
      contactConfirmedAt: l.contactConfirmedAt, development: l.development, broker: l.broker,
    },
    consents: l.consents.map((c) => ({ id: c.id, textVersion: c.textVersion, channel: c.channel, textSnapshot: c.textSnapshot, acceptedAt: c.acceptedAt, revokedAt: c.revokedAt })),
    conversation: conv
      ? {
          id: conv.id, state: conv.state, startedAt: conv.startedAt,
          handoff: conv.handoff ? { code: conv.handoffCode, since: conv.handoffAt, takenBy: conv.takenBy, takenAt: conv.takenAt } : null,
          history, collected: ctx.data ?? {}, context: conv.context,
        }
      : null,
    profile: fp
      ? { income: num(fp.grossMonthlyIncome), incomeType: fp.incomeType, debts: num(fp.monthlyDebts), cashNow: fp.cashNow ? num(fp.cashNow) : null, acceptsBalloons: fp.acceptsBalloons }
      : null,
    simulations: l.simulations.map((s) => ({
      id: s.id, generatedAt: s.generatedAt, mode: s.paymentMode, verdict: s.verdict,
      unit: s.unit ? { code: s.unit.code, typology: s.unit.typology, development: s.unit.development.name } : null,
      propertyValue: num(s.propertyValue), conditionVersion: s.salesCondition?.version ?? null, parametersVersion: s.parametersVersion,
      plan: s.downPaymentPlan, bankEstimate: s.bankEstimate, result: s.result, input: s.input,
    })),
    timeline: audit.map((a) => ({
      at: a.at, kind: a.action === 'status_changed' ? 'status' : 'event', action: a.action, actor: a.actor, actorName: names.get(a.actor) ?? a.actor, before: a.before, after: a.after,
    })),
  };
}

// -- Escritas -------------------------------------------------------------------------------------

/** Atribui ou troca o corretor. `brokerId = null` tira o corretor. Só corretor ativo recebe lead. */
export async function assignLeadBroker(db: Db, a: { actor: string; leadId: string; brokerId: string | null; scope?: LeadScope; now?: Date }) {
  requireActor(a.actor);
  return db.$transaction(async (tx) => {
    const lead = await requireLeadInScope(tx, a.leadId, a.scope);
    if (lead.brokerId === a.brokerId) return { changed: false };
    let target: { id: string; name: string } | null = null;
    if (a.brokerId) {
      const b = await tx.broker.findUnique({ where: { id: a.brokerId } });
      if (!b) throw new PanelNotFoundError('corretor');
      if (!b.active) throw new PanelValidationError({ brokerId: 'Corretor inativo não recebe leads' });
      target = { id: b.id, name: b.name };
    }
    const before = lead.brokerId ? await tx.broker.findUnique({ where: { id: lead.brokerId }, select: { id: true, name: true } }) : null;
    await tx.lead.update({ where: { id: a.leadId }, data: { brokerId: a.brokerId } });
    if (target) await tx.broker.update({ where: { id: target.id }, data: { lastAssignedAt: a.now ?? new Date() } });
    await tx.auditLog.create({
      data: {
        actor: a.actor, entity: LEAD_ENTITY, entityId: a.leadId, action: 'broker_assigned',
        before: { brokerId: before?.id ?? null, broker: before?.name ?? null }, after: { brokerId: target?.id ?? null, broker: target?.name ?? null, via: 'panel' },
      },
    });
    return { changed: true };
  });
}

export type PanelHandoffResult = { ok: true; alreadyYours?: boolean } | { ok: false; reason: 'no_handoff' | 'taken_by_other' | 'not_taken' };

/** Conversa do lead em handoff (esperando ou assumida). */
async function handoffConversation(tx: Pick<Db, 'conversation'>, leadId: string) {
  return tx.conversation.findFirst({ where: { leadId, handoff: true, state: 'HANDOFF', handoffCode: { not: null } }, orderBy: { startedAt: 'desc' } });
}

/** O corretor assume o atendimento pelo painel: o bot continua calado e o lead passa a ser dele. */
export async function takeLeadHandoff(db: Db, a: { actor: string; leadId: string; brokerId: string; scope?: LeadScope; now?: Date }): Promise<PanelHandoffResult> {
  requireActor(a.actor);
  return db.$transaction(async (tx) => {
    await requireLeadInScope(tx, a.leadId, a.scope);
    const conv = await handoffConversation(tx, a.leadId);
    if (!conv) return { ok: false, reason: 'no_handoff' };
    if (conv.takenByBrokerId === a.brokerId) return { ok: true, alreadyYours: true };
    if (conv.takenByBrokerId) return { ok: false, reason: 'taken_by_other' };
    await tx.conversation.update({ where: { id: conv.id }, data: { takenByBrokerId: a.brokerId, takenAt: a.now ?? new Date() } });
    await tx.lead.update({ where: { id: a.leadId }, data: { brokerId: a.brokerId } });
    await tx.auditLog.create({ data: { actor: a.actor, entity: LEAD_ENTITY, entityId: a.leadId, action: 'handoff_taken', after: { brokerId: a.brokerId, via: 'panel' }, ...(a.now ? { at: a.now } : {}) } });
    return { ok: true };
  });
}

export interface ReleasableLeadHandoff {
  conversationId: string;
  chatId: string | null;
  state: string;
  context: unknown;
  history: unknown;
  takenByBrokerId: string | null;
}

/** A conversa em handoff do lead, com o estado salvo (para o chamador calcular a retomada do bot). */
export async function findLeadHandoff(db: Db, leadId: string, scope?: LeadScope): Promise<ReleasableLeadHandoff | null> {
  await requireLeadInScope(db, leadId, scope);
  const conv = await db.conversation.findFirst({
    where: { leadId, handoff: true, state: 'HANDOFF', handoffCode: { not: null } },
    orderBy: { startedAt: 'desc' },
    include: { lead: { select: { channelJid: true } } },
  });
  return conv ? { conversationId: conv.id, chatId: conv.lead.channelJid, state: conv.state, context: conv.context, history: conv.history, takenByBrokerId: conv.takenByBrokerId } : null;
}

/**
 * Devolve a conversa ao bot. `brokerId` é quem devolve (o corretor que assumiu); a gestão pode
 * devolver a conversa de qualquer corretor (`force`). `state`/`context`/`history` vêm da retomada
 * calculada pela máquina de conversa; `flushAfter` enfileira o envio da próxima pergunta ao lead.
 */
export async function releaseLeadHandoff(
  db: Db,
  a: {
    actor: string; leadId: string; brokerId: string | null; force?: boolean; scope?: LeadScope; now?: Date;
    next: { state: string; context: Prisma.InputJsonValue; history: Prisma.InputJsonValue; leadStatus: LeadStatus };
    flush: boolean;
  },
): Promise<PanelHandoffResult> {
  requireActor(a.actor);
  const at = a.now ?? new Date();
  return db.$transaction(async (tx) => {
    await requireLeadInScope(tx, a.leadId, a.scope);
    const conv = await handoffConversation(tx, a.leadId);
    if (!conv) return { ok: false, reason: 'no_handoff' };
    if (!conv.takenByBrokerId && !a.force) return { ok: false, reason: 'not_taken' };
    if (conv.takenByBrokerId && conv.takenByBrokerId !== a.brokerId && !a.force) return { ok: false, reason: 'taken_by_other' };
    await recordStatusChange(tx, a.leadId, a.next.leadStatus, a.actor, at);
    await tx.conversation.update({
      where: { id: conv.id },
      data: { state: a.next.state, context: a.next.context, history: a.next.history, handoff: false, handoffCode: null, takenByBrokerId: null, takenAt: null },
    });
    await tx.lead.update({ where: { id: a.leadId }, data: { status: a.next.leadStatus } });
    await tx.auditLog.create({ data: { actor: a.actor, entity: LEAD_ENTITY, entityId: a.leadId, action: 'handoff_released', after: { brokerId: conv.takenByBrokerId, via: 'panel' }, at } });
    if (a.flush) {
      await tx.deliveryJob.create({
        data: { kind: 'OUTBOX_FLUSH', leadId: a.leadId, dedupeKey: `OUTBOX_FLUSH:${conv.id}:${at.getTime()}`, payload: {} },
      });
    }
    return { ok: true };
  });
}
