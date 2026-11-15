import dados from './conversas.json';

// Conversas reais do atendimento, gravadas por `pnpm vitrine:capturas` (dados ILUSTRATIVOS do seed).

export interface Mensagem { de: 'bot' | 'lead'; texto: string; arquivo?: string }
export interface Conversa { id: string; nome: string; modo: string; resumo: string; mensagens: Mensagem[]; corretor?: Mensagem[] }

export const conversas = dados as Conversa[];
export const conversa = (id: string): Conversa => {
  const c = conversas.find((x) => x.id === id);
  if (!c) throw new Error(`conversa ${id} não encontrada; rode pnpm vitrine:capturas`);
  return c;
};
