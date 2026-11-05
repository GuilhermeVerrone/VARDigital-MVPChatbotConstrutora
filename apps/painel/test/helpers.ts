// Atalhos de teste: o painel importa o banco só pela entrada `@mvp/db/panel`; o seed e a criação de
// usuário vêm do pacote completo, que só os testes usam.
export { createUser, seedElevare } from '@mvp/db';
export { listAuditLogs } from '@mvp/db/panel';
import { seedElevare } from '@mvp/db';
import type { Db } from '@mvp/db/panel';

export const seedElevareForTest = (db: Db, today: string) => seedElevare(db, { today });
