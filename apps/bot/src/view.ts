import type { PaymentView, SimulationView } from '@mvp/presentation';
import { num, type SimulationBundle } from '@mvp/db';

/**
 * Monta o que a apresentação mostra a partir da simulação gravada. O cenário (entrada/prazo que o
 * lead ajustou) é deduzido da própria entrada do motor: assim o PDF refeito mais tarde, ou o card
 * do corretor, mostram exatamente o que foi calculado.
 */
export function toView(b: SimulationBundle): SimulationView {
  const scenario: NonNullable<SimulationView['scenario']> = {};
  if (b.profile && b.input.availableDownPayment !== num(b.profile.availableDownPayment)) {
    scenario.downPayment = b.input.availableDownPayment;
  }
  if (b.input.desiredTermMonths !== undefined) scenario.termMonths = b.input.desiredTermMonths;

  return {
    leadName: b.lead.name,
    phone: b.lead.phone,
    email: b.lead.email,
    development: { name: b.development?.name ?? 'Empreendimento', city: b.development?.city ?? null },
    unit: b.unit ? { code: b.unit.code, typology: b.unit.typology, areaM2: num(b.unit.areaM2) } : null,
    input: b.input,
    result: b.result,
    generatedAt: b.simulation.generatedAt,
    simulationId: b.simulation.id,
    ...(Object.keys(scenario).length > 0 ? { scenario } : {}),
  };
}

/**
 * Visão de uma simulação por forma de pagamento (V2). O cenário (ato ou reforços que o lead
 * ajustou depois do primeiro resultado) é deduzido da entrada do motor contra o perfil gravado.
 */
export function toPaymentView(b: SimulationBundle): PaymentView {
  if (!b.payment) throw new Error(`a simulação ${b.simulation.id} não é de forma de pagamento`);
  const { input, result } = b.payment;
  const scenario: NonNullable<PaymentView['scenario']> = {};
  if (b.profile && input.mode !== 'A_VISTA') {
    const base = b.profile.cashNow !== null ? num(b.profile.cashNow) : num(b.profile.availableDownPayment);
    if (input.cashNow !== base) scenario.cashNow = input.cashNow;
    if (input.mode === 'ENTRADA_PARCELADA' && b.profile.acceptsBalloons !== null && input.acceptsBalloons !== b.profile.acceptsBalloons) {
      scenario.acceptsBalloons = input.acceptsBalloons;
    }
  }
  return {
    kind: 'payment',
    leadName: b.lead.name,
    phone: b.lead.phone,
    email: b.lead.email,
    development: { name: b.development?.name ?? 'Empreendimento', city: b.development?.city ?? null },
    unit: b.unit ? { code: b.unit.code, typology: b.unit.typology, areaM2: num(b.unit.areaM2) } : null,
    input,
    result,
    generatedAt: b.simulation.generatedAt,
    simulationId: b.simulation.id,
    ...(Object.keys(scenario).length > 0 ? { scenario } : {}),
  };
}
