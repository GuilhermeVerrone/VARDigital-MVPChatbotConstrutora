import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { illustrativeParameters } from '@mvp/simulation';
import { publishParameters } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await publishParameters(t.db, {
    params: illustrativeParameters,
    version: illustrativeParameters.version,
    validFrom: illustrativeParameters.validFrom,
    actor: 'teste',
    reason: 'base',
    today: '2026-10-27',
    allowRetroactive: true,
  });
});
afterAll(() => t.drop());

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));

describe('migrations', () => {
  it('criam as 11 entidades do plano (+ linhas de crédito por versão)', async () => {
    const { rows } = await t.sql(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
    expect(rows.map((r) => r.table_name)).toEqual([
      '_prisma_migrations',
      'audit_logs', // LogAuditoria
      'brokers', // Corretor
      'chat_sessions', // estado pré-consentimento (só hash)
      'consents', // Consentimento
      'conversations', // Conversa
      'credit_lines', // LinhaCredito
      'crm_contacts', // CRM simulado (Fase 6)
      'crm_simulations', // simulações anexadas ao contato
      'delivery_jobs', // fila de entregas de saída (CRM, corretor)
      'developments', // Empreendimento
      'financial_profiles', // PerfilFinanceiro
      'leads', // Lead
      'parameter_sets', // versão/vigência dos parâmetros
      'processed_messages', // MensagemProcessada
      'simulations', // Simulacao
      'units', // Unidade
    ]);
  });

  it('banco migrado = schema.prisma (sem drift)', () => {
    const out = execFileSync(
      `${PKG_DIR}/node_modules/.bin/prisma`,
      ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'],
      { cwd: PKG_DIR, env: { ...process.env, BOT_DATABASE_URL: t.url }, encoding: 'utf8', stdio: 'pipe' },
    );
    expect(out).toContain('This is an empty migration');
  });
});

describe('garantias no banco (independem da aplicação)', () => {
  const insertSet = (version: string, from: string, to: string | null) =>
    t.sql(
      `insert into parameter_sets (id, version, status, valid_from, valid_to, default_system, adjustment_tolerance_ratio, high_commitment_alert_ratio, informal_income_types, created_by)
       values (gen_random_uuid(), $1, 'ILUSTRATIVO', $2, $3, 'SAC', 0.1, 0.9, '{}', 'sql')`,
      [version, from, to],
    );

  it('recusa duas versões ativas com vigências sobrepostas', async () => {
    await expect(insertSet('sobreposta', '2026-06-01', '2026-06-30')).rejects.toThrow(/parameter_sets_no_overlap/);
  });

  it('recusa vigência invertida', async () => {
    await expect(insertSet('invertida', '2020-02-01', '2020-01-01')).rejects.toThrow(/parameter_sets_valid_range/);
  });

  it('versão é imutável: não altera taxa, status nem apaga', async () => {
    await expect(t.sql(`update credit_lines set annual_interest_rate = 0.2`)).rejects.toThrow(/somente inserção/);
    await expect(t.sql(`delete from credit_lines`)).rejects.toThrow(/somente inserção/);
    await expect(t.sql(`update parameter_sets set status = 'VALIDADO'`)).rejects.toThrow(/imutável/);
    await expect(t.sql(`update parameter_sets set adjustment_tolerance_ratio = 0.5`)).rejects.toThrow(/imutável/);
    await expect(t.sql(`delete from parameter_sets`)).rejects.toThrow(/não podem ser apagadas/);
  });

  it('log de auditoria é somente inserção', async () => {
    await expect(t.sql(`update audit_logs set actor = 'outro'`)).rejects.toThrow(/somente inserção/);
    await expect(t.sql(`delete from audit_logs`)).rejects.toThrow(/somente inserção/);
  });

  it('telefone do lead é único (deduplicação, RF-41)', async () => {
    await t.db.lead.create({ data: { phone: '5500911110000' } });
    await expect(t.db.lead.create({ data: { phone: '5500911110000' } })).rejects.toThrow(/Unique constraint/);
  });

  it('mensagem do canal é registrada uma única vez (idempotência por key.id)', async () => {
    const msg = { channel: 'WHATSAPP' as const, sessionId: 'piloto', externalId: '3EB0ABC', chatKey: '5500911110000@s.whatsapp.net' };
    await t.db.processedMessage.create({ data: msg });
    await expect(t.db.processedMessage.create({ data: msg })).rejects.toThrow(/Unique constraint/);
    // mesmo id em outra sessão é outra mensagem
    await t.db.processedMessage.create({ data: { ...msg, sessionId: 'outra' } });
  });
});
