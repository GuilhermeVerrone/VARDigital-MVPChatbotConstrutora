import { DEFAULT_TEXTS, OPTIONAL_STEPS, TEXT_KEYS, type FlowIssue, type TextKey } from '@mvp/conversation';
import type { FlowConfigContent } from '@mvp/db/panel';

// Formulário do editor do fluxo ↔ conteúdo do FlowConfig. Campo vazio = "usar o texto padrão do
// código", então só o que difere do padrão é gravado (o diff do rascunho fica pequeno e legível).

const EDITABLE: readonly TextKey[] = TEXT_KEYS.filter((k) => k !== 'FIRST_CONTACT');
export const EDITABLE_TEXT_KEYS = EDITABLE;

export type FlowFormValues = Record<string, string>;

const nl = (s: string) => s.replace(/\r\n?/g, '\n');

export function contentToValues(content: FlowConfigContent | null): FlowFormValues {
  const v: FlowFormValues = {};
  for (const key of EDITABLE) v[`text.${key}`] = content?.texts[key] ?? '';
  v.firstContact = content?.firstContact ?? '';
  for (const s of OPTIONAL_STEPS) v[`step.${s.key}`] = content?.optionalSteps[s.key] === false ? 'off' : 'on';
  for (const key of EDITABLE) v[`buttons.${key}`] = (content?.buttons[key] ?? []).join('\n');
  return v;
}

export function valuesToContent(values: FlowFormValues): FlowConfigContent {
  const texts: Record<string, string> = {};
  for (const key of EDITABLE) {
    const t = nl(values[`text.${key}`] ?? '').trim();
    if (t && t !== DEFAULT_TEXTS[key]) texts[key] = t;
  }
  const fc = nl(values.firstContact ?? '').trim();
  const optionalSteps: Record<string, boolean> = {};
  for (const s of OPTIONAL_STEPS) if (values[`step.${s.key}`] === 'off') optionalSteps[s.key] = false;
  const buttons: Record<string, string[]> = {};
  for (const key of EDITABLE) {
    const labels = nl(values[`buttons.${key}`] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (labels.length > 0) buttons[key] = labels;
  }
  return { texts, optionalSteps, buttons, firstContact: fc && fc !== DEFAULT_TEXTS.FIRST_CONTACT ? fc : null };
}

/** Caminho do linter (`texts.ASK_NAME`) → nome do campo do formulário (`text.ASK_NAME`). */
export function issueField(path: string): string {
  if (path.startsWith('texts.')) return `text.${path.slice(6)}`;
  if (path.startsWith('optionalSteps.')) return `step.${path.slice(14)}`;
  if (path.startsWith('buttons.')) return `buttons.${path.slice(8).split('.')[0]}`;
  return path;
}

/** Mensagem por campo (a primeira de cada), para o estado do formulário. */
export function issuesByField(issues: readonly FlowIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[issueField(i.path)] ??= i.message;
  return out;
}
