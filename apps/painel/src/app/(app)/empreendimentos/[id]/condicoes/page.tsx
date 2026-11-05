import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  diffSalesConditions,
  getSalesConditionByVersion,
  getSalesConditionInForce,
  listSalesConditions,
  PanelNotFoundError,
  resolveActorNames,
  SAMPLE_PROFILES,
  todayIso,
} from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { conditionToValues, emptyValues } from '@/lib/condition-form';
import { dateBr } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { developmentsService } from '@/lib/services';
import { ConditionEditor } from './ConditionEditor';
import { ChangesTable } from './PreviewView';

export const metadata = { title: 'Condições comerciais' };

export default async function CondicoesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ de?: string; para?: string }> }) {
  const { id } = await params;
  const { de, para } = await searchParams;
  const { user, ctx } = await requirePage('conditions:read');
  const dev = await developmentsService.get(ctx, id).catch((e) => {
    if (e instanceof PanelNotFoundError || (e instanceof Error && /uuid|Inconsistent column data/i.test(e.message))) notFound();
    throw e;
  });
  const today = todayIso();
  const [inForce, versions] = await Promise.all([getSalesConditionInForce(ctx.db, id, today).catch(() => null), listSalesConditions(ctx.db, id)]);
  const names = await resolveActorNames(ctx.db, versions.map((v) => v.createdBy));
  const history = [...versions].reverse();
  const [a, b] = de && para ? await Promise.all([getSalesConditionByVersion(ctx.db, de), getSalesConditionByVersion(ctx.db, para)]) : [null, null];
  const availableUnits = dev.units.filter((u) => u.status !== 'SOLD');

  return (
    <>
      <PageHeader title={`Condições · ${dev.name}`} back={{ href: `/empreendimentos/${id}`, label: dev.name }} />
      {availableUnits.length === 0 ? (
        <p>Cadastre ao menos uma unidade para usar a calculadora de prévia.</p>
      ) : (
        <ConditionEditor
          developmentId={id}
          values={inForce ? conditionToValues(inForce.condition) : emptyValues()}
          baseVersion={inForce?.version ?? null}
          units={availableUnits.map((u) => ({ id: u.id, label: `${u.code} · ${u.typology}`, price: u.price }))}
          profiles={SAMPLE_PROFILES.map((p) => ({ id: p.id, label: p.label }))}
          today={today}
          canWrite={can(user.role, 'conditions:write')}
        />
      )}

      <section aria-labelledby="hist">
        <h2 id="hist">Histórico de versões</h2>
        <table>
          <thead><tr><th scope="col">Versão</th><th scope="col">Vigência</th><th scope="col">Situação</th><th scope="col">Publicada por</th><th scope="col">Motivo</th></tr></thead>
          <tbody>
            {history.map((v) => (
              <tr key={v.id}>
                <th scope="row">{v.version}{v.supersededById ? <span className="badge muted">substituída</span> : null}</th>
                <td>{dateBr(v.validFrom)} → {v.validTo ? dateBr(v.validTo) : 'em vigor'}</td>
                <td>{v.condition.status === 'VALIDADO' ? 'Validado' : 'Ilustrativo'}</td>
                <td>{names.get(v.createdBy) ?? v.createdBy}</td>
                <td>{v.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {versions.length >= 2 ? (
          <>
            <h3>Comparar versões</h3>
            <form method="get" className="inline-form">
              <label>De <select name="de" defaultValue={de ?? versions[0]!.version}>{versions.map((v) => <option key={v.id}>{v.version}</option>)}</select></label>
              <label>Para <select name="para" defaultValue={para ?? versions[versions.length - 1]!.version}>{versions.map((v) => <option key={v.id}>{v.version}</option>)}</select></label>
              <button className="btn ghost" type="submit">Comparar</button>
            </form>
            {a && b ? <ChangesTable changes={diffSalesConditions(a.condition, b.condition)} /> : null}
          </>
        ) : null}
        <p><Link href="/auditoria">Ver auditoria completa</Link></p>
      </section>
    </>
  );
}
