/**
 * Contrato do CRM (spec §9.1 e §11). O bot só conhece esta interface: trocar o CRM simulado por
 * RD Station, HubSpot ou Salesforce não deve mexer no fluxo. Todas as operações são idempotentes,
 * porque a fila de entregas pode repeti-las (entrega "pelo menos uma vez").
 */

export interface CrmContactInput {
  /** E.164 só com dígitos. Chave de deduplicação (RF-41). */
  phone: string;
  name: string | null;
  email: string | null;
  /** Classe pelo parecer (quente/morno/frio), se já houver simulação. */
  scoreClass: 'HOT' | 'WARM' | 'COLD' | null;
  /** Status do lead no bot (ex.: SIMULATED). */
  status: string;
  development: string | null;
  /** Corretor que o bot atribuiu; só vale se o contato ainda não tiver responsável no CRM. */
  brokerId: string | null;
}

export interface CrmUpsertResult {
  contactId: string;
  /** true = contato novo; false = o telefone já existia e o registro foi atualizado. */
  created: boolean;
  /** Responsável no CRM (o já existente, se houver, senão o informado). */
  ownerBrokerId: string | null;
}

export interface CrmSimulationInput {
  /** Id da simulação no bot: referência externa e chave de idempotência. */
  simulationId: string;
  /** Resumo legível (parecer, valores, versão dos parâmetros). */
  summary: Record<string, unknown>;
}

export interface CrmAdapter {
  /** Cria o contato ou, se o telefone já existe, atualiza (nunca duplica). */
  upsertContact(input: CrmContactInput): Promise<CrmUpsertResult>;
  /** Anexa a simulação ao contato. false = já estava anexada (nada mudou). */
  attachSimulation(contactId: string, input: CrmSimulationInput): Promise<boolean>;
}

/** Falha do CRM. `retryable` diz se vale tentar de novo (indisponível) ou não (dado recusado). */
export class CrmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}
