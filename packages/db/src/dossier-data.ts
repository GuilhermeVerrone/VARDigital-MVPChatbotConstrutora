import type { PaymentInput, PaymentResult, SimulationInput, SimulationResult } from '@mvp/simulation';
import type { Db } from './client';
import type { Broker, Development, FinancialProfile, Lead, Simulation, Unit } from './generated/prisma/client';
import type { ScoreClass, Verdict } from './generated/prisma/enums';
import { recordStatusChange } from './lead-status';

/** Tudo o que a apresentação e o dossiê precisam de uma simulação gravada. */
export interface SimulationBundle {
  simulation: Simulation;
  /** Só vale quando `payment` é null (simulação de financiamento do MVP). */
  result: SimulationResult;
  /** Só vale quando `payment` é null (simulação de financiamento do MVP). */
  input: SimulationInput;
  /** Presente nas simulações por forma de pagamento (V2): o modo, a entrada e o resultado do motor. */
  payment: { input: PaymentInput; result: PaymentResult } | null;
  lead: Lead;
  profile: FinancialProfile | null;
  unit: Unit | null;
  development: Development | null;
  broker: Broker | null;
}

export async function loadSimulationBundle(db: Db, simulationId: string): Promise<SimulationBundle> {
  const simulation = await db.simulation.findUniqueOrThrow({
    where: { id: simulationId },
    include: { lead: { include: { broker: true, financialProfile: true } }, unit: { include: { development: true } } },
  });
  const { lead, unit, ...rest } = simulation;
  const { broker, financialProfile, ...leadRow } = lead;
  return {
    simulation: rest as Simulation,
    result: simulation.result as unknown as SimulationResult,
    input: simulation.input as unknown as SimulationInput,
    payment: simulation.paymentMode
      ? { input: simulation.input as unknown as PaymentInput, result: simulation.result as unknown as PaymentResult }
      : null,
    lead: leadRow as Lead,
    profile: financialProfile,
    unit: unit ? ({ ...unit, development: undefined } as unknown as Unit) : null,
    development: unit?.development ?? null,
    broker,
  };
}

/**
 * Classificação simples pelo parecer (o score numérico configurável é pós-MVP, spec RF-28/29):
 * viável → quente, com ajustes → morno, inviável → frio.
 */
export const scoreClassFor = (verdict: Verdict): ScoreClass =>
  verdict === 'VIAVEL' ? 'HOT' : verdict === 'VIAVEL_COM_AJUSTES' ? 'WARM' : 'COLD';

/** Simulação feita: o lead passa a SIMULATED e recebe a classe pelo parecer. */
export async function markSimulated(db: Db, leadId: string, verdict: Verdict): Promise<void> {
  await db.$transaction(async (tx) => {
    await recordStatusChange(tx, leadId, 'SIMULATED', 'bot');
    await tx.lead.update({ where: { id: leadId }, data: { status: 'SIMULATED', scoreClass: scoreClassFor(verdict) } });
  });
}

/** Corretor avisado: o lead passa a DELIVERED (a menos que já esteja em HANDOFF/OPTED_OUT/CLOSED). */
export async function markDelivered(db: Db, leadId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, status: { in: ['SIMULATED', 'IN_PROGRESS', 'NEW'] } }, select: { id: true } });
    if (!lead) return;
    await recordStatusChange(tx, leadId, 'DELIVERED', 'bot');
    await tx.lead.update({ where: { id: leadId }, data: { status: 'DELIVERED' } });
  });
}
