import Link from 'next/link';
import { ALLOWED_VARIABLES, DEFAULT_TEXTS, flowErrors, lintFlowContent, OPTIONAL_STEPS, TEXT_META, type TextKey } from '@mvp/conversation';
import { PageHeader } from '@/components/fields';
import { contentToValues, EDITABLE_TEXT_KEYS, issuesByField } from '@/lib/flow-form';
import { dateTimeBr } from '@/lib/format';
import { LOCKED_BLOCKS } from '@/lib/locked-blocks';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { flowService } from '@/lib/services';
import { DiscardDraft, FlowEditor, ReasonForm, type TextItem } from './FlowEditor';

export const metadata = { title: 'Fluxo do bot' };

const STATUS_LABEL = { DRAFT: 'Rascunho', PUBLISHED: 'Publicada', RETIRED: 'Aposentada' } as const;

export default async function Fluxo() {
  const { user, ctx } = await requirePage('flow:read');
  const overview = await flowService.overview(ctx);
  const canWrite = can(user.role, 'flow:write');
  const working = overview.draft ?? overview.published;
  const issues = overview.draft ? lintFlowContent(overview.draft.content) : [];
  const errors = flowErrors(issues);
  const texts: TextItem[] = EDITABLE_TEXT_KEYS.map((key: TextKey) => ({
    key, label: TEXT_META[key].label, group: TEXT_META[key].group, fallback: DEFAULT_TEXTS[key], variables: [...(ALLOWED_VARIABLES[key] ?? [])],
  }));
  return (
    <>
      <PageHeader title="Fluxo do bot">
        <Link className="btn ghost" href="/simulador">Testar no simulador</Link>
      </PageHeader>
      <p className="muted">
        {overview.published ? <>No ar: <strong>versão {overview.published.version}</strong>, publicada em {dateTimeBr(overview.published.publishedAt!)}.</> : <>Nenhuma versão publicada: o bot usa os textos padrão do código.</>}{' '}
        {overview.draft ? <span className="badge warn">Há um rascunho salvo, ainda fora do ar</span> : null}
      </p>
      {overview.draft && errors.length > 0 ? <p className="notice error" role="alert">O rascunho salvo tem {errors.length} problema{errors.length > 1 ? 's' : ''} (destacados abaixo). Não dá para publicar até corrigir.</p> : null}

      <FlowEditor
        values={contentToValues(working?.content ?? null)}
        texts={texts}
        steps={OPTIONAL_STEPS.map((s) => ({ ...s }))}
        firstContact={{ fallback: DEFAULT_TEXTS.FIRST_CONTACT, variables: [...(ALLOWED_VARIABLES.FIRST_CONTACT ?? [])] }}
        savedErrors={issuesByField(errors)}
        canWrite={canWrite}
      />

      {canWrite ? (
        <>
          <section aria-labelledby="publicar">
            <h2 id="publicar">Publicar</h2>
            {overview.draft ? (
              <>
                <p className="muted">Publica o <strong>rascunho salvo</strong>. Salve as alterações antes. O motivo fica na auditoria.</p>
                <ReasonForm kind="publish" label="Publicar rascunho" blocked={errors.length > 0} />
                <DiscardDraft />
              </>
            ) : <p className="muted">Nada para publicar: salve um rascunho primeiro.</p>}
          </section>
          <section aria-labelledby="reverter">
            <h2 id="reverter">Reverter</h2>
            {overview.canRevert ? (
              <>
                <p className="muted">Volta ao conteúdo da versão anterior à publicada, como uma versão nova (as versões publicadas não mudam). Um rascunho em edição não é afetado.</p>
                <ReasonForm kind="revert" label="Reverter para a versão anterior" />
              </>
            ) : <p className="muted">Não há versão anterior para voltar.</p>}
          </section>
        </>
      ) : null}

      <section aria-labelledby="versoes">
        <h2 id="versoes">Versões</h2>
        {overview.versions.length === 0 ? <p className="muted">Nenhuma versão ainda.</p> : (
          <table>
            <thead><tr><th scope="col">Versão</th><th scope="col">Situação</th><th scope="col">Criada por</th><th scope="col">Publicada em</th><th scope="col">Nota</th></tr></thead>
            <tbody>
              {overview.versions.map((v) => (
                <tr key={v.id}>
                  <th scope="row">{v.version}</th>
                  <td><span className={`badge ${v.status === 'PUBLISHED' ? 'ok' : v.status === 'DRAFT' ? 'warn' : 'muted'}`}>{STATUS_LABEL[v.status]}</span></td>
                  <td>{v.createdByName}</td>
                  <td>{v.publishedAt ? `${dateTimeBr(v.publishedAt)} por ${v.publishedByName}` : '—'}</td>
                  <td>{v.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="travados">
        <h2 id="travados">Blocos legais (travados)</h2>
        <p className="muted">Estes textos dependem de revisão jurídica e ficam no código. O editor não os altera.</p>
        {LOCKED_BLOCKS.map((b) => (
          <div className="card line" key={b.id}>
            <h3>{b.label} <span className="badge muted">Travado</span></h3>
            <p className="muted small">{b.where}</p>
            <p className="locked-text">{b.text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
