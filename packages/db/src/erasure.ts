import type { Db } from './client';

// Exclusão de dados do titular (LGPD, RF-10) e retenção. Apaga o lead e tudo que depende dele, mais o
// que não tem chave para o lead (contato no CRM simulado, fila de entrada, sessão pré-consentimento),
// e deixa UM registro mínimo na auditoria: o id (sorteado, sem ligação com a pessoa depois da
// exclusão), o motivo, quando e o que havia (só contagens e as versões de consentimento).

export type ErasureReason = 'titular' | 'retencao';

export interface ErasureSummary {
  leadId: string;
  /** Endereço do chat a limpar no canal (WA-AKG), se havia um. */
  chatId: string | null;
  counts: { conversations: number; simulations: number; messages: number; crmContacts: number };
}

export interface EraseOptions {
  reason: ErasureReason;
  /** Quem pediu ("bot" para o titular, "retention" para a rotina). */
  actor?: string;
  now?: Date;
  /** Hash da conversa (sessão pré-consentimento), se o chamador souber calcular. */
  chatHash?: string;
}

/** Apaga o lead. Devolve null se ele não existe mais (a exclusão é idempotente). */
export async function eraseLead(db: Db, leadId: string, opts: EraseOptions): Promise<ErasureSummary | null> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      include: { consents: true, conversations: { select: { context: true } }, _count: { select: { simulations: true } } },
    });
    if (!lead) return null;

    // O telefone pode estar na coluna ou só na conversa (quando outro lead já ficou com ele).
    const phones = new Set<string>();
    if (lead.phone) phones.add(lead.phone);
    for (const c of lead.conversations) {
      const p = (c.context as { data?: { phone?: unknown } } | null)?.data?.phone;
      if (typeof p === 'string') phones.add(p);
    }

    const chatKeys = lead.channelJid ? [lead.channelJid] : [];
    const messages = await tx.processedMessage.deleteMany({
      where: { OR: [{ leadId }, ...(chatKeys.length ? [{ chatKey: { in: chatKeys } }] : [])] },
    });
    const crm = phones.size ? await tx.crmContact.deleteMany({ where: { phone: { in: [...phones] } } }) : { count: 0 };
    if (opts.chatHash) await tx.chatSession.deleteMany({ where: { chatHash: opts.chatHash } });

    const counts = { conversations: lead.conversations.length, simulations: lead._count.simulations, messages: messages.count, crmContacts: crm.count };
    await tx.lead.delete({ where: { id: leadId } }); // consentimentos, conversas, perfil, simulações e entregas vão em cascata

    if (lead.channelJid) await tx.erasureTask.create({ data: { chatId: lead.channelJid, reason: opts.reason, requestedAt: now } });
    await tx.auditLog.create({
      data: {
        actor: opts.actor ?? 'bot',
        entity: 'lead',
        entityId: leadId,
        action: opts.reason === 'titular' ? 'erased_by_request' : 'erased_by_retention',
        after: {
          counts,
          consents: lead.consents.map((c) => ({ textVersion: c.textVersion, acceptedAt: c.acceptedAt.toISOString(), revokedAt: c.revokedAt?.toISOString() ?? null })),
          channelCleanup: lead.channelJid ? 'pending' : 'not_needed',
        },
        reason: opts.reason,
        at: now,
      },
    });
    return { leadId, chatId: lead.channelJid, counts };
  });
}

export interface RetentionOptions {
  /** Leads sem nenhuma atividade desde esta data são apagados. */
  inactiveSince: Date;
  now?: Date;
  limit?: number;
}

/** Retenção: apaga leads inativos e limpa o que sobra de antes do consentimento. */
export async function purgeInactive(db: Db, opts: RetentionOptions): Promise<{ leads: number; sessions: number; messages: number }> {
  const cutoff = opts.inactiveSince;
  const stale = await db.lead.findMany({
    where: { updatedAt: { lt: cutoff }, conversations: { none: { updatedAt: { gte: cutoff } } }, simulations: { none: { generatedAt: { gte: cutoff } } } },
    select: { id: true },
    take: opts.limit ?? 200,
  });
  let leads = 0;
  for (const { id } of stale) {
    if (await eraseLead(db, id, { reason: 'retencao', actor: 'retention', ...(opts.now ? { now: opts.now } : {}) })) leads++;
  }
  // Quem não respondeu ao consentimento não deixa nada além do hash; some junto com o resto.
  // OPTED_OUT é mantido: é o que garante o silêncio de quem pediu para parar.
  const sessions = await db.chatSession.deleteMany({ where: { state: 'CONSENT_ASKED', updatedAt: { lt: cutoff } } });
  const messages = await db.processedMessage.deleteMany({ where: { status: { in: ['DONE', 'DEAD'] }, receivedAt: { lt: cutoff } } });
  return { leads, sessions: sessions.count, messages: messages.count };
}

export interface PendingErasure {
  id: string;
  chatId: string;
}

/** Limpezas do canal ainda por fazer (lidas por `infra/scripts/wa-akg-erase.sh`). */
export async function listPendingErasures(db: Db): Promise<PendingErasure[]> {
  const rows = await db.erasureTask.findMany({ where: { doneAt: null, chatId: { not: null } }, orderBy: { requestedAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, chatId: r.chatId! }));
}

/** Marca a limpeza do canal como feita e some com o endereço do chat. */
export async function markErasureDone(db: Db, id: string, now: Date = new Date()): Promise<void> {
  await db.erasureTask.update({ where: { id }, data: { doneAt: now, chatId: null } });
}
