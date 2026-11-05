import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce } from '../src';

describe('buildCsp', () => {
  it('não permite script inline nem eval em produção e fecha frames, objetos e base', () => {
    const csp = buildCsp('abc');
    const script = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toMatch(/ws:|http:/);
  });

  it('em desenvolvimento libera eval e o hot reload, sem upgrade para https', () => {
    const csp = buildCsp('abc', { dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('o nonce muda a cada chamada', () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
