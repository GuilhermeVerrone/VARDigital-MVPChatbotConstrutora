import { describe, expect, it } from 'vitest';
import { checkFormToken, issueFormToken } from '../src/lib/form-token';
import { normalizeBrPhone } from '../src/lib/phone';
import { createRateLimiter } from '../src/lib/rate-limit';
import { formSchema, parseUtm } from '../src/lib/schema';

describe('telefone', () => {
  it('normaliza celulares brasileiros para E.164', () => {
    expect(normalizeBrPhone('(41) 98888-7777')).toBe('5541988887777');
    expect(normalizeBrPhone('+55 41 98888 7777')).toBe('5541988887777');
    expect(normalizeBrPhone('041988887777')).toBe('5541988887777');
    expect(normalizeBrPhone('5541988887777')).toBe('5541988887777');
  });
  it('recusa fixo, curto e lixo', () => {
    for (const v of ['(41) 3333-4444', '98888-7777', '123', 'abc', '(00) 98888-7777', '']) expect(normalizeBrPhone(v), v).toBeNull();
  });
});

describe('token do formulário', () => {
  const secret = 'segredo-segredo-1234';
  const opts = { minMs: 3000, maxMs: 7_200_000 };
  it('mede o tempo de preenchimento', () => {
    const t = issueFormToken(secret, 1_000_000_000_000);
    expect(checkFormToken(t, secret, { ...opts, now: 1_000_000_001_000 })).toBe('too-fast');
    expect(checkFormToken(t, secret, { ...opts, now: 1_000_000_010_000 })).toBe('ok');
    expect(checkFormToken(t, secret, { ...opts, now: 1_000_010_000_000 })).toBe('expired');
  });
  it('recusa token forjado, de outra chave ou vazio', () => {
    const t = issueFormToken(secret, 1_000_000_000_000);
    expect(checkFormToken(t, 'outra-chave-outra-chave', { ...opts, now: 1_000_000_010_000 })).toBe('invalid');
    expect(checkFormToken('1000000000000.' + 'a'.repeat(32), secret, opts)).toBe('invalid');
    expect(checkFormToken('', secret, opts)).toBe('invalid');
    expect(checkFormToken('9999999999999.x', secret, opts)).toBe('invalid');
  });
});

describe('limite de tentativas', () => {
  it('bloqueia depois do máximo e libera quando a janela passa', () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect([rl.hit('a', 0), rl.hit('a', 10), rl.hit('a', 20)]).toEqual([true, true, false]);
    expect(rl.hit('b', 20)).toBe(true);
    expect(rl.hit('a', 1100)).toBe(true);
  });

  it('max 0 desliga o limite', () => {
    const rl = createRateLimiter({ max: 0, windowMs: 1000 });
    expect(Array.from({ length: 50 }, (_, i) => rl.hit('a', i))).toEqual(Array(50).fill(true));
  });
});

describe('validação do formulário', () => {
  const ok = { name: ' Ana Souza ', phone: '(41) 98888-7777', email: '', development: 'lumen-urban', typology: '', consent: 'on', optin: 'on', website: '', token: 't', utm: '' };
  it('aceita e normaliza', () => {
    expect(formSchema.parse(ok)).toMatchObject({ name: 'Ana Souza', phone: '5541988887777', email: null, typology: null });
  });
  it('consentimento e opt-in desmarcados barram o envio', () => {
    for (const k of ['consent', 'optin'] as const) {
      const r = formSchema.safeParse({ ...ok, [k]: undefined });
      expect(r.success).toBe(false);
    }
  });
  it('rejeita nome vazio, telefone ruim e e-mail inválido', () => {
    expect(formSchema.safeParse({ ...ok, name: 'A' }).success).toBe(false);
    expect(formSchema.safeParse({ ...ok, name: '1234' }).success).toBe(false);
    expect(formSchema.safeParse({ ...ok, phone: '123' }).success).toBe(false);
    expect(formSchema.safeParse({ ...ok, email: 'sem-arroba' }).success).toBe(false);
    expect(formSchema.parse({ ...ok, email: 'ana@exemplo.com' }).email).toBe('ana@exemplo.com');
  });
  it('utm: só chaves conhecidas e textos curtos', () => {
    expect(parseUtm(JSON.stringify({ source: 'google', medium: 'cpc', evil: 'x', campaign: 'c'.repeat(300) }))).toEqual({ source: 'google', medium: 'cpc', campaign: 'c'.repeat(100) });
    expect(parseUtm('')).toBeNull();
    expect(parseUtm('{nao json')).toBeNull();
    expect(parseUtm('[]')).toBeNull();
  });
});
