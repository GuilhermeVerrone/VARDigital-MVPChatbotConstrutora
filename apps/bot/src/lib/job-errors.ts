/** Erro que não adianta repetir (dado que falta, destino recusado): o job vai para DEAD. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** O job não falhou: só precisa esperar (janela de horário, limite por hora, canal fora do ar). */
export class DeferJobError extends Error {
  constructor(readonly until: Date, reason: string) {
    super(reason);
    this.name = 'DeferJobError';
  }
}

