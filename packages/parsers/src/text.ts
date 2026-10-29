/** Minúsculas, sem acentos, espaços colapsados. Base de todos os parsers. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Como `normalize`, mas troca pontuação por espaço (para casar palavras inteiras). */
export function words(text: string): string[] {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

export function hasNegation(norm: string, includeSem = true): boolean {
  return (includeSem ? /\b(nao|nunca|nem|jamais|sem)\b/ : /\b(nao|nunca|nem|jamais)\b/).test(norm);
}
