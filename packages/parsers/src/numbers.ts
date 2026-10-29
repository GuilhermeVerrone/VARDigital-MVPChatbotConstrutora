import { normalize } from './text';

// Varredura de números escritos de forma livre: "5.000,50", "5k", "uns 5 mil", "dois mil e
// quinhentos", "1,5 milhão", "5 mil e 500". Devolve cada "frase numérica" separadamente; quem
// chama decide o que fazer com mais de uma (valor monetário: ambíguo; duração: soma).

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};
const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400,
  quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
const MULTIPLIERS: Record<string, number> = { mil: 1_000, k: 1_000, milhao: 1_000_000, milhoes: 1_000_000 };

export interface NumberPhrase {
  value: number;
  /** Palavra logo depois da frase (ex.: "anos", "reais"); '' se for o fim do texto. */
  nextWord: string;
  /** Frase que é só "um"/"uma": quase sempre artigo, não quantidade. */
  bareArticle: boolean;
  /** "5 mil e pouco": o valor é um piso. */
  trailing: boolean;
}

/** Interpreta um número escrito com dígitos ("5.000,50", "1.5", "5,000"). */
export function parseDigits(literal: string): number | null {
  if (!/^\d[\d.,]*$/.test(literal)) return null;
  const lastDot = literal.lastIndexOf('.');
  const lastComma = literal.lastIndexOf(',');
  let clean: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // O último separador é o decimal; o outro é de milhar.
    clean =
      lastComma > lastDot
        ? literal.replace(/\./g, '').replace(',', '.')
        : literal.replace(/,/g, '');
  } else if (lastComma >= 0) {
    clean = /^\d{1,3}(,\d{3})+$/.test(literal) ? literal.replace(/,/g, '') : literal.replace(',', '.');
    if ((literal.match(/,/g) ?? []).length > 1 && !/^\d{1,3}(,\d{3})+$/.test(literal)) return null;
  } else if (lastDot >= 0) {
    const multi = (literal.match(/\./g) ?? []).length > 1;
    clean = multi || /^\d{1,3}\.\d{3}$/.test(literal) ? literal.replace(/\./g, '') : literal;
    if (multi && !/^\d{1,3}(\.\d{3})+$/.test(literal)) return null;
  } else {
    clean = literal;
  }
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

type Tok = { kind: 'num'; value: number; word: boolean } | { kind: 'mult'; value: number } | { kind: 'e' } | { kind: 'meio' } | { kind: 'word'; text: string };

function tokenize(norm: string): Tok[] {
  const out: Tok[] = [];
  for (const m of norm.replace(/r\$/g, ' ').matchAll(/\d(?:[\d.,]*\d)?|[a-z]+/g)) {
    const t = m[0];
    if (/^\d/.test(t)) {
      const v = parseDigits(t);
      out.push(v === null ? { kind: 'word', text: t } : { kind: 'num', value: v, word: false });
    } else if (t in MULTIPLIERS) out.push({ kind: 'mult', value: MULTIPLIERS[t]! });
    else if (t in UNITS) out.push({ kind: 'num', value: UNITS[t]!, word: true });
    else if (t in TENS) out.push({ kind: 'num', value: TENS[t]!, word: true });
    else if (t in HUNDREDS) out.push({ kind: 'num', value: HUNDREDS[t]!, word: true });
    else if (t === 'e') out.push({ kind: 'e' });
    else if (t === 'meio' || t === 'meia') out.push({ kind: 'meio' });
    else out.push({ kind: 'word', text: t });
  }
  return out;
}

const TRAILING = new Set(['pouco', 'poucos', 'picos', 'tantos']);

export function scanNumbers(text: string): NumberPhrase[] {
  const toks = tokenize(normalize(text));
  const phrases: NumberPhrase[] = [];
  let total = 0;
  let current = 0;
  let lastMult = 0;
  let started = false;
  let pendingE = false;
  let last: 'none' | 'num' | 'mult' = 'none';
  let prevWord = false; // último número foi escrito por extenso
  let parts: Tok[] = [];

  const close = (nextWord: string, trailing = false) => {
    if (started) {
      const value = total + current;
      const [only] = parts;
      const article = parts.length === 1 && only?.kind === 'num' && only.word && only.value === 1;
      phrases.push({ value, nextWord, bareArticle: article, trailing });
    }
    total = 0; current = 0; lastMult = 0; started = false; pendingE = false; last = 'none'; parts = [];
  };

  for (const tok of toks) {
    switch (tok.kind) {
      case 'num':
        // dois números colados são frases distintas, exceto depois de "e" ("vinte e cinco")
        // ou depois de um multiplicador ("5 mil 500").
        if (started && last === 'num' && (!pendingE || !(tok.word && prevWord))) close('');
        current += tok.value;
        started = true; pendingE = false; last = 'num'; prevWord = tok.word; parts.push(tok);
        break;
      case 'mult':
        if (started && last === 'mult') close('');
        total += (current || 1) * tok.value;
        current = 0; lastMult = tok.value; started = true; pendingE = false; last = 'mult'; parts.push(tok);
        break;
      case 'meio':
        if (started && pendingE && lastMult && current === 0) {
          total += lastMult / 2; pendingE = false; parts.push(tok);
        } else if (!started) {
          current = 0.5; started = true; last = 'num'; parts.push(tok);
        } else close('meio');
        break;
      case 'e':
        if (started) pendingE = true;
        break;
      case 'word':
        close(tok.text, pendingE && TRAILING.has(tok.text));
        break;
    }
  }
  close('');
  return phrases;
}
