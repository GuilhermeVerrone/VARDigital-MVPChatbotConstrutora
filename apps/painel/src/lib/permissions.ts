// Papéis e permissões do painel (D8, G15). Puro: o mesmo mapa vale para o menu, o proxy, as páginas e
// os serviços (defesa em profundidade: esconder o link não protege, então cada página e cada ação
// confere a permissão no servidor).

export type Role = 'ADMIN' | 'GERENTE' | 'CORRETOR';

export type Permission =
  | 'home'
  | 'developments:read'
  | 'developments:write'
  | 'conditions:read'
  | 'conditions:write'
  | 'financing:read'
  | 'financing:write'
  | 'brokers:read'
  | 'brokers:write'
  | 'audit:read';

const GESTAO: Permission[] = [
  'home', 'developments:read', 'developments:write', 'conditions:read', 'conditions:write',
  'financing:read', 'brokers:read', 'brokers:write', 'audit:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Financiamento (taxa, prazo) é decisão do admin; o gerente só consulta.
  ADMIN: [...GESTAO, 'financing:write'],
  GERENTE: GESTAO,
  // O corretor só entra no painel; a lista dos seus leads chega na Fase 15.
  CORRETOR: ['home'],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Permissão mínima para abrir cada área do painel (prefixo do caminho → permissão). */
export const ROUTE_PERMISSIONS: readonly { prefix: string; permission: Permission }[] = [
  { prefix: '/empreendimentos', permission: 'developments:read' },
  { prefix: '/financiamento', permission: 'financing:read' },
  { prefix: '/corretores', permission: 'brokers:read' },
  { prefix: '/auditoria', permission: 'audit:read' },
];

/** Rotas que não exigem sessão. */
export const PUBLIC_PATHS = ['/login'] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p);
}

/** Permissão exigida pelo caminho. A página inicial é `home`; caminho de uma área sem regra é negado por padrão. */
export function permissionForPath(pathname: string): Permission | null {
  if (pathname === '/' || pathname === '/acesso-negado') return 'home';
  const route = ROUTE_PERMISSIONS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!route) return null;
  // Rotas de condições comerciais ficam sob /empreendimentos/<id>/condicoes.
  if (route.prefix === '/empreendimentos' && /^\/empreendimentos\/[^/]+\/condicoes(\/|$)/.test(pathname)) return 'conditions:read';
  return route.permission;
}

export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    super(`sem permissão: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

export interface PanelUser {
  id: string;
  name: string;
  role: Role;
  brokerId: string | null;
}

export function assertCan(user: Pick<PanelUser, 'role'>, permission: Permission): void {
  if (!can(user.role, permission)) throw new ForbiddenError(permission);
}

/** Itens do menu que o papel pode ver. */
export const NAV_ITEMS: readonly { href: string; label: string; permission: Permission }[] = [
  { href: '/', label: 'Início', permission: 'home' },
  { href: '/empreendimentos', label: 'Empreendimentos', permission: 'developments:read' },
  { href: '/financiamento', label: 'Financiamento simulado', permission: 'financing:read' },
  { href: '/corretores', label: 'Corretores', permission: 'brokers:read' },
  { href: '/auditoria', label: 'Auditoria', permission: 'audit:read' },
];
