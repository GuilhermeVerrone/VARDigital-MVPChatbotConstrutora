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

/** Print real do produto dentro do visor. */
export function Print({ arquivo, alt, prioridade = false }: { arquivo: string; alt: string; prioridade?: boolean }) {
  const m = (medidas as Record<string, { w: number; h: number }>)[arquivo];
  if (!m) throw new Error(`print ${arquivo} não existe; rode pnpm vitrine:capturas`);
  return <img src={`/produto/${arquivo}.webp`} alt={alt} width={m.w} height={m.h} loading={prioridade ? 'eager' : 'lazy'} decoding="async" />;
}
