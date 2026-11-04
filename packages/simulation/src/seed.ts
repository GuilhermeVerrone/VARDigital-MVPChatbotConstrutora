import raw from '../seed/illustrative-parameters.json' with { type: 'json' };
import rawConditions from '../seed/illustrative-sales-conditions.json' with { type: 'json' };
import { parseSimulationParameters } from './params';
import { parseSalesCondition, type SalesCondition } from './sales-condition';

/**
 * Parâmetros de EXEMPLO (status ILUSTRATIVO): taxas, faixas e cotas inventadas, só para
 * desenvolvimento e testes. Não usar com lead real antes da validação do financeiro.
 */
export const illustrativeParameters = parseSimulationParameters(raw);

/**
 * Condições comerciais de EXEMPLO (status ILUSTRATIVO) dos 3 empreendimentos Elevare, por slug.
 * Números inventados até o financeiro da construtora validar (D9).
 */
export const illustrativeSalesConditions: Record<'lumen-urban' | 'parc-verde' | 'altomare', SalesCondition> = {
  'lumen-urban': parseSalesCondition(rawConditions['lumen-urban']),
  'parc-verde': parseSalesCondition(rawConditions['parc-verde']),
  altomare: parseSalesCondition(rawConditions.altomare),
};
