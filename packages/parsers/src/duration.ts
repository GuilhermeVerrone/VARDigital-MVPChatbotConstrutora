import { scanNumbers } from './numbers';
import { normalize } from './text';

const YEAR = new Set(['ano', 'anos']);
const MONTH = new Set(['mes', 'meses']);

/**
 * Duração em meses: "3 anos", "36 meses", "2 anos e meio", "1 ano e 6 meses", "seis meses".
 * Sem unidade explícita devolve `null` (30 é prazo em anos ou em meses?).
 */
export function parseDurationMonths(text: string): number | null {
  const norm = normalize(text);
  const phrases = scanNumbers(norm);
  let total = 0;
  let any = false;
  for (const p of phrases) {
    if (p.value === 0.5 && p.nextWord === '') continue; // o "meio" de "2 anos e meio", somado abaixo
    if (YEAR.has(p.nextWord)) {
      total += p.value * 12;
      any = true;
    } else if (MONTH.has(p.nextWord)) {
      total += p.value;
      any = true;
    } else if (!(p.bareArticle || p.nextWord === 'e')) {
      return null;
    }
  }
  if (!any) return null;
  if (/\b(anos?)\s+e\s+meio\b|\b(\d+|um|uma)\s+ano\s+e\s+meio\b/.test(norm)) total += 6;
  const months = Math.round(total);
  return months > 0 && months <= 1200 ? months : null;
}
