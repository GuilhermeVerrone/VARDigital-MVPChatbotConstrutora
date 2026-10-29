import { normalize, words } from './text';

// ---------- nome ----------

const LEAD_IN =
  /^\s*(?:ola[,!.]?\s+|oi[,!.]?\s+|bom dia[,!.]?\s+|boa tarde[,!.]?\s+|boa noite[,!.]?\s+)?(?:meu\s+nome\s+(?:completo\s+)?(?:[eé]|:)|me\s+chamo|(?:eu\s+)?sou\s+(?:o\s+|a\s+)?|aqui\s+[eé]\s+(?:o\s+|a\s+)?|pode\s+me\s+chamar\s+de|nome(?:\s+completo)?\s*:?)\s*/i;
const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von', 'der', 'la', 'le']);
const NOT_A_NAME = new Set([
  'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'sim', 'nao', 'obrigado', 'obrigada', 'quero',
  'gostaria', 'preciso', 'corretor', 'atendente', 'simular', 'simulacao', 'apartamento', 'voltar', 'corrigir',
  'sair', 'ajuda', 'financiar', 'financiamento', 'valor', 'renda', 'entrada', 'unidade', 'casa', 'imovel', 'meu',
  'minha', 'nome', 'pode', 'por', 'favor', 'ok', 'tenho', 'sou', 'estou', 'aqui', 'duvida', 'saber', 'queria',
  'informacao', 'informacoes', 'quanto', 'qual', 'como', 'onde', 'quando', 'nada', 'nenhum', 'ninguem', 'teste',
]);

/** Nome completo (mínimo 2 palavras), sem dígitos, com a caixa ajustada. */
export function parseName(text: string): string | null {
  const body = text.replace(LEAD_IN, '').replace(/[.!,;]+$/g, '').trim();
  if (!body || body.length > 80 || /[\d@/\\_=+*#<>{}[\]()]/.test(body)) return null;
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(body)) return null;
  const parts = body.split(/\s+/);
  if (parts.length < 2 || parts.length > 7) return null;
  const real = parts.filter((w) => !PARTICLES.has(normalize(w)));
  if (real.length < 2 || real.some((w) => w.replace(/[.'’-]/g, '').length < 2)) return null;
  if (PARTICLES.has(normalize(parts[0]!)) || PARTICLES.has(normalize(parts[parts.length - 1]!))) return null;
  if (parts.some((w) => NOT_A_NAME.has(normalize(w).replace(/[.'’-]/g, '')))) return null;
  return parts
    .map((w) => {
      if (PARTICLES.has(normalize(w))) return w.toLowerCase();
      const mixed = /\p{Ll}/u.test(w) && /\p{Lu}/u.test(w);
      return mixed ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

// ---------- telefone ----------

const DDDS = new Set(
  [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
    49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99,
  ].map(String),
);

export interface PhoneResult {
  /** DDD + número (10 ou 11 dígitos). */
  national: string;
  /** Com DDI: 55 + national. */
  e164: string;
  kind: 'mobile' | 'landline';
  /** O lead digitou celular sem o 9 e nós acrescentamos. */
  ninthDigitAdded: boolean;
}

/** Telefone BR (DDD + número), com ou sem +55, máscara ou espaços. */
export function parsePhone(text: string): PhoneResult | null {
  let digits = text.replace(/\D/g, '');
  if (digits.length === 12 || digits.length === 13) {
    if (!digits.startsWith('55')) return null;
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) return null;
  if (digits.length === 11 && digits[2] !== '9') return null;
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!DDDS.has(digits.slice(0, 2))) return null;
  const subscriber = digits.slice(2);
  if (digits.length === 10) {
    const first = subscriber[0]!;
    if (first >= '6') {
      const national = `${digits.slice(0, 2)}9${subscriber}`;
      return { national, e164: `55${national}`, kind: 'mobile', ninthDigitAdded: true };
    }
    if (first < '2') return null;
    return { national: digits, e164: `55${digits}`, kind: 'landline', ninthDigitAdded: false };
  }
  if (/^(\d)\1{7}$/.test(subscriber.slice(1))) return null;
  return { national: digits, e164: `55${digits}`, kind: 'mobile', ninthDigitAdded: false };
}

/** "esse mesmo", "o mesmo daqui": o lead quer usar o número da própria conversa. */
export function refersToSameNumber(text: string): boolean {
  const norm = words(text).join(' ');
  return /\b(esse|este|mesmo|o mesmo|o daqui|desse|deste|esse numero|este numero|esse whatsapp|esse zap|numero do whats|meu whats)\b/.test(norm) && words(text).length <= 8;
}

// ---------- e-mail ----------

const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}/gi;

/** Um único e-mail válido, em minúsculas. */
export function parseEmail(text: string): string | null {
  const found = new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/[.]+$/, '')));
  if (found.size !== 1) return null;
  const [email] = found;
  if (!email || email.length > 254 || email.includes('..')) return null;
  return email;
}
