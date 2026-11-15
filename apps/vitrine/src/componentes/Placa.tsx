import type { ReactNode } from 'react';

/** Placa de obra: chapa clara, faixa de título e grade rígida de campos. */
export function Placa({ titulo, campos, rodape, children, className, comoTitulo = true }: {
  titulo: string;
  /** false quando a placa enfeita uma área que já tem o próprio título (ex.: a abertura). */
  comoTitulo?: boolean;
  campos?: readonly (readonly [string, ReactNode])[];
  rodape?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`placa${className ? ` ${className}` : ''}`} aria-label={titulo}>
      {comoTitulo ? <h3 className="placa-titulo">{titulo}</h3> : <p className="placa-titulo">{titulo}</p>}
      {campos ? (
        <dl className="placa-campos">
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo}><dt>{rotulo}</dt><dd>{valor}</dd></div>
          ))}
        </dl>
      ) : null}
      {children}
      {rodape ? <p className="placa-rodape">{rodape}</p> : null}
    </section>
  );
}
