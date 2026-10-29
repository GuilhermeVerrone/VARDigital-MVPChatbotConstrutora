import { normalize, words } from './text';

const MAX_WORDS = 8;
const FILLER = new Set(['a', 'o', 'as', 'os', 'e', 'eh', 'que', 'mesmo', 'por', 'favor', 'obrigado', 'obrigada', 'ne', 'senhor', 'senhora', 'tive', 'sim', 'ta', 'ai', 'ja', 'foi', 'esta']);
const UNSURE = /\b(talvez|depende|acho|nao sei|nao lembro|nao tenho certeza|sei la|quem sabe|nao entendi|como assim|duvida)\b/;
const NO_PHRASES = [
  'nao tenho', 'nao possuo', 'nao tem', 'nao ha', 'nao sou', 'nao quero', 'nao pretendo', 'nao fiz', 'nao foi',
  'nao e', 'nao estou', 'nao ainda', 'de jeito nenhum', 'jamais', 'nunca', 'negativo', 'nenhum', 'nenhuma',
];
const NO_WORDS = ['nao', 'n', 'nn', 'nope', 'nada', 'nops'];
const YES_WORDS = [
  'sim', 's', 'ss', 'simm', 'isso', 'claro', 'certo', 'correto', 'confere', 'confirmo', 'confirmado', 'ok', 'okay',
  'positivo', 'exato', 'exatamente', 'uhum', 'aham', 'ahan', 'yes', 'tenho', 'possuo', 'sou', 'quero', 'aceito',
  'aceitei', 'pode', 'perfeito', 'beleza', 'blz', 'fechado', 'combinado', 'tem', 'temos', 'vamos', 'bora', 'concordo',
];
const YES_PHRASES = ['com certeza', 'pode ser', 'pode sim', 'e isso', 'e sim', 'tenho sim', 'sou sim', 'isso mesmo', 'por favor', 'de acordo'];

/**
 * Sim/não de resposta curta. `null` para qualquer coisa duvidosa (talvez, "não sei", sim e não na
 * mesma frase, frases longas): o orquestrador repergunta.
 */
export function parseYesNo(text: string): boolean | null {
  if (/^\s*(👍|✅|✔️?|🆗)/u.test(text)) return true;
  if (/^\s*(👎|❌|🚫)/u.test(text)) return false;
  const norm = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!norm || words(norm).length > MAX_WORDS || UNSURE.test(norm)) return null;

  let rest = ` ${norm} `;
  let no = 0;
  for (const phrase of NO_PHRASES) {
    const re = new RegExp(` ${phrase} `, 'g');
    rest = rest.replace(re, () => { no++; return '  '; });
  }
  for (const w of NO_WORDS) {
    rest = rest.replace(new RegExp(` ${w} `, 'g'), () => { no++; return '  '; });
  }
  let yes = 0;
  for (const phrase of YES_PHRASES) rest = rest.replace(new RegExp(` ${phrase} `, 'g'), () => { yes++; return '  '; });
  for (const w of YES_WORDS) rest = rest.replace(new RegExp(` ${w} `, 'g'), () => { yes++; return '  '; });

  const leftover = words(rest).filter((w) => !FILLER.has(w));
  if (leftover.length > 1) return null;
  if (yes > 0 && no > 0) return null;
  if (no > 0) return false;
  if (yes > 0) return true;
  return null;
}

const SKIP = /^(pular|pulo|passo|passar|prefiro nao (informar|dizer|passar|falar)|nao quero (informar|dizer|passar|falar)|sem (email|e mail)|nao tenho( email| e mail)?|depois|agora nao|nenhum|nao uso|skip)$/;

/** "Pular" um campo opcional (RF-14). */
export function isSkip(text: string): boolean {
  const norm = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return SKIP.test(norm);
}
