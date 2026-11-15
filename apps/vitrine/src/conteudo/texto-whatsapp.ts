// Formatação do WhatsApp (*negrito*, _itálico_) convertida em trechos, para o site mostrar as mensagens
// reais do bot como texto (não como imagem).

export type Trecho = { t: string; b?: boolean; i?: boolean };

export function trechos(linha: string): Trecho[] {
  const out: Trecho[] = [];
  const re = /\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  for (let m = re.exec(linha); m; m = re.exec(linha)) {
    if (m.index > last) out.push({ t: linha.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: m[1], b: true } : { t: m[2]!, i: true });
    last = m.index + m[0].length;
  }
  if (last < linha.length) out.push({ t: linha.slice(last) });
  return out;
}
