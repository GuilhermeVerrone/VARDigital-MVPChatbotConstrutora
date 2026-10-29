import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Prompt {
  name: string;
  version: number;
  text: string;
  /** SHA-256 curto do texto, para registrar exatamente o que foi usado. */
  hash: string;
}

/** Carrega `prompts/<name>.v<version>.md`. Versões antigas ficam no repositório. */
export function loadPrompt(dir: string, name: string, version: number): Prompt {
  const text = readFileSync(join(dir, `${name}.v${version}.md`), 'utf8').trim();
  return { name, version, text, hash: createHash('sha256').update(text).digest('hex').slice(0, 12) };
}
