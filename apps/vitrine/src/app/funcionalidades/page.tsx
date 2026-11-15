import type { Metadata } from 'next';
import Link from 'next/link';
import { Conversa } from '@/componentes/Conversa';
import { Icone } from '@/componentes/Icone';
import { DicaAmpliar, Print, Visor } from '@/componentes/Visor';
import medidas from '@/conteudo/prints.json';
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

/** Print alto (celular, PDF) vai ao lado dos passos; print largo (tela do painel) ocupa a largura toda. */
const alto = (arquivo: string) => {
  const m = (medidas as Record<string, { w: number; h: number }>)[arquivo];
  return !!m && m.h > m.w;
};

export default function Funcionalidades() {
  return (
    <>
      <section className="tapume cabeca-leitura" aria-labelledby="titulo">
        <div className="faixa">
          <h1 id="titulo">Tudo o que o {PRODUTO} faz.</h1>
          <p>Do formulário do site ao painel da construtora: para que serve cada parte, quem usa e o passo a passo, com as telas reais do produto.</p>
        </div>
      </section>
      <div className="tapume leitura">
        <div className="faixa">
          <nav className="indice" aria-label="Funcionalidades">
            <h2>Nesta página</h2>
            <ol>
              {FUNCIONALIDADES.map((f) => <li key={f.id}><a href={`#${f.id}`}>{f.titulo}</a></li>)}
            </ol>
          </nav>
          <div className="folha">
            {FUNCIONALIDADES.map((f) => {
              const lado = (f.prints ?? []).filter((p) => alto(p.arquivo));
              const largos = (f.prints ?? []).filter((p) => !alto(p.arquivo));
              const temLado = lado.length > 0 || !!f.conversa;
              return (
                <article key={f.id} id={f.id} className="funcionalidade" aria-labelledby={`${f.id}-t`}>
                  <h2 id={`${f.id}-t`}>{f.titulo}</h2>
                  <ul className="quem" aria-label="Quem usa">{f.quem.map((q) => <li key={q}>{q}</li>)}</ul>
                  <p>{f.resumo}</p>
                  <div className={`func-corpo${temLado ? ' com-lado' : ''}`}>
                    <ol className="etapas">{f.passos.map((p) => <li key={p}><span>{p}</span></li>)}</ol>
                    {temLado ? (
                      <div className="prints">
                        <Mensagens f={f} />
                        {lado.map((p) => (
                          <Visor key={p.arquivo} origem={p.legenda} detalhe="Print real · dados de exemplo">
                            <Print arquivo={p.arquivo} alt={p.alt} ampliar />
                          </Visor>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {largos.length ? (
                    <div className="prints">
                      {largos.map((p) => (
                        <div key={p.arquivo}>
                          <Visor origem={p.legenda} detalhe="Print real · dados de exemplo">
                            <Print arquivo={p.arquivo} alt={p.alt} ampliar />
                          </Visor>
                          <DicaAmpliar />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {f.dica ? <p className="dica"><strong>Bom saber.</strong> {f.dica}</p> : null}
                </article>
              );
            })}
            <p><Link className="botao tinta" href="/testar/">Testar a demonstração<Icone nome="seta" /></Link></p>
          </div>
        </div>
      </div>
    </>
  );
}
