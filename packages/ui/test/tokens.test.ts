import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colors, cssVar } from '../src';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('tokens Elevare', () => {
  it('tokens.css e tokens.ts têm as mesmas cores', () => {
    for (const [name, hex] of Object.entries(colors)) {
      expect(css, name).toMatch(new RegExp(`${cssVar(name as keyof typeof colors)}:\\s*${hex};`, 'i'));
    }
  });

  it('pares de texto e fundo usados no site passam WCAG AA (4,5:1)', () => {
    const pairs: [string, string][] = [
      [colors.green, colors.paper], // texto
      [colors.green80, colors.paper], // texto secundário
      [colors.green80, colors.white], // dica nos campos
      [colors.paper, colors.green], // faixa escura
      [colors.green, colors.lime], // botão na faixa escura e faixa lima
      ['#B9C9C4', colors.green], // texto secundário na faixa escura
      ['#A12A0A', colors.white], // erro de campo
    ];
    for (const [fg, bg] of pairs) expect(contrast(fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
