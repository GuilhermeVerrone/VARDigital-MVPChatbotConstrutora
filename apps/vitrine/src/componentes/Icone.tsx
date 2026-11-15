// Ícones desenhados para o site (traço 2px, cantos retos, mesma grade de 24px).

type Nome = 'seta' | 'check' | 'bandeira' | 'aviso' | 'documento' | 'mais' | 'balao' | 'fora';

const PATHS: Record<Nome, React.ReactNode> = {
  seta: <path d="M4 12h15M13 6l6 6-6 6" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  bandeira: <><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></>,
  aviso: <><path d="M12 3.5L22 20H2L12 3.5z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  documento: <><path d="M6 2.5h8l4 4V21.5H6z" /><path d="M14 2.5v4h4M9 12h6M9 16h6" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  balao: <path d="M4 5h16v11H10l-4 3.5V16H4z" />,
  fora: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>,
};

export function Icone({ nome, tamanho = 22, className }: { nome: Nome; tamanho?: number; className?: string }) {
  return (
    <svg className={className} width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      {PATHS[nome]}
    </svg>
  );
}

/** Marca do ConstruBot: balão de conversa recortado como uma chave de obra. */
export function Marca({ tamanho = 30 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="3" fill="#f5c400" />
      <path d="M7 8h18v12H15l-5 4.5V20H7z" fill="#141414" />
      <path d="M12 14.2h8" stroke="#f5c400" strokeWidth="2.4" />
    </svg>
  );
}
