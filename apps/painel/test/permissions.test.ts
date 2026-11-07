import { describe, expect, it } from 'vitest';
import { can, isPublicPath, leadScope, NAV_ITEMS, permissionForPath, ROLE_PERMISSIONS, type Role } from '../src/lib/permissions';

const ROLES: Role[] = ['ADMIN', 'GERENTE', 'CORRETOR'];

describe('rotas protegidas por papel', () => {
  const matrix: [string, Record<Role, boolean>][] = [
    ['/', { ADMIN: true, GERENTE: true, CORRETOR: true }],
    ['/empreendimentos', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/empreendimentos/novo', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/empreendimentos/abc/condicoes', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/financiamento', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/corretores', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/auditoria', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/leads', { ADMIN: true, GERENTE: true, CORRETOR: true }],
    ['/leads/abc', { ADMIN: true, GERENTE: true, CORRETOR: true }],
    ['/fluxo', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/simulador', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/whatsapp', { ADMIN: true, GERENTE: true, CORRETOR: false }],
    ['/usuarios', { ADMIN: true, GERENTE: false, CORRETOR: false }],
    ['/conta', { ADMIN: true, GERENTE: true, CORRETOR: true }],
  ];

  it.each(matrix)('%s', (path, expected) => {
    const permission = permissionForPath(path);
    expect(permission).not.toBeNull();
    for (const role of ROLES) expect(can(role, permission!), `${role} em ${path}`).toBe(expected[role]);
  });

  it('caminho sem regra é negado por padrão (null), e o login é a única rota pública', () => {
    expect(permissionForPath('/qualquer-coisa')).toBeNull();
    expect(permissionForPath('/empreendimentos-secreto')).toBeNull();
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/auditoria')).toBe(false);
  });

  it('só o admin altera o financiamento; o gerente só consulta; o corretor só tem o início e os próprios leads', () => {
    expect(can('ADMIN', 'financing:write')).toBe(true);
    expect(can('GERENTE', 'financing:write')).toBe(false);
    expect(can('GERENTE', 'financing:read')).toBe(true);
    expect(ROLE_PERMISSIONS.CORRETOR).toEqual(['home', 'leads:read', 'leads:handoff']);
    expect(can('CORRETOR', 'leads:assign')).toBe(false);
    expect(can('CORRETOR', 'leads:erase')).toBe(false);
  });

  it('só o admin gerencia usuários (criar outro admin é escalada de privilégio)', () => {
    for (const p of ['users:read', 'users:write'] as const) {
      expect(can('ADMIN', p)).toBe(true);
      expect(can('GERENTE', p)).toBe(false);
      expect(can('CORRETOR', p)).toBe(false);
    }
  });

  it('o menu do corretor só tem o início e os leads', () => {
    expect(NAV_ITEMS.filter((i) => can('CORRETOR', i.permission)).map((i) => i.href)).toEqual(['/', '/leads']);
    expect(NAV_ITEMS.filter((i) => !can('GERENTE', i.permission)).map((i) => i.href)).toEqual(['/usuarios']);
    expect(NAV_ITEMS.filter((i) => can('ADMIN', i.permission))).toHaveLength(NAV_ITEMS.length);
  });

  it('o escopo de leads: corretor só os dele (sem vínculo, nenhum); gestão e admin, todos', () => {
    expect(leadScope({ role: 'CORRETOR', brokerId: 'b1' })).toEqual({ brokerId: 'b1' });
    expect(leadScope({ role: 'CORRETOR', brokerId: null })).toEqual({ brokerId: null });
    expect(leadScope({ role: 'GERENTE', brokerId: null })).toBeUndefined();
    expect(leadScope({ role: 'ADMIN', brokerId: null })).toBeUndefined();
  });
});
