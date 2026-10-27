// Roda uma simulação a partir de arquivos JSON, sem banco nem WhatsApp, para o financeiro
// conferir casos isoladamente.
//   pnpm --filter @mvp/simulation simulate packages/simulation/examples/lead-exemplo.json [parametros.json]
// Caminhos relativos ao diretório de onde o comando foi chamado.
// Sem o segundo argumento, usa o seed ILUSTRATIVO.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { illustrativeParameters, simulate } from '../src';

const [inputPath, paramsPath] = process.argv.slice(2);
if (!inputPath) {
  console.error('uso: simulate <entrada.json> [parametros.json]');
  process.exit(2);
}
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), path), 'utf8'));

try {
  const result = simulate(readJson(inputPath), paramsPath ? readJson(paramsPath) : illustrativeParameters);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
