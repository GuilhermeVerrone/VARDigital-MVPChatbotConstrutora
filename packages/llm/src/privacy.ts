import { normalize } from '@mvp/parsers';
import type { FieldKind } from './fields';

// Minimização de dados (D13): a requisição à API externa leva só o texto da resposta e a definição
// do campo. Aqui ficam as duas travas: campos de identificação nunca vão ao modelo, e o texto que
// vai é mascarado.

/** Campos cujo valor é dado de identificação: só os parsers leem; se falharem, repergunta. */
export const PII_FIELD_KINDS: readonly FieldKind[] = ['name', 'phone', 'email'];

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\]]+/g;
/** Sequência de dígitos com separadores comuns de telefone/CPF/CNPJ. */
const DIGIT_RUN = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Mascara e-mail, telefone/CPF/CNPJ (10 a 14 dígitos) e os termos informados (ex.: nome do lead).
 * Valores em reais não são afetados: ficam abaixo de 10 dígitos.
 */
export function maskPii(text: string, terms: readonly string[] = []): string {
  let out = text.replace(EMAIL, '[e-mail]').replace(DIGIT_RUN, (m) => {
    const digits = m.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 14 ? '[número]' : m;
  });
  for (const term of terms) {
    if (term.trim().length < 2) continue;
    // sem acento e sem caixa, para pegar "João", "joao" e "JOÃO"
    const needle = normalize(term);
    const words = out.split(/(\s+)/);
    out = words.map((w) => (normalize(w.replace(/[^\p{L}\p{N}]/gu, '')) === needle ? '[nome]' : w)).join('');
  }
  return out;
}

/** Termos do nome do lead (cada palavra de 3+ letras) para mascarar no texto enviado. */
export function nameTerms(fullName: string | undefined | null): string[] {
  return (fullName ?? '').split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3);
}
