import { describe, expect, it } from 'vitest';
import { handoffCard, historyLines } from '../src';

const base = {
  code: 'K7M2QX', name: 'Maria da Silva', phone: '5513981264295', email: 'maria@gmail.com', interest: '2 dormitórios', hasSimulation: false,
  requestedAt: new Date('2026-10-29T15:00:00Z'), history: [{ role: 'bot' as const, text: 'Qual a renda?' }, { role: 'lead' as const, text: 'quero falar com um corretor' }],
};

describe('card de handoff', () => {
  it('traz quem é o lead, o histórico e o código para assumir', () => {
    const card = handoffCard(base);
    expect(card).toContain('Código: *K7M2QX*');
    expect(card).toContain('*Cliente:* Maria da Silva');
    expect(card).toContain('(13) 98126-4295');
    expect(card).toContain('Bot: Qual a renda?');
    expect(card).toContain('Lead: quero falar com um corretor');
    expect(card).toContain('responda *assumir K7M2QX*');
    expect(card).toContain('ainda não concluída');
  });

  it('funciona com dados que faltam e avisa quando já houve simulação', () => {
    const card = handoffCard({ ...base, name: null, phone: null, email: null, interest: null, hasSimulation: true, history: [] });
    expect(card).toContain('não informado');
    expect(card).toContain('você recebeu o dossiê');
    expect(card).not.toContain('Conversa até aqui');
  });

  it('limita o histórico às mensagens mais recentes e corta mensagens longas', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: 'lead' as const, text: `mensagem ${i}` }));
    const lines = historyLines(many);
    expect(lines).toHaveLength(14);
    expect(lines.at(-1)).toBe('Lead: mensagem 39');
    const long = historyLines([{ role: 'bot', text: 'x'.repeat(2000) }]);
    expect(long[0]!.length).toBeLessThan(320);
    const huge = historyLines(Array.from({ length: 14 }, () => ({ role: 'bot' as const, text: 'y'.repeat(290) })));
    expect(huge.join('\n').length).toBeLessThanOrEqual(2900);
    expect(huge.length).toBeLessThan(14);
  });
});
