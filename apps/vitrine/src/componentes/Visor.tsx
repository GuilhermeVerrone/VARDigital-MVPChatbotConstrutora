import type { ReactNode } from 'react';
import medidas from '@/conteudo/prints.json';

/**
 * Janela recortada no tapume: fita zebrada, caixilho de compensado com parafusos e o "vidro" com o
 * produto. A legenda costura a imagem à sua prova (de onde ela veio).
 */
export function Visor({ children, origem, detalhe, className }: { children: ReactNode; origem: string; detalhe?: string; className?: string }) {
  return (
    <figure className={`visor-figura${className ? ` ${className}` : ''}`} style={{ margin: 0 }}>
      <div className="visor">
        <div className="visor-caixilho">
          <div className="visor-vidro">{children}</div>
        </div>
      </div>
      <figcaption className="visor-legenda">
        <strong>{origem}</strong>
        {detalhe ? <span>{detalhe}</span> : null}
      </figcaption>
    </figure>
  );
}

/** Print real do produto dentro do visor. Com `ampliar`, o print abre em tamanho real (útil no celular). */
export function Print({ arquivo, alt, prioridade = false, ampliar = false }: { arquivo: string; alt: string; prioridade?: boolean; ampliar?: boolean }) {
  const m = (medidas as Record<string, { w: number; h: number }>)[arquivo];
  if (!m) throw new Error(`print ${arquivo} não existe; rode pnpm vitrine:capturas`);
  const img = <img src={`/produto/${arquivo}.webp`} alt={alt} width={m.w} height={m.h} loading={prioridade ? 'eager' : 'lazy'} decoding="async" />;
  return ampliar ? <a className="ampliar" href={`/produto/${arquivo}.webp`} target="_blank" rel="noopener" aria-label={`${alt} Abrir em tamanho real.`}>{img}</a> : img;
}

/** Aviso, só no celular, de que o print abre em tamanho real. */
export function DicaAmpliar() {
  return <span className="ampliar-dica">Toque no print para ver em tamanho real</span>;
}
