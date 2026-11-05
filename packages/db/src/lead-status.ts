import type { Db, DbTx } from './client';
import type { LeadStatus } from './generated/prisma/enums';

// Histórico de status do lead: cada mudança vira um evento `status_changed` na auditoria (quem, de
// qual status, para qual, quando). Mudar para o mesmo status não grava nada.

export const LEAD_ENTITY = 'lead';
export const STATUS_CHANGED = 'status_changed';

/** Grava a mudança de status (chamar ANTES de atualizar o lead, dentro da mesma transação). */
export async function recordStatusChange(tx: Db | DbTx, leadId: string, to: LeadStatus, actor: string, at?: Date): Promise<boolean> {
  const current = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
  if (!current || current.status === to) return false;
  await tx.auditLog.create({
    data: { actor, entity: LEAD_ENTITY, entityId: leadId, action: STATUS_CHANGED, before: { status: current.status }, after: { status: to }, ...(at ? { at } : {}) },
  });
  return true;
}
