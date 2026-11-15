import { describe, expect, it } from 'vitest';
import { trechos } from '../src/conteudo/texto-whatsapp';

describe('formatação do WhatsApp', () => {
  it('negrito e itálico viram trechos; o resto fica como está', () => {
    expect(trechos('fiz a simulação do *Lumen Urban* para _você_.')).toEqual([
      { t: 'fiz a simulação do ' }, { t: 'Lumen Urban', b: true }, { t: ' para ' }, { t: 'você', i: true }, { t: '.' },
    ]);
  });
  it('asterisco solto não vira negrito', () => {
    expect(trechos('valor * 2')).toEqual([{ t: 'valor * 2' }]);
    expect(trechos('')).toEqual([]);
  });
});
