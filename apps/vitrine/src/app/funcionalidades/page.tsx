import type { Metadata } from 'next';
import Link from 'next/link';
import { Conversa } from '@/componentes/Conversa';
import { Icone } from '@/componentes/Icone';
import { Print, Visor } from '@/componentes/Visor';
import { PRODUTO } from '@/conteudo/config';
import { conversa } from '@/conteudo/conversas';
import { FUNCIONALIDADES, type Funcionalidade } from '@/conteudo/funcionalidades';

export const metadata: Metadata = {
  title: 'Funcionalidades',
  description: `Tudo o que o ${PRODUTO} faz, do formulário do site ao painel da construtora, com o passo a passo e as telas reais.`,
};

function Mensagens({ f }: { f: Funcionalidade }) {
  if (!f.conversa) return null;
  const c = conversa(f.conversa.id);
  const todas = f.conversa.corretor ? (c.corretor ?? []) : c.mensagens;
  const trecho = todas.slice(f.conversa.de ?? 0, f.conversa.ate);
  return (
    <Visor origem={f.conversa.legenda} detalhe="Construtora e valores de exemplo">
      <Conversa
        mensagens={trecho}
        titulo={f.conversa.corretor ? PRODUTO : 'Elevare Construtora'}
        subtitulo={f.conversa.corretor ? 'Para o corretor' : c.nome}
        rotulo={f.conversa.legenda}
      />
    </Visor>
  );
}

export default function Funcionalidades() {
  return (
    <>
      <section className="tapume cabeca-leitura" aria-labelledby="titulo">
        <div className="faixa">
          <h1 id="titulo">Tudo o que o {PRODUTO} faz.</h1>
          <p>Do formulário do site ao painel da construtora: para que serve cada parte, quem usa e o passo a passo, com as telas reais do produto.</p>
        </div>
      </section>
      <div className="leitura sobre-chapa">
        <div className="faixa">
          <nav className="indice" aria-label="Funcionalidades">
            <h2>Nesta página</h2>
            <ol>
              {FUNCIONALIDADES.map((f) => <li key={f.id}><a href={`#${f.id}`}>{f.titulo}</a></li>)}
            </ol>
          </nav>
          <div>
            {FUNCIONALIDADES.map((f) => (
              <article key={f.id} id={f.id} className="funcionalidade" aria-labelledby={`${f.id}-t`}>
                <h2 id={`${f.id}-t`}>{f.titulo}</h2>
                <ul className="quem" aria-label="Quem usa">{f.quem.map((q) => <li key={q}>{q}</li>)}</ul>
                <p>{f.resumo}</p>
                <ol className="etapas">{f.passos.map((p) => <li key={p}><span>{p}</span></li>)}</ol>
                <div className={`prints${(f.prints?.length ?? 0) + (f.conversa ? 1 : 0) > 1 ? ' dois' : ''}`}>
                  <Mensagens f={f} />
                  {f.prints?.map((p) => (
                    <Visor key={p.arquivo} origem={p.legenda} detalhe="Print real · dados de exemplo">
                      <Print arquivo={p.arquivo} alt={p.alt} />
                    </Visor>
                  ))}
                </div>
                {f.dica ? <p className="dica"><strong>Bom saber.</strong> {f.dica}</p> : null}
              </article>
            ))}
            <p><Link className="botao tinta" href="/testar/">Testar a demonstração<Icone nome="seta" /></Link></p>
          </div>
        </div>
      </div>
    </>
  );
}
