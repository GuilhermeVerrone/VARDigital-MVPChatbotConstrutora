import type { PaymentInput, PaymentResult, SimulationInput, SimulationResult } from '@mvp/simulation';

/** Classe do lead pelo parecer (score numérico configurável é pós-MVP, spec RF-28/29). */
export type LeadClass = 'HOT' | 'WARM' | 'COLD';

/**
 * Tudo o que as mensagens, o dossiê e o PDF mostram. Os números vêm só de `result` e `input` (o
 * motor) e dos dados que o lead informou; nenhum texto aqui passa por LLM.
 */
export interface SimulationView {
  leadName: string | null;
  phone: string | null;
  email: string | null;
  development: { name: string; city: string | null };
  /** Unidade usada como referência (a mais barata da tipologia escolhida). */
  unit: { code: string; typology: string; areaM2: number } | null;
  input: SimulationInput;
  result: SimulationResult;
  generatedAt: Date;
  /** Presente quando o lead ajustou entrada e/ou prazo depois do primeiro resultado. */
  scenario?: { downPayment?: number; termMonths?: number };
  /** Id da simulação (rodapé do PDF e do dossiê). */
  simulationId?: string;
}

/**
 * Simulação por forma de pagamento (V2): à vista, entrada à vista ou entrada parcelada. Mesmos
 * princípios do `SimulationView`: os números vêm só de `result` e `input` (o motor).
 */
export interface PaymentView {
  kind: 'payment';
  leadName: string | null;
  phone: string | null;
  email: string | null;
  development: { name: string; city: string | null };
  unit: { code: string; typology: string; areaM2: number } | null;
  input: PaymentInput;
  result: PaymentResult;
  generatedAt: Date;
  simulationId?: string;
  /** Presente quando o lead ajustou o ato/entrada ou os reforços depois do primeiro resultado. */
  scenario?: { cashNow?: number; acceptsBalloons?: boolean };
}
