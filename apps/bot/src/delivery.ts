import type { ChannelAdapter } from '@mvp/channel';
import { ChannelError } from '@mvp/channel';
import { CrmError, type CrmAdapter } from '@mvp/crm';
import { assignBroker, loadSimulationBundle, markDelivered, scoreClassFor, setJobPayload, type Db, type DeliveryJobItem, type SimulationBundle } from '@mvp/db';
import {
  buildPaymentPdf, buildSimulationPdf, dossierCard, handoffCard, paymentDossierCard, pdfFileName, type HandoffHistoryEntry,
} from '@mvp/presentation';
import { toPaymentView, toView } from './view';

// Entregas de saída (Fase 6): sincronizar o lead com o CRM e avisar o corretor com o dossiê e o PDF.
// Cada uma é um job da fila (delivery_jobs): se falhar, volta com espera e tenta de novo, sem
// perder o lead e sem travar a outra entrega (o CRM fora do ar não atrasa o aviso ao corretor).

/** Erro que não adianta repetir (dado que falta, destino recusado): o job vai para DEAD. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export interface DeliveryDeps {
  db: Db;
  channel: ChannelAdapter;
  crm: CrmAdapter;
  /** Prazo para o primeiro contato citado no próximo passo do dossiê (padrão 5). */
  contactWithinMinutes?: number;
}

/** Erros que não se resolvem tentando de novo. */
export const isPermanent = (err: unknown): boolean =>
  err instanceof PermanentJobError || (err instanceof ChannelError && !err.retryable) || (err instanceof CrmError && !err.retryable);

const jidOf = (phone: string) => `${phone}@s.whatsapp.net`;

function crmSummary(b: SimulationBundle): Record<string, unknown> {
  const s = b.simulation;
  const n = (v: { toNumber(): number } | null) => (v === null ? null : v.toNumber());
  if (b.payment) {
    // Forma de pagamento (V2): o modo, o plano da entrada e a versão da condição comercial usada.
    const { input, result } = b.payment;
    const plan = result.plan;
    return {
      verdict: s.verdict,
      paymentMode: s.paymentMode,
      development: b.development?.name ?? null,
      unit: b.unit?.code ?? null,
      propertyValue: n(s.propertyValue),
      cashNow: input.mode === 'A_VISTA' ? null : input.cashNow,
      downPayment: result.downPayment?.chosen ?? null,
      amountToPay: result.cash?.amountToPay ?? null,
      downPaymentPlan: plan
        ? { act: plan.act, monthly: { count: plan.monthly.count, amount: plan.monthly.amount }, balloons: { count: plan.balloons.count, amount: plan.balloons.amount }, keys: plan.keys.amount }
        : null,
      balanceAtKeys: result.balanceAtKeys,
      conditionVersion: result.conditionVersion,
      generatedAt: s.generatedAt.toISOString(),
    };
  }
  return {
    verdict: s.verdict,
    development: b.development?.name ?? null,
    unit: b.unit?.code ?? null,
    propertyValue: n(s.propertyValue),
    system: s.system,
    termMonths: s.termMonths,
    financedAmount: n(s.financedAmount),
    requiredDownPayment: n(s.requiredDownPayment),
    firstInstallment: n(s.firstInstallment),
    lastInstallment: n(s.lastInstallment),
    parametersVersion: s.parametersVersion,
    generatedAt: s.generatedAt.toISOString(),
  };
}

export function createDeliveryHandler(deps: DeliveryDeps) {
  const { db, channel, crm } = deps;

  /**
   * Telefone do lead. Costuma estar em `leads.phone`; se outro lead já tem esse número (a mesma
   * pessoa chegou por um endereço diferente, como um LID), a coluna fica vazia e o número informado
   * na conversa é quem vale: é ele que junta os dois no CRM.
   */
  async function phoneOf(b: SimulationBundle): Promise<string | null> {
    if (b.lead.phone) return b.lead.phone;
    const conv = await db.conversation.findFirst({ where: { leadId: b.lead.id }, orderBy: { startedAt: 'desc' }, select: { context: true } });
    const phone = (conv?.context as { data?: { phone?: unknown } } | null)?.data?.phone;
    return typeof phone === 'string' ? phone : null;
  }

  /** RF-41: cria ou atualiza o contato pelo telefone (nunca duplica) e anexa a simulação. */
  async function syncCrm(job: DeliveryJobItem): Promise<void> {
    if (!job.simulationId) throw new PermanentJobError('job sem simulação');
    const b = await loadSimulationBundle(db, job.simulationId);
    const phone = await phoneOf(b);
    if (!phone) throw new PermanentJobError('lead sem telefone: não dá para deduplicar no CRM');
    // O responsável entra no CRM junto com o contato; quem já era responsável continua (RF-41).
    const broker = await assignBroker(db, b.lead.id, { phone });
    const { contactId } = await crm.upsertContact({
      phone,
      name: b.lead.name,
      email: b.lead.email,
      scoreClass: scoreClassFor(b.simulation.verdict),
      status: b.lead.status,
      development: b.development?.name ?? null,
      brokerId: broker?.id ?? null,
    });
    await crm.attachSimulation(contactId, { simulationId: b.simulation.id, summary: crmSummary(b) });
  }

  /** RF-33/39: manda o card e o PDF ao corretor responsável pelo lead (round-robin no primeiro envio). */
  async function notifyBroker(job: DeliveryJobItem): Promise<void> {
    if (!job.simulationId) throw new PermanentJobError('job sem simulação');
    const b = await loadSimulationBundle(db, job.simulationId);
    const phone = await phoneOf(b);
    const broker = await assignBroker(db, b.lead.id, { phone });
    if (!broker) throw new Error('nenhum corretor ativo para receber o lead');

    const payload = (job.payload ?? {}) as { update?: boolean; cardSent?: boolean };
    const update = payload.update === true;
    // Contato que o CRM já tinha antes desta simulação: avisa o corretor de que o lead não é novo (RF-41).
    const known = phone ? await db.crmContact.findUnique({ where: { phone } }) : null;
    const knownBefore = known !== null && known.createdAt < b.simulation.generatedAt;

    const withPhone = phone && !b.lead.phone ? { ...b, lead: { ...b.lead, phone } } : b;
    const view = b.payment ? toPaymentView(withPhone) : toView(withPhone);
    const chatId = jidOf(broker.phone);
    if (!payload.cardSent) {
      const cardOpts = { update, existingOwner: knownBefore && !update ? broker.name : null, ...(deps.contactWithinMinutes ? { contactWithinMinutes: deps.contactWithinMinutes } : {}) };
      await channel.sendText(chatId, 'kind' in view ? paymentDossierCard(view, cardOpts) : dossierCard(view, cardOpts));
      // Se o PDF falhar, a nova tentativa não repete o card.
      await setJobPayload(db, job.id, { ...payload, cardSent: true });
    }
    await channel.sendDocument(chatId, {
      data: 'kind' in view ? await buildPaymentPdf(view) : await buildSimulationPdf(view),
      fileName: pdfFileName(view),
      mimeType: 'application/pdf',
      caption: update ? 'PDF da simulação atualizada' : 'PDF da simulação',
    });
    await markDelivered(db, b.lead.id);
    await db.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: b.lead.id, action: update ? 'broker_updated' : 'broker_notified', after: { brokerId: broker.id, simulationId: b.simulation.id } } });
  }

  /**
   * Handoff (RF-07): o corretor recebe quem é o lead, o histórico da conversa e o código para assumir.
   * Vale para qualquer etapa, com ou sem simulação, e não depende do CRM.
   */
  async function notifyHandoff(job: DeliveryJobItem): Promise<void> {
    if (!job.leadId) throw new PermanentJobError('job sem lead');
    const lead = await db.lead.findUnique({ where: { id: job.leadId }, include: { _count: { select: { simulations: true } } } });
    // O lead pode ter pedido a exclusão dos dados antes da entrega: não há mais nada a enviar.
    if (!lead) throw new PermanentJobError('lead não existe mais (dados apagados)');
    const conv = await db.conversation.findFirst({ where: { leadId: lead.id, handoff: true }, orderBy: { startedAt: 'desc' } });
    if (!conv?.handoffCode) throw new PermanentJobError('conversa sem código de handoff');
    const ctx = conv.context as { data?: { phone?: string; typology?: string; email?: string | null } } | null;
    const phone = lead.phone ?? ctx?.data?.phone ?? null;
    const broker = await assignBroker(db, lead.id, { phone });
    if (!broker) throw new Error('nenhum corretor ativo para receber o lead');

    const history = (Array.isArray(conv.history) ? conv.history : []) as unknown as HandoffHistoryEntry[];
    await channel.sendText(
      jidOf(broker.phone),
      handoffCard({
        code: conv.handoffCode,
        name: lead.name,
        phone,
        email: lead.email,
        interest: ctx?.data?.typology ?? null,
        hasSimulation: lead._count.simulations > 0,
        requestedAt: conv.handoffAt ?? new Date(),
        history,
      }),
    );
    await db.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: lead.id, action: 'handoff_notified', after: { brokerId: broker.id } } });
  }

  return async function handle(job: DeliveryJobItem): Promise<void> {
    switch (job.kind) {
      case 'CRM_SYNC': return syncCrm(job);
      case 'BROKER_NOTIFY': return notifyBroker(job);
      case 'HANDOFF_NOTIFY': return notifyHandoff(job);
      case 'FIRST_CONTACT': throw new Error('FIRST_CONTACT ainda não é tratado pelo worker (Fase 13)');
    }
  };
}

export type DeliveryHandler = ReturnType<typeof createDeliveryHandler>;
