/** Erro de validação de formulário do painel: `fields` mapeia o campo para a mensagem. */
export class PanelValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields).join('; '));
    this.name = 'PanelValidationError';
  }
}

export class PanelNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} não encontrado`);
    this.name = 'PanelNotFoundError';
  }
}

export function requireActor(actor: string): void {
  if (!actor.trim()) throw new Error('informe quem está alterando (auditoria)');
}
