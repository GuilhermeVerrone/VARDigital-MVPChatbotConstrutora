// Lê largura e altura dos prints WebP (cabeçalho VP8, VP8L ou VP8X) e grava src/conteudo/prints.json,
// para a página reservar o espaço certo de cada imagem. Rodado ao fim de `pnpm vitrine:capturas`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '../public/produto');
function medir(buf) {
  const tipo = buf.toString('ascii', 12, 16);
  if (tipo === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (tipo === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (tipo === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`formato WebP desconhecido: ${tipo}`);
}
const medidas = Object.fromEntries(
  readdirSync(dir).filter((f) => f.endsWith('.webp')).sort().map((f) => [f.replace(/\.webp$/, ''), medir(readFileSync(join(dir, f)))]),
);
writeFileSync(join(import.meta.dirname, '../src/conteudo/prints.json'), `${JSON.stringify(medidas, null, 2)}\n`);
console.log(`${Object.keys(medidas).length} prints medidos`);
