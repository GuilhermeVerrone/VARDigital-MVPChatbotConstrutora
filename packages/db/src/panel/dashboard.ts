import type { Db } from '../client';
import type { PaymentMode } from '../generated/prisma/enums';
import { leadWhere, type LeadScope } from './leads';

// Início do painel (Fase 15): funil do formulário do site, divisão por forma de pagamento e leads do
// dia. Respeita o escopo do usuário (corretor vê só os números dos próprios leads).

export interface FunnelStep {
  key: 'FORM' | 'CONFIRMED' | 'SIMULATED' | 'BROKER';
  label: string;
  count: number;
}

export interface PanelDashboard {
  /** Funil de quem veio pelo formulário: cada etapa conta quem chegou NELA (não só quem parou nela). */
  funnel: FunnelStep[];
  /** Leads com simulação, por forma de pagamento. */
  byMode: { mode: PaymentMode | null; count: number }[];
  today: { total: number; fromSite: number; fromWhatsapp: number };
  /** Conversas esperando um corretor assumir. */
  waitingHandoff: number;
}

/** Meia-noite de hoje em São Paulo (UTC−3 o ano todo desde 2019). */
export function startOfTodaySp(now: Date): Date {
  const sp = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(`${sp.toISOString().slice(0, 10)}T00:00:00-03:00`);
}

export async function getPanelDashboard(db: Db, scope?: LeadScope, now: Date = new Date()): Promise<PanelDashboard> {
  const mine = leadWhere({}, scope);
  const site = { AND: [mine, { source: 'SITE_FORM' as const }] };
  const [form, confirmed, simulated, withBroker, modes, todayRows, waiting] = await Promise.all([
    db.lead.count({ where: site }),
    db.lead.count({ where: { AND: [site, { contactConfirmedAt: { not: null } }] } }),
    db.lead.count({ where: { AND: [site, { contactConfirmedAt: { not: null } }, { simulations: { some: {} } }] } }),
    db.lead.count({ where: { AND: [site, { contactConfirmedAt: { not: null } }, { simulations: { some: {} } }, { brokerId: { not: null } }] } }),
    db.lead.groupBy({ by: ['paymentMode'], where: { AND: [mine, { simulations: { some: {} } }] }, _count: { _all: true } }),
    db.lead.groupBy({ by: ['source'], where: { AND: [mine, { createdAt: { gte: startOfTodaySp(now) } }] }, _count: { _all: true } }),
    db.conversation.count({ where: { handoff: true, state: 'HANDOFF', takenByBrokerId: null, lead: mine } }),
  ]);
  const today = { total: 0, fromSite: 0, fromWhatsapp: 0 };
  for (const r of todayRows) {
    today.total += r._count._all;
    if (r.source === 'SITE_FORM') today.fromSite += r._count._all;
    else today.fromWhatsapp += r._count._all;
  }
  return {
    funnel: [
      { key: 'FORM', label: 'Preencheram o formulário', count: form },
      { key: 'CONFIRMED', label: 'Confirmaram o contato', count: confirmed },
      { key: 'SIMULATED', label: 'Fizeram a simulação', count: simulated },
      { key: 'BROKER', label: 'Com corretor', count: withBroker },
    ],
    byMode: modes.map((m) => ({ mode: m.paymentMode, count: m._count._all })).sort((a, b) => b.count - a.count),
    today,
    waitingHandoff: waiting,
  };
}
