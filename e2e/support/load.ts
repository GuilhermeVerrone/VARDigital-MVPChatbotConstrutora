import { leadSays, type StackEnv } from './whatsapp';

// Respostas típicas de um lead, em ordem; a conversa recomeça quando acaba.
const SCRIPT = ['oi', 'sim, aceito', 'Maria da Silva Souza', 'sim', 'pular', '1', '1', '3', '9 mil', 'clt', '05/03/1990', 'não', 'não', '30 mil', '2 mil', 'sim', 'não', 'não', 'sim', 'qual a previsão de entrega?'];

export async function leadsSay(env: StackEnv, phones: string[], o: { messages: number; concurrency: number }): Promise<{ accepted: number; rejected: number; ms: number }> {
  const started = Date.now();
  let next = 0;
  let accepted = 0;
  let rejected = 0;
  const worker = async () => {
    while (next < phones.length) {
      const phone = phones[next++]!;
      for (let n = 0; n < o.messages; n++) {
        try {
          await leadSays(env, phone, SCRIPT[n % SCRIPT.length]!);
          accepted += 1;
        } catch {
          rejected += 1;
        }
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
      }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency }, worker));
  return { accepted, rejected, ms: Date.now() - started };
}
