import raw from '../seed/illustrative-parameters.json' with { type: 'json' };
import { parseSimulationParameters } from './params';

/**
 * Parâmetros de EXEMPLO (status ILUSTRATIVO): taxas, faixas e cotas inventadas, só para
 * desenvolvimento e testes. Não usar com lead real antes da validação do financeiro.
 */
export const illustrativeParameters = parseSimulationParameters(raw);
