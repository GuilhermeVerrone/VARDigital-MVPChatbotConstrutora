import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PanelNotFoundError } from '@mvp/db/panel';
import type { DownPaymentPlan } from '@mvp/simulation';
import { PageHeader } from '@/components/fields';
import { brl, dateTimeBr, LEAD_EVENT_LABEL, LEAD_STATUS_LABEL, MODE_LABEL, phoneBr, SOURCE_LABEL, VERDICT_LABEL } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { brokersService, leadsService } from '@/lib/services';
import { AssignBroker, EraseLead, HandoffButtons } from '../LeadActions';

export const metadata = { title: 'Lead' };

const verdictClass = (v: string) => (v === 'VIAVEL' ? 'ok' : v === 'INVIAVEL' ? 'bad' : 'warn');
const statusOf = (v: unknown) => (v && typeof v === 'object' && 'status' in v ? LEAD_STATUS_LABEL[(v as { status: keyof typeof LEAD_STATUS_LABEL }).status] ?? String((v as { status: string }).status) : '—');

const COLLECTED_LABEL: Record<string, string> = {
  name: 'Nome', phone: 'Telefone', email: 'E-mail', typology: 'Tipologia', income: 'Renda mensal', incomeType: 'Tipo de renda', birthDate: 'Nascimento', debts: 'Parcelas que já paga',
  hasCoApplicant: 'Compra junto', coIncome: 'Renda do segundo comprador', downPayment: 'Entrada', desiredInstallment: 'Parcela desejada', hasFgts: 'Tem FGTS', fgtsBalance: 'Saldo do FGTS',
  fgtsMonths: 'Meses de FGTS', ownsProperty: 'Tem imóvel', firstFinancing: 'Primeiro financiamento', paymentMode: 'Forma de pagamento', cashNow: 'Dinheiro hoje', acceptsBalloons: 'Aceita reforços',
};
const MONEY = new Set(['income', 'coIncome', 'debts', 'downPayment', 'desiredInstallment', 'fgtsBalance', 'cashNow']);
const fmtValue = (k: string, v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number' && MONEY.has(k)) return brl(v);
  if (k === 'paymentMode' && typeof v === 'string' && v in MODE_LABEL) return MODE_LABEL[v as keyof typeof MODE_LABEL];
  return String(v);
};

function Plan({ plan }: { plan: DownPaymentPlan }) {
  return (
    <dl>
      <div className="kv"><dt>Entrada total</dt><dd>{brl(plan.total)}</dd></div>
      <div className="kv"><dt>Ato (hoje)</dt><dd>{brl(plan.act)}</dd></div>
      <div className="kv"><dt>Mensais</dt><dd>{plan.monthly.count}× {brl(plan.monthly.amount)}{plan.monthly.count > 0 && plan.monthly.lastAmount !== plan.monthly.amount ? ` (última ${brl(plan.monthly.lastAmount)})` : ''}</dd></div>
      <div className="kv"><dt>Reforços</dt><dd>{plan.balloons.count > 0 ? `${plan.balloons.count}× ${brl(plan.balloons.amount)}` : 'Sem reforços'}</dd></div>
      <div className="kv"><dt>Chaves</dt><dd>{brl(plan.keys.amount)}</dd></div>
      <div className="kv"><dt>Juros da construtora</dt><dd>{brl(plan.interestTotal)}</dd></div>
    </dl>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, ctx } = await requirePage('leads:read');
  const { id } = await params;
  const detail = await leadsService.get(ctx, id).catch((err: unknown) => {
    if (err instanceof PanelNotFoundError) return null;
    throw err;
  });
  if (!detail) notFound();
  const { lead, consents, conversation, simulations, timeline, profile } = detail;
  const canAssign = can(user.role, 'leads:assign');
  const canHandoff = can(user.role, 'leads:handoff');
  const brokers = canAssign ? (await brokersService.list(ctx)).filter((b) => b.active || b.id === lead.broker?.id) : [];
  const handoff = conversation?.handoff ?? null;
  const takenByMe = handoff?.takenBy?.id !== undefined && handoff.takenBy.id === user.brokerId;
  const canTake = canHandoff && handoff !== null && handoff.takenBy === null && user.brokerId !== null;
  const canRelease = canHandoff && handoff !== null && (user.role !== 'CORRETOR' || takenByMe);

  return (
    <>
      <PageHeader title={lead.name ?? 'Lead sem nome'} back={{ href: '/leads', label: 'Leads' }} />
      <p>
        <span className="badge">{LEAD_STATUS_LABEL[lead.status]}</span>{' '}
        {lead.verdict ? <span className={`badge ${verdictClass(lead.verdict)}`}>{VERDICT_LABEL[lead.verdict]}</span> : null}{' '}
        {lead.mode ? <span className="badge muted">{MODE_LABEL[lead.mode]}</span> : null}
      </p>

      <section aria-labelledby="dados">
        <h2 id="dados">Dados</h2>
        <div className="cards">
          <div className="card"><dl>
            <div className="kv"><dt>Telefone</dt><dd>{phoneBr(lead.phone)}</dd></div>
            <div className="kv"><dt>E-mail</dt><dd>{lead.email ?? '—'}</dd></div>
            <div className="kv"><dt>Código</dt><dd>{lead.contactCode ?? '—'}</dd></div>
            <div className="kv"><dt>Origem</dt><dd>{SOURCE_LABEL[lead.source]}</dd></div>
          </dl></div>
          <div className="card"><dl>
            <div className="kv"><dt>Empreendimento</dt><dd>{lead.development?.name ?? '—'}</dd></div>
            <div className="kv"><dt>Corretor</dt><dd>{lead.broker ? `${lead.broker.name}${lead.broker.active ? '' : ' (inativo)'}` : 'Sem corretor'}</dd></div>
            <div className="kv"><dt>Criado em</dt><dd>{dateTimeBr(lead.createdAt)}</dd></div>
            <div className="kv"><dt>Contato confirmado</dt><dd>{lead.contactConfirmedAt ? dateTimeBr(lead.contactConfirmedAt) : lead.source === 'SITE_FORM' ? 'Ainda não' : '—'}</dd></div>
          </dl></div>
          {profile ? (
            <div className="card"><dl>
              <div className="kv"><dt>Renda</dt><dd>{brl(profile.income)}</dd></div>
              <div className="kv"><dt>Parcelas</dt><dd>{brl(profile.debts)}</dd></div>
              <div className="kv"><dt>Dinheiro hoje</dt><dd>{profile.cashNow === null ? '—' : brl(profile.cashNow)}</dd></div>
              <div className="kv"><dt>Aceita reforços</dt><dd>{profile.acceptsBalloons === null ? '—' : profile.acceptsBalloons ? 'Sim' : 'Não'}</dd></div>
            </dl></div>
          ) : null}
        </div>
        {lead.utm && typeof lead.utm === 'object' && Object.keys(lead.utm).length > 0 ? (
          <p className="muted small">UTM: {Object.entries(lead.utm as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</p>
        ) : null}
      </section>

      <section aria-labelledby="acoes">
        <h2 id="acoes">Atendimento</h2>
        {handoff ? (
          <div className="notice info">
            <strong>{handoff.takenBy ? `Assumido por ${handoff.takenBy.name}` : 'Aguardando um corretor assumir'}</strong>
            {handoff.code ? <> · código {handoff.code}</> : null}{handoff.since ? <> · pedido em {dateTimeBr(handoff.since)}</> : null}
            <br /><span className="small">Enquanto a conversa está em handoff, o bot não responde ao lead.</span>
          </div>
        ) : <p className="muted">Sem pedido de corretor em aberto.</p>}
        {canTake || canRelease ? <HandoffButtons leadId={lead.id} canTake={canTake} canRelease={canRelease} /> : null}
        {canHandoff && handoff && user.role !== 'CORRETOR' && user.brokerId === null && !handoff.takenBy ? <p className="muted small">Para assumir, o seu usuário precisa estar vinculado a um corretor. Atribua o lead a um corretor abaixo.</p> : null}
        {canAssign ? <AssignBroker leadId={lead.id} current={lead.broker?.id ?? null} brokers={brokers.map((b) => ({ id: b.id, name: b.name }))} /> : null}
      </section>

      <section aria-labelledby="sims">
        <h2 id="sims">Simulações e plano</h2>
        {simulations.length === 0 ? <p className="muted">Este lead ainda não fez simulação.</p> : simulations.map((s) => {
          const plan = s.plan as DownPaymentPlan | null;
          return (
            <article className="card line" key={s.id}>
              <h3>
                {dateTimeBr(s.generatedAt)} <span className={`badge ${verdictClass(s.verdict)}`}>{VERDICT_LABEL[s.verdict]}</span> {s.mode ? <span className="badge muted">{MODE_LABEL[s.mode]}</span> : <span className="badge muted">Financiamento (MVP)</span>}
              </h3>
              <dl>
                <div className="kv"><dt>Unidade</dt><dd>{s.unit ? `${s.unit.development} · ${s.unit.code} (${s.unit.typology})` : '—'}</dd></div>
                <div className="kv"><dt>Valor do imóvel</dt><dd>{brl(s.propertyValue)}</dd></div>
                <div className="kv"><dt>Condição comercial</dt><dd>{s.conditionVersion ?? '—'}</dd></div>
                <div className="kv"><dt>Parâmetros do banco</dt><dd>{s.parametersVersion ?? '—'}</dd></div>
              </dl>
              {plan ? <><h4>Plano da entrada</h4><Plan plan={plan} /></> : null}
              <p><a className="btn ghost" href={`/leads/${lead.id}/pdf/${s.id}`} target="_blank" rel="noreferrer">Abrir PDF</a></p>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="conversa">
        <h2 id="conversa">Conversa</h2>
        {conversation ? (
          <>
            <p className="muted small">Estado do bot: <strong>{conversation.state}</strong> · iniciada em {dateTimeBr(conversation.startedAt)}</p>
            {conversation.history.length === 0 ? <p className="muted">Sem mensagens registradas.</p> : (
              <ol className="chat" aria-label="Mensagens da conversa">
                {conversation.history.map((m, i) => (
                  <li key={i} className={m.role === 'lead' ? 'lead' : 'bot'}>
                    <span className="who-label">{m.role === 'lead' ? 'Lead' : 'Bot'} · {dateTimeBr(new Date(m.at))}</span>
                    <span className="bubble">{m.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {Object.keys(conversation.collected).length > 0 ? (
              <details><summary>Dados coletados na conversa</summary>
                <dl>{Object.entries(conversation.collected).map(([k, v]) => <div className="kv" key={k}><dt>{COLLECTED_LABEL[k] ?? k}</dt><dd>{fmtValue(k, v)}</dd></div>)}</dl>
              </details>
            ) : null}
          </>
        ) : <p className="muted">Ainda não há conversa no WhatsApp.</p>}
      </section>

      <section aria-labelledby="consent">
        <h2 id="consent">Consentimento</h2>
        {consents.length === 0 ? <p className="muted">Nenhum consentimento registrado.</p> : (
          <table>
            <thead><tr><th scope="col">Canal</th><th scope="col">Versão do texto</th><th scope="col">Aceito em</th><th scope="col">Revogado em</th><th scope="col">Texto aceito</th></tr></thead>
            <tbody>
              {consents.map((c) => (
                <tr key={c.id}>
                  <td>{c.channel === 'WEB' ? 'Site' : 'WhatsApp'}</td><td>{c.textVersion}</td><td>{dateTimeBr(c.acceptedAt)}</td>
                  <td>{c.revokedAt ? <span className="badge bad">{dateTimeBr(c.revokedAt)}</span> : '—'}</td>
                  <td>{c.textSnapshot ? <details><summary>Ver</summary><p className="small">{c.textSnapshot}</p></details> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="hist">
        <h2 id="hist">Histórico de status e eventos</h2>
        <ol className="timeline">
          <li><time dateTime={lead.createdAt.toISOString()}>{dateTimeBr(lead.createdAt)}</time> Lead criado ({SOURCE_LABEL[lead.source]})</li>
          {timeline.map((e, i) => (
            <li key={i}>
              <time dateTime={e.at.toISOString()}>{dateTimeBr(e.at)}</time>{' '}
              {e.kind === 'status' ? <>Status: {statusOf(e.before)} → <strong>{statusOf(e.after)}</strong></> : (LEAD_EVENT_LABEL[e.action] ?? e.action)}
              {' '}<span className="muted small">por {e.actorName === 'bot' ? 'bot' : e.actorName === 'broker' ? 'corretor (WhatsApp)' : e.actorName}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">Mudanças de status anteriores ao painel não têm registro; a lista começa quando o histórico foi ativado.</p>
      </section>

      {can(user.role, 'leads:erase') ? (
        <section aria-labelledby="lgpd">
          <h2 id="lgpd">Exclusão de dados (LGPD)</h2>
          <EraseLead leadId={lead.id} />
        </section>
      ) : null}
      <p><Link href="/leads">← Voltar para a lista</Link></p>
    </>
  );
}
