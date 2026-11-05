import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './client';

// Limite de chamadas ao LLM por conversa (D13): protege o custo contra loop e abuso. Contagem em
// memória, com despejo da conversa mais antiga: reiniciar o bot zera os contadores, o que é aceitável
// (o limite é teto de custo, não regra de negócio). Estourou: o bot segue só com os parsers.

export interface CallBudget {
  /** Cliente que conta as chamadas da conversa e recusa depois do teto. */
  forConversation(conversationId: string, client: LlmClient): LlmClient;
  used(conversationId: string): number;
}

export function createCallBudget(opts: { maxCalls: number; maxConversations?: number }): CallBudget {
  const counts = new Map<string, number>();
  const cap = opts.maxConversations ?? 5000;
  return {
    used: (id) => counts.get(id) ?? 0,
    forConversation(id, client) {
      return {
        model: client.model,
        async completeJson(req: LlmRequest): Promise<LlmResponse> {
          const n = counts.get(id) ?? 0;
          if (n >= opts.maxCalls) throw new LlmError('limit_exceeded', `limite de ${opts.maxCalls} chamadas ao LLM nesta conversa`);
          counts.delete(id);
          counts.set(id, n + 1); // reinsere: a mais antiga fica no início do Map
          if (counts.size > cap) counts.delete(counts.keys().next().value!);
          return client.completeJson(req);
        },
      };
    },
  };
}
