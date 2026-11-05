import { ChannelError, type ChannelAdapter } from '@mvp/channel';
import { firstContactText } from '@mvp/conversation';
import { getPublishedFlowConfig, type Db, type DeliveryJobItem } from '@mvp/db';
import { DeferJobError, PermanentJobError } from './lib/job-errors';
import { isWithinWindow, nextWindowOpening, type BusinessWindow } from './lib/business-hours';

// 1º contato do lead do formulário do site (Fase 13). O site só enfileira o job; quem manda a mensagem
// é este handler, que respeita: a lista de permitidos do piloto, a janela de horário comercial, o limite
// por hora e o consentimento. Fora da janela ou do limite o job espera (não é falha); com o WhatsApp
// fora do ar ele é reenviado até o lead "vencer" (24 h), depois não faz mais sentido escrever.

export interface FirstContactOptions {
  window: BusinessWindow;
  /** Máximo de 1º contatos enviados por hora (0 = sem limite). */
  maxPerHour: number;
  /** Lista de permitidos do piloto: fora dela, o envio é recusado. */
  isAllowed(phone: string): boolean;
  /** Espera entre tentativas quando o WhatsApp está fora do ar. */
  retryMs?: number;
  /** Idade máxima do pedido do formulário para ainda mandar o 1º contato. */
  maxAgeMs?: number;
  now?: () => Date;
}

const HOUR = 60 * 60 * 1000;

export function createFirstContact(deps: { db: Db; channel: ChannelAdapter }, opts: FirstContactOptions) {
  const { db, channel } = deps;
  const now = opts.now ?? (() => new Date());
  const retryMs = opts.retryMs ?? 60_000;
  const maxAgeMs = opts.maxAgeMs ?? 24 * HOUR;

  async function skip(leadId: string, reason: string): Promise<void> {
    await db.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: leadId, action: 'first_contact_skipped', after: { reason } } });
  }

  return async function handle(job: DeliveryJobItem): Promise<void> {
    if (!job.leadId) throw new PermanentJobError('job sem lead');
    const payload = (job.payload ?? {}) as { sent?: boolean };
    if (payload.sent) return;

    const lead = await db.lead.findUnique({
      where: { id: job.leadId },
      include: { consents: { where: { revokedAt: null }, select: { id: true } }, conversations: { select: { id: true }, take: 1 }, development: { select: { name: true } } },
    });
    if (!lead) throw new PermanentJobError('lead não existe mais (dados apagados)');
    if (!lead.phone) throw new PermanentJobError('lead sem telefone');

    // Quem já respondeu, parou, recusou ou revogou o consentimento não recebe o 1º contato.
    if (lead.conversations.length > 0) return skip(lead.id, 'lead já conversou');
    if (lead.status === 'OPTED_OUT' || lead.status === 'CLOSED') return skip(lead.id, `lead ${lead.status}`);
    if (lead.consents.length === 0) return skip(lead.id, 'sem consentimento válido');

    if (!opts.isAllowed(lead.phone)) throw new PermanentJobError('número fora da lista de permitidos do piloto');

    const at = now();
    if (at.getTime() - (lead.formSubmittedAt ?? lead.createdAt).getTime() > maxAgeMs) {
      await skip(lead.id, 'pedido expirado');
      throw new PermanentJobError('pedido do formulário com mais de 24 h sem envio');
    }
    if (!isWithinWindow(at, opts.window)) throw new DeferJobError(nextWindowOpening(at, opts.window), 'fora do horário comercial');

    if (opts.maxPerHour > 0) {
      const recent = await db.deliveryJob.findMany({
        where: { kind: 'FIRST_CONTACT', status: 'DONE', processedAt: { gt: new Date(at.getTime() - HOUR) } },
        select: { processedAt: true },
        orderBy: { processedAt: 'asc' },
      });
      if (recent.length >= opts.maxPerHour) {
        // O próximo cabe quando o envio mais antigo da fila sair da janela de 1 h.
        const slot = recent[recent.length - opts.maxPerHour]!.processedAt!;
        throw new DeferJobError(new Date(slot.getTime() + HOUR + 1000), 'limite de 1º contatos por hora');
      }
    }

    const published = await getPublishedFlowConfig(db);
    const text = firstContactText(
      { flow: { firstContact: published?.content.firstContact ?? null } },
      { nome: (lead.name ?? '').trim().split(/\s+/)[0] || 'tudo bem', empreendimento: lead.development?.name ?? 'empreendimento' },
    );
    try {
      await channel.sendText(`${lead.phone}@s.whatsapp.net`, text);
    } catch (err) {
      // WhatsApp (WA-AKG) fora do ar: tenta de novo daqui a pouco, sem gastar as tentativas do job.
      if (err instanceof ChannelError && err.retryable) throw new DeferJobError(new Date(at.getTime() + retryMs), 'canal indisponível');
      throw err;
    }
    // Marca antes de concluir: se a conclusão falhar, a nova tentativa não manda a mensagem de novo.
    await db.deliveryJob.update({ where: { id: job.id }, data: { payload: { ...payload, sent: true } } });
    await db.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: lead.id, action: 'first_contact_sent' } });
  };
}
