'use client';

import type { PaymentAlert, PaymentSuggestion } from '@mvp/simulation';
import { formatConditionValue, labelForPath } from '@/lib/condition-form';
import { brl, MODE_LABEL, pctText, VERDICT_LABEL } from '@/lib/format';
import type { PreviewOutput } from '@/lib/services';
import type { ParameterChange } from '@mvp/db/panel';

const ALERT_LABEL: Record<string, string> = {
  ILLUSTRATIVE_CONDITION: 'Condição ilustrativa (não validada pela construtora)',
  DOWN_PAYMENT_ADJUSTED: 'Entrada ajustada aos limites da condição',
  NO_TIME_FOR_INSTALLMENTS: 'Entrega próxima: sem mensais nem reforços',
  CORRECTION_APPLIES: 'Parcelas corrigidas pelo índice da condição',
  HIGH_INCOME_COMMITMENT: 'Comprometimento de renda alto',
  DESIRED_INSTALLMENT_EXCEEDED_SLIGHTLY: 'Parcela desejada excedida por pouco',
  DESIRED_INSTALLMENT_UNREACHABLE: 'Parcela desejada fora do alcance',
  BANK_ESTIMATE_NEEDS_ADJUSTMENTS: 'Estimativa do banco pede ajustes',
  BANK_ESTIMATE_NOT_VIABLE: 'Estimativa do banco inviável',
  BANK_ESTIMATE_UNAVAILABLE: 'Parâmetros do banco fora da vigência',
};

const Row = ({ k, v }: { k: string; v: string }) => (<div className="kv"><dt>{k}</dt><dd>{v}</dd></div>);

export function ChangesTable({ changes }: { changes: ParameterChange[] }) {
  if (changes.length === 0) return <p className="muted">Nenhuma diferença em relação à condição vigente.</p>;
  return (
    <table className="compact">
      <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.path}><th scope="row">{labelForPath(c.path)}</th><td>{formatConditionValue(c.path, c.before)}</td><td><strong>{formatConditionValue(c.path, c.after)}</strong></td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function PreviewView({ preview, changes, current }: { preview: PreviewOutput; changes?: ParameterChange[] | undefined; current?: { version: string; validFrom: string } | null | undefined }) {
  return (
    <div className="preview">
      <p className="muted small">
        Cálculo com o motor real, para hoje ({preview.referenceDate.split('-').reverse().join('/')}).
        {preview.conditionVersion ? ` Condição vigente ${preview.conditionVersion}.` : ' Usando o rascunho do formulário.'}
      </p>
      {changes ? (
        <details open={changes.length > 0}>
          <summary>O que muda em relação à vigente{current ? ` (${current.version})` : ''}: {changes.length} {changes.length === 1 ? 'campo' : 'campos'}</summary>
          <ChangesTable changes={changes} />
        </details>
      ) : null}
      {preview.modes.map(({ mode, preview: p, error }) => (
        <section key={mode} className="mode" aria-label={MODE_LABEL[mode]}>
          <h3>{MODE_LABEL[mode]}{p ? <span className={`badge ${p.result.verdict === 'VIAVEL' ? 'ok' : p.result.verdict === 'INVIAVEL' ? 'bad' : 'warn'}`}>{VERDICT_LABEL[p.result.verdict]}</span> : null}</h3>
          {error ? <p className="error" role="alert">Não foi possível calcular: {error}</p> : null}
          {p ? (
            <>
              <dl>
                <Row k="Preço da unidade" v={brl(p.result.unitPrice)} />
                {p.result.cash ? <><Row k="Desconto" v={`${brl(p.result.cash.discount)} (${pctText(p.result.cash.discountRatio)})`} /><Row k="A pagar" v={brl(p.result.cash.amountToPay)} /></> : null}
                {p.result.downPayment ? (
                  <>
                    <Row k="Entrada (mín.–máx.)" v={`${brl(p.result.downPayment.min)} – ${brl(p.result.downPayment.max)}`} />
                    <Row k="Entrada usada" v={brl(p.result.downPayment.chosen)} />
                    <Row k="Dinheiro disponível" v={brl(p.result.downPayment.cashNow)} />
                    {p.result.downPayment.shortfall > 0 ? <Row k="Falta no ato" v={brl(p.result.downPayment.shortfall)} /> : null}
                  </>
                ) : null}
                {p.result.plan ? (
                  <>
                    <Row k="Ato" v={brl(p.result.plan.act)} />
                    <Row k="Mensais" v={`${p.result.plan.monthly.count} × ${brl(p.result.plan.monthly.amount)}${p.result.plan.monthly.count > 0 ? ` (última ${brl(p.result.plan.monthly.lastAmount)})` : ''}`} />
                    {p.result.plan.balloons.count > 0 ? <Row k="Reforços" v={`${p.result.plan.balloons.count} × ${brl(p.result.plan.balloons.amount)}`} /> : null}
                    {p.result.plan.keys.amount > 0 ? <Row k="Chaves" v={brl(p.result.plan.keys.amount)} /> : null}
                    <Row k="Juros da construtora" v={brl(p.result.plan.interestTotal)} />
                    <Row k="Total pago na entrada" v={brl(p.result.plan.totalPaid)} />
                  </>
                ) : null}
                {p.result.capacity ? <Row k="Mensal máxima pela renda" v={brl(p.result.capacity.maxMonthly)} /> : null}
                {p.result.balanceAtKeys !== null ? <Row k="Saldo nas chaves" v={brl(p.result.balanceAtKeys)} /> : null}
                {p.result.bankEstimate ? (
                  <Row
                    k={`Financiamento do saldo (${p.parametersVersion ?? 'banco'})`}
                    v={p.result.bankEstimate.selected?.financing?.firstInstallment ? `${VERDICT_LABEL[p.result.bankEstimate.verdict]} · 1ª parcela ${brl(p.result.bankEstimate.selected.financing.firstInstallment.total)}` : VERDICT_LABEL[p.result.bankEstimate.verdict]}
                  />
                ) : null}
              </dl>
              {p.result.alerts.length > 0 ? <ul className="chips">{p.result.alerts.map((a: PaymentAlert, i) => <li key={i}>{ALERT_LABEL[a.code] ?? a.code}</li>)}</ul> : null}
              {p.result.suggestions.length > 0 ? <p className="muted small">Sugestões do motor: {p.result.suggestions.map((s: PaymentSuggestion) => s.code).join(', ')}</p> : null}
            </>
          ) : null}
        </section>
      ))}
      {preview.notOffered.length > 0 ? <p className="muted small">Não oferecido por esta condição: {preview.notOffered.map((m) => MODE_LABEL[m]).join(', ')}.</p> : null}
    </div>
  );
}
