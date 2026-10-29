import { scanNumbers } from './numbers';
import { hasNegation, normalize } from './text';

export interface MoneyResult {
  /** Reais, com no máximo centavos. */
  value: number;
  /** "uns 5 mil", "5 mil e pouco": o lead não deu um número exato. */
  approximate: boolean;
}

const MAX_MONEY = 1_000_000_000;
// Número seguido destas palavras é quantidade, não dinheiro ("2 filhos", "30 anos", "10x").
const NOT_MONEY_NEXT = new Set([
  'anos', 'ano', 'meses', 'mes', 'dias', 'dia', 'filhos', 'filho', 'filhas', 'dependentes', 'parcelas', 'parcela',
  'vezes', 'x', 'pessoas', 'quartos', 'quarto', 'suites', 'vagas', 'andar', 'andares', 'm2', 'metros', 'horas',
]);
const INSTALLMENT = new Set(['x', 'vezes', 'parcelas']);
const APPROX = /\b(uns|umas|cerca|aproximadamente|aprox|mais ou menos|em torno|quase|por volta|na faixa|ou menos|ou mais)\b/;
const NONE = /\b(nada|zero|nenhum|nenhuma|nao tenho|nao possuo|nao pago|nao devo|sem (nenhum|nenhuma|divida|dividas|parcela|parcelas|entrada|renda|fgts)|livre|limpo)\b/;

/**
 * Valor em reais a partir de texto livre. Devolve `null` quando não há exatamente um valor claro
 * (zero números, vários números, negação com número): quem chama repergunta ou aciona o LLM.
 */
export function parseMoney(text: string): MoneyResult | null {
  const norm = normalize(text);
  const all = scanNumbers(norm);
  // "10x de 500": o lead falou de parcelamento; o total não é o que ele informou.
  if (all.some((p) => INSTALLMENT.has(p.nextWord)) || /\d\s*%/.test(norm)) return null;
  const phrases = all.filter(
    (p) => !NOT_MONEY_NEXT.has(p.nextWord) && !(p.bareArticle && p.nextWord !== 'real' && p.nextWord !== 'reais'),
  );
  if (phrases.length === 0) return NONE.test(norm) && !hasNegation(norm.replace(NONE, '')) ? { value: 0, approximate: false } : null;
  if (phrases.length > 1) return null;
  const [p] = phrases;
  if (!p || hasNegation(norm, false)) return null;
  if (!(p.value >= 0) || p.value > MAX_MONEY) return null;
  return { value: Math.round(p.value * 100) / 100, approximate: p.trailing || APPROX.test(norm) };
}
