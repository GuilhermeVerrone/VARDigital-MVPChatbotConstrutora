// Tokens da identidade Elevare, migrados de elevare-construtora/css/style.css. Fonte única para o site
// (Fase 13) e o painel (Fases 14-15). O mesmo conjunto vive em tokens.css; o teste garante que não divergem.

export const colors = {
  green: '#0F3D36',
  green80: '#3F635D',
  green60: '#6F8B86',
  green12: '#DCE0D5',
  green06: '#E8EAE0',
  lime: '#B5D86A',
  lime30: '#E1EBC3',
  coral: '#F4623A',
  paper: '#F3F1E7',
  white: '#FBFAF5',
} as const;

export const layout = { radius: '4px', wrap: '1200px' } as const;

export const fontFamily = '"Inter", "Helvetica Neue", Arial, system-ui, sans-serif';

/** Variável CSS de cada token de cor (--green-80 etc.). */
export const cssVar = (name: keyof typeof colors): string => `--${name.replace(/(\d+)$/, '-$1')}`;
