import type { ChannelAdapter, InboundMessage } from '@mvp/channel';

/**
 * Handler provisório da Fase 3: devolve o que recebeu, com "digitando…". Prova o caminho
 * webhook → fila → worker → canal. A Fase 5 o substitui pelo orquestrador.
 */
export function echoReply(message: InboundMessage): string {
  if (message.type === 'text' && message.text) return `Eco: ${message.text}`;
  return `Recebi uma mensagem do tipo "${message.type}". Por enquanto só entendo texto.`;
}

export interface EchoOptions {
  /** Pausa "digitando…" antes de responder; proporcional ao texto, até este teto. */
  maxTypingMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createEchoHandler(channel: ChannelAdapter, opts: EchoOptions = {}) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxTyping = opts.maxTypingMs ?? 2_000;
  // Leitura e presença são cosméticas: se falharem, a resposta ainda deve sair.
  const bestEffort = (p: Promise<unknown>) => p.catch(() => undefined);

  return async (message: InboundMessage): Promise<void> => {
    const reply = echoReply(message);
    await bestEffort(channel.markRead(message.chatId, [message.externalId]));
    await bestEffort(channel.setPresence(message.chatId, 'composing'));
    await sleep(Math.min(maxTyping, 400 + reply.length * 20));
    try {
      await channel.sendText(message.chatId, reply);
    } finally {
      await bestEffort(channel.setPresence(message.chatId, 'paused'));
    }
  };
}
