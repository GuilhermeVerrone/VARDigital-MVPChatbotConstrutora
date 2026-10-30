import type { SimulationView } from '@mvp/presentation';
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
