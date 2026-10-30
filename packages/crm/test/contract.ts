import { describe, expect, it } from 'vitest';
import type { CrmAdapter, CrmContactInput } from '../src';

/** Contrato que qualquer CrmAdapter (simulado ou real) precisa cumprir. */
export function crmContract(name: string, make: () => Promise<{ crm: CrmAdapter; ownerIds: string[]; countContacts(): Promise<number> }>) {
  const contact = (over: Partial<CrmContactInput> = {}): CrmContactInput => ({
    phone: '5513981264295', name: 'Maria da Silva', email: 'maria@gmail.com', scoreClass: 'HOT', status: 'SIMULATED',
    development: 'Residencial Exemplo', brokerId: null, ...over,
  });

  describe(`contrato CrmAdapter: ${name}`, () => {
    it('cria o contato e, no mesmo telefone, atualiza sem duplicar', async () => {
      const { crm, countContacts } = await make();
      const first = await crm.upsertContact(contact());
      const second = await crm.upsertContact(contact({ status: 'DELIVERED', scoreClass: 'WARM' }));
      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, contactId: first.contactId });
      expect(await countContacts()).toBe(1);
    });

    it('chamadas simultâneas com o mesmo telefone resultam em um contato só', async () => {
      const { crm, countContacts } = await make();
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => crm.upsertContact(contact())));
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(await countContacts()).toBe(1);
    });

    it('o responsável do contato não muda quando outro corretor é informado depois (RF-41)', async () => {
      const { crm, ownerIds } = await make();
      const [a, b] = ownerIds as [string, string];
      const first = await crm.upsertContact(contact({ brokerId: a }));
      const second = await crm.upsertContact(contact({ brokerId: b }));
      expect(first.ownerBrokerId).toBe(a);
      expect(second.ownerBrokerId).toBe(a);
    });

    it('anexar a mesma simulação duas vezes não duplica', async () => {
      const { crm } = await make();
      const { contactId } = await crm.upsertContact(contact());
      const sim = { simulationId: '5f0d6f46-4c3b-4a9e-9d58-0c1f2f2f3c11', summary: { verdict: 'VIAVEL' } };
      expect(await crm.attachSimulation(contactId, sim)).toBe(true);
      expect(await crm.attachSimulation(contactId, sim)).toBe(false);
    });
  });
}
