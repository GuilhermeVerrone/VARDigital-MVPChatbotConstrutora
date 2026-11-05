import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  discardPanelFlowDraft, FlowConfigError, getFlowOverview, getPublishedFlowConfig, PanelValidationError, publishFlowConfig, revertFlowConfig, saveFlowDraft,
} from '../src/panel-entry';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());

const U = 'painel-user';
const NOW = new Date('2026-11-05T15:00:00Z');
const publish = async (texts: Record<string, string>, reason = 'ajuste') => {
  const draft = await saveFlowDraft(t.db, { actor: U, content: { texts } });
  return publishFlowConfig(t.db, draft.id, { actor: U, reason, now: NOW });
};

describe('fluxo: rascunho, publicar e reverter', () => {
  it('sem versão publicada o bot usa o código; salvar cria o rascunho e salvar de novo edita o mesmo', async () => {
    let o = await getFlowOverview(t.db);
    expect(o).toMatchObject({ published: null, draft: null, versions: [], canRevert: false });
    const first = await saveFlowDraft(t.db, { actor: U, content: { texts: { ASK_NAME: 'Oi! Seu nome?' } } });
    const second = await saveFlowDraft(t.db, { actor: U, content: { texts: { ASK_NAME: 'Olá! Qual o seu nome?' } } });
    expect(second.id).toBe(first.id);
    o = await getFlowOverview(t.db);
    expect(o.draft?.content.texts.ASK_NAME).toBe('Olá! Qual o seu nome?');
    expect(await getPublishedFlowConfig(t.db)).toBeNull();
    expect(await t.db.flowConfig.count()).toBe(1);
  });

  it('publicar põe o texto no ar para a próxima leitura do bot e audita quem publicou', async () => {
    const v1 = await publish({ ASK_NAME: 'Olá! Qual o seu nome?' }, 'primeira versão');
    expect((await getPublishedFlowConfig(t.db))?.content.texts.ASK_NAME).toBe('Olá! Qual o seu nome?');
    expect(await t.db.auditLog.findFirstOrThrow({ where: { entityId: v1.id, action: 'FLOW_PUBLISHED' } })).toMatchObject({ actor: U, reason: 'primeira versão' });
    const o = await getFlowOverview(t.db);
    expect(o.draft).toBeNull();
    expect(o.versions[0]).toMatchObject({ status: 'PUBLISHED', publishedByName: U });
    expect(o.canRevert).toBe(false);
  });

  it('publicar sem mudança ou sem motivo é recusado', async () => {
    const draft = await saveFlowDraft(t.db, { actor: U, content: { texts: { ASK_NAME: 'Olá! Qual o seu nome?' } } });
    await expect(publishFlowConfig(t.db, draft.id, { actor: U, reason: 'x', now: NOW })).rejects.toThrow(/nada mudou/);
    await expect(publishFlowConfig(t.db, draft.id, { actor: U, reason: ' ', now: NOW })).rejects.toBeInstanceOf(FlowConfigError);
    await discardPanelFlowDraft(t.db, { actor: U });
    expect((await getFlowOverview(t.db)).draft).toBeNull();
    expect(await t.db.auditLog.count({ where: { action: 'FLOW_DRAFT_DISCARDED' } })).toBe(1);
  });

  it('reverter volta ao conteúdo da versão anterior como uma versão nova, sem reabrir a antiga', async () => {
    const v2 = await publish({ ASK_NAME: 'Qual seu nome completo?' }, 'v2');
    expect((await getFlowOverview(t.db)).canRevert).toBe(true);
    const v3 = await revertFlowConfig(t.db, { actor: U, reason: 'texto ruim', now: NOW });
    expect(v3.version).toBeGreaterThan(v2.version);
    expect(v3.status).toBe('PUBLISHED');
    expect(v3.content.texts.ASK_NAME).toBe('Olá! Qual o seu nome?');
    expect((await getPublishedFlowConfig(t.db))?.id).toBe(v3.id);
    expect(await t.db.flowConfig.findUniqueOrThrow({ where: { id: v2.id } })).toMatchObject({ status: 'RETIRED' });
    expect(await t.db.auditLog.findFirstOrThrow({ where: { entityId: v3.id, action: 'FLOW_REVERTED' } })).toMatchObject({ actor: U, reason: 'texto ruim' });
    await expect(revertFlowConfig(t.db, { actor: U, reason: ' ', now: NOW })).rejects.toBeInstanceOf(FlowConfigError);
  });

  it('um rascunho em edição sobrevive à reversão', async () => {
    await saveFlowDraft(t.db, { actor: U, content: { texts: { ASK_NAME: 'Rascunho novo' } } });
    await revertFlowConfig(t.db, { actor: U, reason: 'voltar de novo', now: NOW });
    expect((await getFlowOverview(t.db)).draft?.content.texts.ASK_NAME).toBe('Rascunho novo');
  });

  it('conteúdo fora do formato é recusado; sem versão anterior não reverte', async () => {
    await expect(saveFlowDraft(t.db, { actor: U, content: { texts: { ASK_NAME: '' } } })).rejects.toBeInstanceOf(PanelValidationError);
    const t2 = await createTestDb();
    try {
      await expect(revertFlowConfig(t2.db, { actor: U, reason: 'x', now: NOW })).rejects.toThrow(/não há versão publicada/);
      const d = await saveFlowDraft(t2.db, { actor: U, content: {} });
      await expect(saveFlowDraft(t2.db, { actor: U, content: 'lixo' })).rejects.toBeInstanceOf(PanelValidationError);
      await publishFlowConfig(t2.db, d.id, { actor: U, reason: 'x', now: NOW });
      await expect(revertFlowConfig(t2.db, { actor: U, reason: 'x', now: NOW })).rejects.toThrow(/não há versão anterior/);
    } finally {
      await t2.drop();
    }
  });
});
