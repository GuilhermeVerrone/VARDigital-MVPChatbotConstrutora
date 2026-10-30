import type { Db } from './client';

// Atribuição simples de corretor (round-robin, spec RF-38 sem escala/região/score): o que atendeu
// há mais tempo recebe o próximo lead. Quem nunca recebeu vem primeiro; empate resolve pelo nome.

export interface AssignedBroker {
  id: string;
  name: string;
  phone: string;
  /** true = o lead já tinha corretor (nada foi atribuído agora). */
  existing: boolean;
}

/**
 * Corretor do lead: reaproveita o já atribuído (ou o responsável do contato no CRM com o mesmo
 * telefone, RF-41); senão escolhe o próximo da roleta. Transacional com trava de linha, então dois
 * leads simultâneos não recebem o mesmo "próximo". Null se não houver corretor ativo.
 */
export async function assignBroker(db: Db, leadId: string, now: Date = new Date()): Promise<AssignedBroker | null> {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { broker: true } });
    if (lead.broker?.active) {
      return { id: lead.broker.id, name: lead.broker.name, phone: lead.broker.phone, existing: true };
    }

    // Lead já conhecido do CRM (mesmo telefone) com responsável ativo: vincula a ele.
    const contact = lead.phone
      ? await tx.crmContact.findUnique({ where: { phone: lead.phone }, include: { owner: true } })
      : null;
    let chosen = contact?.owner?.active ? contact.owner : null;
    const existing = chosen !== null;

    if (!chosen) {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM brokers WHERE active
         ORDER BY last_assigned_at ASC NULLS FIRST, name ASC, id ASC
         LIMIT 1
         FOR UPDATE`;
      if (!rows[0]) return null;
      chosen = await tx.broker.findUniqueOrThrow({ where: { id: rows[0].id } });
      await tx.broker.update({ where: { id: chosen.id }, data: { lastAssignedAt: now } });
    }

    await tx.lead.update({ where: { id: leadId }, data: { brokerId: chosen.id } });
    await tx.auditLog.create({
      data: { actor: 'bot', entity: 'lead', entityId: leadId, action: 'broker_assigned', after: { brokerId: chosen.id, via: existing ? 'crm_owner' : 'round_robin' } },
    });
    return { id: chosen.id, name: chosen.name, phone: chosen.phone, existing };
  });
}
