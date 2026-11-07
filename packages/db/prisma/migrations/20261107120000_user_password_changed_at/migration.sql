-- V2 / Fase 18: data em que o próprio usuário trocou a senha. Nulo = senha definida pelo seed ou pelo
-- admin, e o painel pede a troca. Migration aditiva.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMPTZ(3);
