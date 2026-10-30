import { ALERT_FOR_BROKER, SUGGESTION_FOR_BROKER } from './phrases';
import { ageYears, areaM2, brl, dateTimeBr, INCOME_TYPE_LABEL, joinList, pct, phoneBr, termText } from './format';
import type { LeadClass, SimulationView } from './types';

// Dossiê do corretor (spec §6): card de texto para WhatsApp. Só fatos e números do motor.

const CLASS_HEADER: Record<LeadClass, string> = { HOT: '🔥 LEAD QUENTE', WARM: '🌤️ LEAD MORNO', COLD: '❄️ LEAD FRIO' };
const VERDICT_LABEL = { VIAVEL: '✅ Viável', VIAVEL_COM_AJUSTES: '⚠️ Viável com ajustes', INVIAVEL: '❌ Inviável no momento' } as const;

export const leadClassFor = (verdict: keyof typeof VERDICT_LABEL): LeadClass =>
  verdict === 'VIAVEL' ? 'HOT' : verdict === 'VIAVEL_COM_AJUSTES' ? 'WARM' : 'COLD';

export interface DossierOptions {
  /** Prazo para o primeiro contato citado no próximo passo (o SLA configurável é pós-MVP). */
  contactWithinMinutes?: number;
  /** true quando é a atualização de uma simulação já enviada (o lead ajustou entrada/prazo). */
  update?: boolean;
  /** Contato já conhecido do CRM (RF-41): nome do responsável. */
  existingOwner?: string | null;
}

function nextStep(view: SimulationView, minutes: number): string {
  const f = view.result.selected?.financing ?? null;
  const talk: string[] = [];
  if (f?.constructionFlow && f.constructionFlow.monthly.count > 0) talk.push('entrada parcelada durante a obra');
  if (f && f.fgtsUsed > 0) talk.push('uso do FGTS na entrada');
  if (f && f.subsidy > 0) talk.push('subsídio');
  const highlight = talk.length > 0 ? ` Destacar: ${joinList(talk)}.` : '';

  switch (view.result.verdict) {
    case 'VIAVEL':
      return `Ligar em até ${minutes} min e agendar visita ao stand.${highlight}`;
    case 'VIAVEL_COM_AJUSTES': {
      const fixes = view.result.suggestions.map((s) => SUGGESTION_FOR_BROKER[s.code](s));
      return `Ligar em até ${minutes} min, mostrar como fechar a conta (${joinList(fixes)}) e convidar para visita.${highlight}`;
    }
    case 'INVIAVEL': {
      const fixes = view.result.suggestions.map((s) => SUGGESTION_FOR_BROKER[s.code](s));
      return `Contato consultivo, sem pressão: explicar as alternativas (${joinList(fixes)}) e avaliar outra tipologia.`;
    }
  }
}

export function dossierCard(view: SimulationView, opts: DossierOptions = {}): string {
  const { input, result } = view;
  const f = result.selected?.financing ?? null;
  const term = result.selected?.term ?? null;
  const a = input.applicant;
  const co = input.coApplicant;
  const age = ageYears(a.birthDate, input.referenceDate);

  const out: string[] = [];
  if (opts.update) out.push('🔄 SIMULAÇÃO ATUALIZADA: o lead ajustou entrada/prazo');
  out.push(`${CLASS_HEADER[leadClassFor(result.verdict)]} — ${VERDICT_LABEL[result.verdict]}`);
  out.push('(classe pelo parecer da simulação; o score numérico configurável vem depois do MVP)');
  if (opts.existingOwner) out.push(`ℹ️ Lead já existia no CRM. Responsável: ${opts.existingOwner}`);

  const family = a.grossMonthlyIncome + (co?.grossMonthlyIncome ?? 0);
  out.push(
    '',
    '👤 CLIENTE',
    [view.leadName ?? 'Nome não informado', view.phone ? phoneBr(view.phone) : null, view.email].filter(Boolean).join(' | '),
    `Idade: ${age} | Renda familiar: ${brl(family)} (${INCOME_TYPE_LABEL[a.incomeType] ?? a.incomeType}) | Co-proponente: ${co ? `sim, renda ${brl(co.grossMonthlyIncome)} (${INCOME_TYPE_LABEL[co.incomeType] ?? co.incomeType})` : 'não'}`,
    `Primeiro imóvel: ${input.firstFinancing ? 'sim' : 'não'} | Possui imóvel: ${input.ownsResidentialProperty ? 'sim' : 'não'} | Parcelas mensais: ${brl(a.monthlyDebts + (co?.monthlyDebts ?? 0))}`,
    `Entrada disponível: ${brl(input.availableDownPayment)} | FGTS: ${a.fgts ? `${brl(a.fgts.balance)} (${a.fgts.contributionMonths} meses de carteira)` : 'não informou'}`,
  );
  out.push(
    '',
    '🏢 INTERESSE',
    `${view.development.name}${view.unit ? ` | ${view.unit.typology}, unidade ${view.unit.code}, ${areaM2(view.unit.areaM2)}` : ''} | Valor: ${brl(result.propertyValue)}`,
  );

  out.push('', '💰 SIMULAÇÃO (indicativa)');
  if (result.selected && f) {
    out.push(`Linha: ${result.selected.lineName} | Sistema: ${f.system}${term ? ` | Prazo: ${termText(term.months)}` : ''}`);
    out.push(`Valor financiável: ${brl(f.financedAmount)} | Entrada necessária: ${brl(f.requiredDownPayment)}`);
    out.push(`Subsídio estimado: ${brl(f.subsidy)} | FGTS na entrada: ${brl(f.fgtsUsed)}`);
    if (f.firstInstallment) {
      out.push(`1ª parcela: ${brl(f.firstInstallment.total)} | Última parcela: ${brl(f.lastInstallment?.total ?? f.firstInstallment.total)}${f.incomeCommitment !== null ? ` | Comprometimento: ${pct(f.incomeCommitment)}` : ''}`);
    } else {
      out.push('Sem parcela calculada: a capacidade de pagamento não cobre o financiamento');
    }
    const c = f.constructionFlow;
    if (c && f.firstInstallment) {
      const parts = [`sinal ${brl(c.signal)}`];
      if (c.monthly.count > 0) parts.push(`${c.monthly.count}x ${brl(c.monthly.amount)}`);
      if (c.balloons.count > 0) parts.push(`${c.balloons.count} ${c.balloons.count === 1 ? 'reforço' : 'reforços'} de ${brl(c.balloons.amount)}`);
      out.push(`Fluxo de obra: ${parts.join(' + ')}`);
    }
  } else {
    out.push('Nenhuma linha de crédito elegível para esse perfil e valor de imóvel');
  }
  out.push(`Parecer: ${VERDICT_LABEL[result.verdict]}`);
  out.push(`Parâmetros: ${result.parametersVersion}${result.parametersStatus === 'ILUSTRATIVO' ? ' (ILUSTRATIVO)' : ''} | Gerada em ${dateTimeBr(view.generatedAt)}`);
  if (view.scenario) {
    const ch: string[] = [];
    if (view.scenario.downPayment !== undefined) ch.push(`entrada ${brl(view.scenario.downPayment)}`);
    if (view.scenario.termMonths !== undefined) ch.push(`prazo ${termText(view.scenario.termMonths)}`);
    if (ch.length > 0) out.push(`Cenário do lead: ${ch.join(', ')}`);
  }

  const alerts = result.alerts.map((x) => ALERT_FOR_BROKER[x.code](x)).filter((t): t is string => t !== null);
  if (alerts.length > 0) out.push('', '⚠️ ALERTAS', ...alerts.map((t) => `• ${t}`));

  out.push('', '🎯 PRÓXIMO PASSO SUGERIDO', nextStep(view, opts.contactWithinMinutes ?? 5));
  out.push('', '📎 PDF da simulação anexo');
  return out.join('\n');
}
