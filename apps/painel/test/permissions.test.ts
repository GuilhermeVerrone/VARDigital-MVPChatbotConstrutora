import { describe, expect, it } from 'vitest';
import { can, isPublicPath, NAV_ITEMS, permissionForPath, ROLE_PERMISSIONS, type Role } from '../src/lib/permissions';

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

  it('só o admin altera o financiamento; o gerente só consulta; o corretor não vê nada além do início', () => {
    expect(can('ADMIN', 'financing:write')).toBe(true);
    expect(can('GERENTE', 'financing:write')).toBe(false);
    expect(can('GERENTE', 'financing:read')).toBe(true);
    expect(ROLE_PERMISSIONS.CORRETOR).toEqual(['home']);
  });

  it('o menu do corretor só tem o início', () => {
    expect(NAV_ITEMS.filter((i) => can('CORRETOR', i.permission)).map((i) => i.href)).toEqual(['/']);
    expect(NAV_ITEMS.filter((i) => can('GERENTE', i.permission))).toHaveLength(NAV_ITEMS.length);
  });
});
