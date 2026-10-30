import { normalize } from '@mvp/parsers';

const PATTERNS: RegExp[] = [
  /\b(ignor\w+|esquec\w+|desconsider\w+|descart\w+)\b.{0,40}\b(instruc\w+|regras?|prompt|comandos?|ordens|orientac\w+|tudo)\b/,
  /\b(system prompt|prompt do sistema|prompt inicial|suas instrucoes|seu prompt|suas regras)\b/,
  /\b(voce agora e|a partir de agora (voce|seja)|finja (que )?(ser|voce)|aja como|haja como|assuma o papel|modo desenvolvedor|developer mode|jailbreak|dan mode)\b/,
  /\b(ignore (all|previous|the above)|disregard|you are now|act as|pretend)\b/,
  /\b(revele|mostre|repita|exiba|imprima)\b.{0,30}\b(instruc\w+|prompt|regras|configurac\w+)\b/,
  /<\/?(system|assistant|instructions?)>|\[\/?(inst|system)\]|###\s*(system|instruction)/,
  /\b(responda|diga|escreva|afirme|garanta|confirme)\b.{0,30}\b(taxa|juros)\b.{0,20}\b(zero|0|0%|sem juros)\b/,
  /(^|\n)\s*(system|sistema|assistant|assistente|developer)\s*:/,
  /\b(preencha|defina|coloque|registre|marque|ponha)\b.{0,40}\b(com|como|para|em)\b.{0,15}\d/,
  /\b(intent|confidence|fields)\s*[=:]/,
  /\b(aprov\w+)\b.{0,25}\b(garantid\w+|automatic\w+|independente)\b/,
];

/** Heurística barata para barrar tentativa de prompt injection antes de chamar o LLM. */
export function looksLikeInjection(text: string): boolean {
  const norm = normalize(text);
  return PATTERNS.some((re) => re.test(norm));
}
