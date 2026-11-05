// Depois do `next build`: nenhum dado pessoal, segredo ou conexão com o banco pode estar no que vai ao navegador
// (.next/static e os arquivos públicos). Falha com a lista do que achou.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['.next/static', 'public'];
const SECRETS = [process.env.SITE_FORM_SECRET, process.env.SITE_DATABASE_URL, process.env.SITE_WHATSAPP_NUMBER].filter((v) => v && v.length >= 8);
const PATTERNS = [
  [/postgres(ql)?:\/\//i, 'string de conexão do Postgres'],
  [/SITE_(FORM_SECRET|DATABASE_URL)|BOT_DATABASE_URL|WA_AKG_|ANTHROPIC_API_KEY/, 'nome de variável secreta'],
  [/@prisma\/(client|adapter-pg)|PrismaClient/, 'cliente do banco'],
  [/\b55\d{2}9\d{8}\b/, 'telefone no formato do lead'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'chave da Anthropic'],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|css|html|json|map|txt|svg)$/.test(name)) yield p;
  }
}

const found = [];
let scanned = 0;
for (const root of roots) {
  for (const f of files(root)) {
    scanned++;
    const text = readFileSync(f, 'utf8');
    for (const s of SECRETS) if (text.includes(s)) found.push(`${f}: contém um valor de variável de ambiente do servidor`);
    for (const [re, label] of PATTERNS) if (re.test(text)) found.push(`${f}: ${label}`);
  }
}
if (scanned === 0) {
  console.error('nenhum arquivo para verificar: rode `next build` antes');
  process.exit(2);
}
if (found.length) {
  console.error(`vazamento no bundle do cliente:\n- ${found.join('\n- ')}`);
  process.exit(1);
}
console.log(`bundle do cliente limpo (${scanned} arquivos verificados)`);
