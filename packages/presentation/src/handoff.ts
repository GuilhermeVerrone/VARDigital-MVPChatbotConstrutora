import { dateTimeBr, phoneBr } from './format';

// Aviso de handoff ao corretor: quem é o lead, o que ele já contou e o código para assumir a conversa.
// Texto fixo (nenhum LLM); o histórico vai como o lead e o bot escreveram.

export interface HandoffHistoryEntry {
  role: 'lead' | 'bot';
  text: string;
}

export interface HandoffCardArgs {
  code: string;
  name: string | null;
  /** E.164 só com dígitos. */
  phone: string | null;
  email: string | null;
  /** Tipologia de interesse, se já informada. */
  interest: string | null;
  /** O lead já recebeu um resultado de simulação (o corretor já tem o dossiê). */
  hasSimulation: boolean;
  requestedAt: Date;
  history: readonly HandoffHistoryEntry[];
}

const MAX_ENTRIES = 14;
const MAX_ENTRY_CHARS = 300;
/** O WhatsApp aceita bem mais, mas um card enorme não é lido. */
const MAX_HISTORY_CHARS = 2800;

const clip = (t: string): string => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > MAX_ENTRY_CHARS ? `${one.slice(0, MAX_ENTRY_CHARS - 1)}…` : one;
};

/** As últimas mensagens que cabem, da mais antiga para a mais nova. */
export function historyLines(history: readonly HandoffHistoryEntry[]): string[] {
  const lines = history.slice(-MAX_ENTRIES).map((h) => `${h.role === 'lead' ? 'Lead' : 'Bot'}: ${clip(h.text)}`);
  let total = 0;
  const kept: string[] = [];
  for (const line of [...lines].reverse()) {
    if (total + line.length > MAX_HISTORY_CHARS && kept.length > 0) break;
    kept.unshift(line);
    total += line.length + 1;
  }
  return kept;
}

export function handoffCard(a: HandoffCardArgs): string {
  const out: string[] = ['🙋 *Lead pediu para falar com um corretor*', `Código: *${a.code}*`, ''];
  out.push(`*Cliente:* ${a.name ?? 'não informado'}`);
  out.push(`*Telefone:* ${a.phone ? phoneBr(a.phone) : 'não informado'}`);
  if (a.email) out.push(`*E-mail:* ${a.email}`);
  if (a.interest) out.push(`*Interesse:* ${a.interest}`);
  out.push(`*Pedido em:* ${dateTimeBr(a.requestedAt)}`);
  out.push(a.hasSimulation ? '*Simulação:* o lead já recebeu um resultado (você recebeu o dossiê).' : '*Simulação:* ainda não concluída.');

  const lines = historyLines(a.history);
  if (lines.length > 0) out.push('', '*Conversa até aqui:*', ...lines);

  out.push(
    '',
    'O bot já parou de enviar perguntas a este lead. Chame-o pelo WhatsApp.',
    `Para registrar que você assumiu: responda *assumir ${a.code}*.`,
  );
  return out.join('\n');
}
