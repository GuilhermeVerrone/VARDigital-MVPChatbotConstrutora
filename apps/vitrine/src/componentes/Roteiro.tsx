'use client';

import { useEffect, useState } from 'react';
import { demoSiteHref, demoWhatsappHref } from '@/conteudo/config';
import type { EtapaTeste } from '@/conteudo/roteiro';
import { Icone } from './Icone';

const CHAVE = 'construbot-roteiro';
interface Estado { feitos: string[]; parei: string | null }

function ler(): Estado {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Estado | null;
    if (v && Array.isArray(v.feitos)) return { feitos: v.feitos, parei: v.parei ?? null };
  } catch {
    /* sem armazenamento: começa do zero */
  }
  return { feitos: [], parei: null };
}

const href = (para: string): string | null => (para === 'site' ? demoSiteHref() : para === 'whatsapp' ? demoWhatsappHref() : para);

/** Roteiro com marcas pintadas: "feito" e "parei aqui". Lembra onde o visitante parou neste navegador. */
export function Roteiro({ etapas }: { etapas: EtapaTeste[] }) {
  const [estado, setEstado] = useState<Estado>({ feitos: [], parei: null });
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    const e = ler();
    setEstado(e);
    setPronto(true);
    if (e.parei) document.getElementById(`etapa-${e.parei}`)?.scrollIntoView({ block: 'start' });
  }, []);

  const salvar = (e: Estado) => {
    setEstado(e);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(e));
    } catch {
      /* armazenamento bloqueado: as marcas valem só nesta visita */
    }
  };
  const alternarFeito = (id: string) => {
    const feito = estado.feitos.includes(id);
    salvar({ feitos: feito ? estado.feitos.filter((x) => x !== id) : [...estado.feitos, id], parei: !feito && estado.parei === id ? null : estado.parei });
  };
  const alternarParei = (id: string) => salvar({ ...estado, parei: estado.parei === id ? null : id });
  const total = etapas.length;
  const feitos = etapas.filter((e) => estado.feitos.includes(e.id)).length;

  return (
    <>
      <div className="roteiro-progresso" aria-live="polite">
        <span>{pronto ? `${feitos} de ${total} feitos` : `${total} etapas`}</span>
        <span className="barra" aria-hidden="true"><i style={{ transform: `scaleX(${feitos / total})` }} /></span>
        {feitos > 0 || estado.parei ? (
          <button type="button" className="marca-botao" onClick={() => salvar({ feitos: [], parei: null })}>Recomeçar</button>
        ) : null}
      </div>
      <ol className="roteiro">
        {etapas.map((e, i) => {
          const feito = estado.feitos.includes(e.id);
          const parei = estado.parei === e.id;
          return (
            <li key={e.id} id={`etapa-${e.id}`} className="etapa-teste" data-feito={feito ? '' : undefined} data-parei={parei ? '' : undefined}>
              <span className="num" aria-hidden="true">{i + 1}</span>
              {feito ? <span className="carimbo" aria-hidden="true">FEITO</span> : parei ? <span className="carimbo parei" aria-hidden="true">PAREI AQUI</span> : null}
              <h3>{e.titulo}</h3>
              <ul className="passos-teste">{e.passos.map((p) => <li key={p}>{p}</li>)}</ul>
              <p className="espera"><strong>O que você deve ver:</strong> {e.espera}</p>
              <div className="marcas">
                {e.link && href(e.link.para) ? (
                  <a className="botao tinta pequeno" href={href(e.link.para)!}>{e.link.texto}<Icone nome="seta" tamanho={18} /></a>
                ) : null}
                <button type="button" className="marca-botao" aria-pressed={feito} onClick={() => alternarFeito(e.id)}>
                  <Icone nome="check" tamanho={18} />{feito ? 'Feito' : 'Marcar como feito'}
                </button>
                <button type="button" className="marca-botao parei" aria-pressed={parei} onClick={() => alternarParei(e.id)}>
                  <Icone nome="bandeira" tamanho={18} />Parei aqui
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
