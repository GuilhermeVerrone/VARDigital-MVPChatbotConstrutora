import { normalize } from './text';

export interface OptionDef {
  id: string;
  label: string;
  /** Outras formas de o lead escrever a mesma opção ("clt", "carteira assinada"). */
  aliases?: string[];
}

export interface OptionMatch {
  index: number;
  id: string;
}

const ORDINALS: Record<string, number> = {
  primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3, quarta: 4, quarto: 4, quinta: 5,
  quinto: 5, sexta: 6, sexto: 6, setima: 7, setimo: 7, oitava: 8, oitavo: 8, nona: 9, nono: 9, decima: 10, decimo: 10,
};
const CARDINALS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

function clean(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function numberChoice(norm: string, count: number): number | null {
  const m =
    /^(?:(?:e |eh |a |o |quero |queria |vou de |pode ser |escolho |seria )*(?:opcao|numero|n|item|alternativa)?\s*)?(\d{1,2})\s*(?:a|o|º|°)?$/.exec(norm) ??
    /^(?:quero |queria |vou de |pode ser |escolho |a |o )*(?:opcao|numero|item|alternativa) (\d{1,2})$/.exec(norm);
  let n: number | undefined = m ? Number(m[1]) : undefined;
  if (n === undefined) {
    const ws = norm.split(' ').filter((w) => !['a', 'o', 'e', 'quero', 'queria', 'opcao', 'numero', 'item', 'pode', 'ser', 'vou', 'de', 'escolho', 'e', 'a', 'letra', 'alternativa'].includes(w));
    if (ws.length === 1) n = ORDINALS[ws[0]!] ?? CARDINALS[ws[0]!];
    if (n === undefined) {
      const ord = /^(\d{1,2})(?:a|o)$/.exec(ws[0] ?? '');
      if (ws.length === 1 && ord) n = Number(ord[1]);
    }
  }
  return n !== undefined && n >= 1 && n <= count ? n : null;
}

/**
 * Escolha em lista numerada: "2", "opção 2", "a segunda", "dois", ou o texto da opção/apelido
 * ("sou CLT"). `null` se não casar, se casar com mais de uma opção ou se o número estiver fora da lista.
 */
export function parseOption(text: string, options: readonly OptionDef[]): OptionMatch | null {
  if (options.length === 0) return null;
  const norm = clean(text);
  if (!norm) return null;

  const letter = /^(?:letra|opcao|alternativa)\s+([a-z])$/.exec(norm);
  if (letter) {
    const idx = letter[1]!.charCodeAt(0) - 97;
    const o = options[idx];
    return o ? { index: idx, id: o.id } : null;
  }

  const n = numberChoice(norm, options.length);
  if (n !== null) return { index: n - 1, id: options[n - 1]!.id };
  if (/^(?:opcao |numero |item )?\d{1,2}$/.test(norm)) return null; // número fora da lista

  const tokens = norm.split(' ');
  const hits = new Map<number, number>(); // índice → comprimento do melhor apelido casado
  const spans = new Map<number, [number, number]>(); // índice → trecho do texto que casou
  options.forEach((opt, index) => {
    for (const raw of [opt.label, ...(opt.aliases ?? [])]) {
      const alias = clean(raw);
      if (!alias) continue;
      const aliasTokens = alias.split(' ');
      let at = -1;
      for (let i = 0; i + aliasTokens.length <= tokens.length && at < 0; i++) {
        const ok = aliasTokens.every((a, j) => {
          const t = tokens[i + j]!;
          return t === a || (a.length >= 6 && levenshtein1(t, a));
        });
        if (ok) at = i;
      }
      if (at >= 0 && alias.length > (hits.get(index) ?? 0)) {
        hits.set(index, alias.length);
        spans.set(index, [at, at + aliasTokens.length]);
      }
    }
  });
  if (hits.size === 0) return null;
  // Um apelido contido em outro ("outros" ⊂ "outros rendimentos") não deve gerar conflito.
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  // Opções que casaram em trechos diferentes do texto ("clt ou autônomo") são ambíguas.
  const [first, ...others] = ranked.map(([i]) => spans.get(i)!);
  if (others.some((s) => s[1] <= first![0] || s[0] >= first![1])) return null;
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  const [index] = ranked[0]!;
  return { index, id: options[index]!.id };
}

/** Tipos de renda do spec §3.2, com os apelidos mais comuns. */
export const INCOME_TYPE_OPTIONS: readonly OptionDef[] = [
  { id: 'CLT', label: 'CLT', aliases: ['carteira assinada', 'registrado', 'empregado', 'funcionario', 'assalariado', 'carteira'] },
  { id: 'AUTONOMO', label: 'Autônomo', aliases: ['autonoma', 'liberal', 'profissional liberal', 'pj', 'mei', 'por conta propria', 'freelancer', 'freela', 'empresario', 'empresaria', 'comerciante', 'sem carteira', 'informal'] },
  { id: 'SERVIDOR', label: 'Servidor público', aliases: ['servidor', 'concursado', 'funcionario publico', 'publico', 'militar', 'estatutario'] },
  { id: 'APOSENTADO', label: 'Aposentado/Pensionista', aliases: ['aposentada', 'aposentadoria', 'pensionista', 'pensao', 'inss', 'beneficio'] },
  { id: 'OUTROS', label: 'Outros', aliases: ['outro', 'outra', 'nenhum desses', 'nenhuma'] },
];
