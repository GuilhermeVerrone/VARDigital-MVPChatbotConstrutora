import type { Db } from './client';
import type { Prisma } from './generated/prisma/client';
import type { IncomeType, LeadStatus, ScoreClass } from './generated/prisma/enums';
import { enqueueJob, type EnqueueJobArgs } from './jobs';
import { dateFromIso } from './convert';

// Persistência da conversa (Fase 5). O estado da máquina (`context`) é opaco aqui: quem entende é
// o orquestrador. Antes do consentimento nada vai para `leads`/`conversations`: só `chat_sessions`,
// com hash da conversa (sem telefone legível).

export type SessionState = 'CONSENT_ASKED' | 'OPTED_OUT';

export type LoadedChat =
  | { kind: 'none' }
  | { kind: 'session'; state: SessionState; attempts: number }
  | {
      kind: 'conversation';
      leadId: string;
      conversationId: string;
      leadStatus: LeadStatus;
      state: string;
      context: unknown;
      history: unknown;
      handoff: boolean;
      updatedAt: Date;
    };

export interface ChatIdentity {
  /** HMAC do endereço da conversa (nunca o endereço em claro). */
  chatHash: string;
  chatId: string;
  /** E.164 só com dígitos, se o canal informou. */
  phone: string | null;
}

async function findLead(db: Pick<Db, 'lead'>, who: ChatIdentity) {
  return db.lead.findFirst({
    where: { OR: [{ channelJid: who.chatId }, ...(who.phone ? [{ phone: who.phone }] : [])] },
    orderBy: { createdAt: 'asc' },
  });
}

export async function loadChat(db: Db, who: ChatIdentity): Promise<LoadedChat> {
  const lead = await findLead(db, who);
  if (lead) {
    const conv = await db.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { startedAt: 'desc' } });
    // EXPIRED: passou da retenção e o lead precisa consentir de novo (nova conversa).
    if (conv && conv.state !== 'EXPIRED') {
      return {
        kind: 'conversation', leadId: lead.id, conversationId: conv.id, leadStatus: lead.status,
        state: conv.state, context: conv.context, history: conv.history, handoff: conv.handoff, updatedAt: conv.updatedAt,
      };
    }
  }
  const session = await db.chatSession.findUnique({ where: { chatHash: who.chatHash } });
  return session ? { kind: 'session', state: session.state as SessionState, attempts: session.attempts } : { kind: 'none' };
}

export async function saveSession(db: Db, chatHash: string, state: SessionState, attempts = 0): Promise<void> {
  await db.chatSession.upsert({ where: { chatHash }, create: { chatHash, state, attempts }, update: { state, attempts } });
}

export async function deleteSession(db: Db, chatHash: string): Promise<void> {
  await db.chatSession.deleteMany({ where: { chatHash } });
}

export interface StartConversationArgs extends ChatIdentity {
  textVersion: string;
  state: string;
  context: Prisma.InputJsonValue;
  history: Prisma.InputJsonValue;
  at: Date;
}

/**
 * Consentimento aceito: cria (ou reaproveita) o lead, registra o consentimento versionado e abre
 * a conversa, tudo numa transação; apaga a sessão pré-consentimento.
 */
export async function startConversation(db: Db, a: StartConversationArgs): Promise<{ leadId: string; conversationId: string }> {
  return db.$transaction(async (tx) => {
    let lead = await findLead(tx, a);
    if (lead) {
      lead = await tx.lead.update({ where: { id: lead.id }, data: { channelJid: a.chatId, status: 'IN_PROGRESS' } });
    } else {
      lead = await tx.lead.create({ data: { channelJid: a.chatId, phone: a.phone, status: 'IN_PROGRESS' } });
    }
    await tx.consent.create({ data: { leadId: lead.id, textVersion: a.textVersion, channel: 'WHATSAPP', acceptedAt: a.at } });
    const conv = await tx.conversation.create({
      data: { leadId: lead.id, channel: 'WHATSAPP', state: a.state, context: a.context, history: a.history },
    });
    await tx.chatSession.deleteMany({ where: { chatHash: a.chatHash } });
    return { leadId: lead.id, conversationId: conv.id };
  });
}

export interface ProfileInput {
  income: number;
  incomeType: IncomeType;
  debts: number;
  downPayment: number;
  fgtsBalance: number | null;
  fgtsMonths: number | null;
  ownsProperty: boolean;
  firstFinancing: boolean;
  co: { income: number; incomeType: IncomeType; birthDate: string; debts: number } | null;
}

export interface TurnWrites {
  lead?: { name?: string; phone?: string; email?: string | null; birthDate?: string };
  status?: LeadStatus;
  handoff?: boolean;
  audit?: string[];
  profile?: ProfileInput;
  /** Classe do lead pelo parecer da simulação (Fase 6). */
  scoreClass?: ScoreClass;
  /** Entregas (CRM, corretor) gravadas na mesma transação do estado: sem "estado novo, entrega perdida". */
  jobs?: EnqueueJobArgs[];
}

export interface SaveTurnArgs {
  conversationId: string;
  leadId: string;
  state: string;
  context: Prisma.InputJsonValue;
  history: Prisma.InputJsonValue;
  writes?: TurnWrites;
}

/** Grava o estado da conversa e os efeitos da etapa de forma atômica (RF-11: persistência por etapa). */
export async function saveTurn(db: Db, a: SaveTurnArgs): Promise<void> {
  const w = a.writes ?? {};
  await db.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: a.conversationId },
      data: { state: a.state, context: a.context, history: a.history, ...(w.handoff ? { handoff: true } : {}) },
    });
    const leadData: Prisma.LeadUpdateInput = {};
    if (w.lead?.name !== undefined) leadData.name = w.lead.name;
    if (w.lead?.email !== undefined) leadData.email = w.lead.email;
    if (w.lead?.birthDate !== undefined) leadData.birthDate = dateFromIso(w.lead.birthDate);
    if (w.lead?.phone !== undefined) {
      // phone é único (RF-41): se já é de outro lead, não sobrescreve (a deduplicação é da Fase 6).
      const owner = await tx.lead.findUnique({ where: { phone: w.lead.phone } });
      if (!owner || owner.id === a.leadId) leadData.phone = w.lead.phone;
    }
    if (w.status) leadData.status = w.status;
    if (w.scoreClass) leadData.scoreClass = w.scoreClass;
    if (Object.keys(leadData).length > 0) await tx.lead.update({ where: { id: a.leadId }, data: leadData });

    for (const job of w.jobs ?? []) await enqueueJob(tx, job);

    for (const action of w.audit ?? []) {
      await tx.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: a.leadId, action } });
    }
    if (w.profile) {
      const p = w.profile;
      const row = {
        grossMonthlyIncome: p.income, incomeType: p.incomeType, monthlyDebts: p.debts, availableDownPayment: p.downPayment,
        fgtsBalance: p.fgtsBalance, fgtsContributionMonths: p.fgtsMonths, ownsResidentialProperty: p.ownsProperty,
        firstFinancing: p.firstFinancing,
        coApplicantIncome: p.co?.income ?? null, coApplicantIncomeType: p.co?.incomeType ?? null,
        coApplicantBirthDate: p.co ? dateFromIso(p.co.birthDate) : null, coApplicantMonthlyDebts: p.co?.debts ?? null,
      };
      await tx.financialProfile.upsert({ where: { leadId: a.leadId }, create: { leadId: a.leadId, ...row }, update: row });
    }
  });
}

/** Typologies disponíveis do empreendimento ativo (base das opções de interesse). */
export async function listActiveTypologies(db: Db): Promise<{ developmentName: string; typologies: string[] }> {
  const dev = await db.development.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    include: { units: { where: { status: 'AVAILABLE' }, select: { typology: true } } },
  });
  if (!dev) throw new Error('nenhum empreendimento ativo cadastrado (rode o seed)');
  return { developmentName: dev.name, typologies: [...new Set(dev.units.map((u) => u.typology))].sort() };
}
