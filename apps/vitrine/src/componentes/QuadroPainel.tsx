'use client';

import { ListaDeAbas, useAbas } from './Abas';
import { DicaAmpliar, Print, Visor } from './Visor';

export interface TelaPainel { arquivo: string; titulo: string; resumo: string; texto: string; alt: string }

/** Quadro de avisos com as telas do painel: escolher um aviso troca o print no visor. */
export function QuadroPainel({ telas }: { telas: TelaPainel[] }) {
  const { atual, aba, painel } = useAbas(telas.length);
  const t = telas[atual]!;
  return (
    <div className="quadro">
      <ListaDeAbas rotulo="Telas do painel" className="quadro-itens">
        {telas.map((x, i) => (
          <button key={x.arquivo} className="quadro-item" {...aba(i)}>
            <strong>{x.titulo}</strong>
            <span>{x.resumo}</span>
          </button>
        ))}
      </ListaDeAbas>
      <div className="quadro-visor" {...painel}>
        <Visor origem="Print real do painel" detalhe="Construtora e valores de exemplo">
          <Print key={t.arquivo} arquivo={t.arquivo} alt={t.alt} ampliar />
        </Visor>
        <DicaAmpliar />
        <p className="quadro-texto">{t.texto}</p>
      </div>
    </div>
  );
}
