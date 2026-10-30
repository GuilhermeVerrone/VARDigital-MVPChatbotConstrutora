import type { Db, Prisma } from '@mvp/db';
import type { CrmAdapter, CrmContactInput, CrmSimulationInput, CrmUpsertResult } from './types';

/**
 * CRM do MVP (decisão D4): persiste em tabelas próprias (`crm_contacts`, `crm_simulations`),
 * separadas de `leads` como se fossem outro sistema. Dá para consultar e exportar por SQL.
 */
export class SimulatedCrm implements CrmAdapter {
  constructor(private readonly db: Db) {}

  async upsertContact(input: CrmContactInput): Promise<CrmUpsertResult> {
    const data: Prisma.InputJsonValue = {
      status: input.status,
      scoreClass: input.scoreClass,
      development: input.development,
    };
    return this.db.$transaction(async (tx) => {
      const existing = await tx.crmContact.findUnique({ where: { phone: input.phone } });
      if (!existing) {
        const created = await tx.crmContact.create({
          data: { phone: input.phone, name: input.name, email: input.email, ownerBrokerId: input.brokerId, data },
        });
        return { contactId: created.id, created: true, ownerBrokerId: created.ownerBrokerId };
      }
      // Atualiza sem apagar o que já havia (um campo ausente não sobrescreve) e mantém o responsável.
      const updated = await tx.crmContact.update({
        where: { id: existing.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          ownerBrokerId: existing.ownerBrokerId ?? input.brokerId,
          data,
        },
      });
      return { contactId: updated.id, created: false, ownerBrokerId: updated.ownerBrokerId };
    });
  }

  async attachSimulation(contactId: string, input: CrmSimulationInput): Promise<boolean> {
    const summary = input.summary as Prisma.InputJsonValue;
    return this.db.$transaction(async (tx) => {
      const existing = await tx.crmSimulation.findUnique({ where: { simulationId: input.simulationId } });
      if (existing) {
        await tx.crmSimulation.update({ where: { id: existing.id }, data: { summary } });
        return false;
      }
      await tx.crmSimulation.create({ data: { contactId, simulationId: input.simulationId, summary } });
      return true;
    });
  }
}
