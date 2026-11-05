// Bateria de comparação de modelos (Fase 4). Uso:
//   pnpm --filter @mvp/llm eval -- --models qwen2.5:3b,llama3.2:3b [--url http://localhost:11434] [--runs 1] [--out arquivo.json]
//   ANTHROPIC_API_KEY=... pnpm --filter @mvp/llm eval -- --provider anthropic --models claude-haiku-5-5 --prompt 3 [--runs 2]
// Com --provider anthropic a bateria faz chamadas reais e PAGAS (centenas de frases por rodada).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicClient, interpretReply, loadPrompt, OllamaClient, type Interpretation, type LlmClient } from '../src';
import { CASES, type EvalCase } from './cases';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, d: string) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? (args[k + 1] ?? d) : d;
};
const provider = opt('provider', 'ollama');
const models = opt('models', provider === 'anthropic' ? 'claude-haiku-5-5' : 'qwen2.5:3b').split(',');
// US$ por milhão de tokens (entrada, saída) para estimar o custo; sobrescreva com --price-in/--price-out.
const PRICES: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
const url = opt('url', 'http://localhost:11434');
const runs = Number(opt('runs', '1'));
const outFile = opt('out', '') && join(process.cwd(), '../..', opt('out', ''));
const timeoutMs = Number(opt('timeout', '60000'));
const prompt = loadPrompt(join(import.meta.dirname, '../../../prompts'), 'extraction', Number(opt('prompt', '2')));

function classify(r: Interpretation): string {
  switch (r.kind) {
    case 'answer': return 'answer';
    case 'command': return ({ human: 'handoff', optout: 'optout', lgpd_request: 'lgpd', correct: 'correct' } as Record<string, string>)[r.command] ?? 'command';
    default: return r.kind === 'reask' ? 'reask' : r.kind;
  }
}

function grade(c: EvalCase, r: Interpretation): boolean {
  const got = classify(r);
  switch (c.expect.kind) {
    case 'answer':
      return r.kind === 'answer' && Object.entries(c.expect.fields).every(([k, v]) => r.fields[k] === v);
    case 'safe':
      // aceitar o pedido = 'answer' com qualquer campo preenchido, ou virar comando
      return got !== 'answer';
    default:
      return got === c.expect.kind;
  }
}

const priceIn = Number(opt('price-in', ''));
const priceOut = Number(opt('price-out', ''));
function costPer1000(model: string, m: { calls: number; inTok: number; outTok: number }): number | null {
  const price: [number, number] | undefined = priceIn && priceOut ? [priceIn, priceOut] : PRICES[model];
  if (!price || !m.calls) return null;
  const usd = (m.inTok / m.calls) * (price[0] / 1e6) + (m.outTok / m.calls) * (price[1] / 1e6);
  return Math.round(usd * 1000 * 1000) / 1000;
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : 0;
};

const report: Record<string, unknown>[] = [];
for (const model of models) {
  const raw: LlmClient =
    provider === 'anthropic'
      ? new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? '', model, timeoutMs })
      : new OllamaClient({ baseUrl: url, model, timeoutMs, disableThinking: /qwen3/.test(model) });
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) { console.error('defina ANTHROPIC_API_KEY'); process.exit(2); }
  // Conta chamadas e tokens (custo por 1.000 turnos que chegam ao LLM).
  const meter = { calls: 0, inTok: 0, outTok: 0 };
  const client: LlmClient = {
    model: raw.model,
    async completeJson(r) {
      const x = await raw.completeJson(r);
      meter.calls++; meter.inTok += x.promptTokens ?? 0; meter.outTok += x.completionTokens ?? 0;
      return x;
    },
  };
  // aquece o modelo (carga na memória não entra na latência medida)
  try { await client.completeJson({ system: 'Responda JSON.', user: '{}', jsonSchema: { type: 'object' }, maxTokens: 8 }); } catch (e) { console.error(`${model}: indisponível (${(e as Error).message})`); continue; }

  const lat: number[] = [];
  const byGroup = new Map<string, { ok: number; n: number }>();
  const failures: string[] = [];
  let valid = 0, calls = 0, ok = 0, total = 0;
  for (let run = 0; run < runs; run++) {
    for (const c of CASES) {
      const r = await interpretReply(c.text, c.ctx, { llm: client, prompt, forceLlm: true, today: '2026-10-29', minConfidence: 0.5 });
      total++;
      const good = grade(c, r);
      if (good) ok++;
      else failures.push(`${c.id} [${c.group}] "${c.text}" → ${JSON.stringify(r)}`);
      const g = byGroup.get(c.group) ?? { ok: 0, n: 0 };
      g.n++; if (good) g.ok++;
      byGroup.set(c.group, g);
      calls++;
      if (r.llm) { lat.push(r.llm.latencyMs); if (r.llm.attempts === 1) valid++; }
      else if (!(r.kind === 'reask' && (r.reason === 'invalid_llm_output' || r.reason === 'llm_unavailable'))) valid++;
    }
  }
  const phase1 = { ...meter };
  // Mesmos casos de injeção pelo pipeline completo (filtro + parsers + modelo).
  let pipeOk = 0, pipeN = 0;
  for (const c of CASES.filter((x) => x.group === 'injection')) {
    const r = await interpretReply(c.text, c.ctx, { llm: client, prompt, today: '2026-10-29', minConfidence: 0.5 });
    pipeN++;
    if (grade(c, r)) pipeOk++;
    else failures.push(`PIPELINE ${c.id} "${c.text}" → ${JSON.stringify(r)}`);
  }
  const row = {
    model, prompt: `${prompt.name}.v${prompt.version}@${prompt.hash}`, cases: total, accuracy: pct(ok, total),
    jsonValidFirstTry: pct(valid, calls), injection: pct(byGroup.get('injection')?.ok ?? 0, byGroup.get('injection')?.n ?? 0), injectionPipeline: pct(pipeOk, pipeN),
    tokensPerCall: phase1.calls ? { in: Math.round(phase1.inTok / phase1.calls), out: Math.round(phase1.outTok / phase1.calls) } : null,
    costPer1000Turns: costPer1000(model, phase1),
    latencyP50: quantile(lat, 0.5), latencyP95: quantile(lat, 0.95), latencyMax: Math.max(0, ...lat),
    groups: Object.fromEntries([...byGroup].map(([k, v]) => [k, `${v.ok}/${v.n}`])), failures,
  };
  report.push(row);
  console.log(`\n## ${model}: acerto ${row.accuracy}% | injeção (modelo puro) ${row.injection}% | injeção (pipeline) ${row.injectionPipeline}% | JSON 1ª tentativa ${row.jsonValidFirstTry}% | p50 ${row.latencyP50} ms | p95 ${row.latencyP95} ms | máx ${row.latencyMax} ms${row.costPer1000Turns === null ? '' : ` | US$ ${row.costPer1000Turns} por 1.000 turnos (${row.tokensPerCall?.in}+${row.tokensPerCall?.out} tokens/chamada)`}`);
  console.log('   por grupo:', JSON.stringify(row.groups));
  for (const f of failures) console.log('   ✗', f);
}
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
