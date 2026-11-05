/** Resultado de uma Server Action de formulário. */
export interface FormState {
  ok?: string;
  error?: string;
  /** Mensagem por campo (nome do input). */
  fields?: Record<string, string>;
}
