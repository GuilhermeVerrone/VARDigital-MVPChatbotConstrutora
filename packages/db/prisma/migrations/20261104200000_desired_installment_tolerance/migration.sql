-- V2 / Fase 10: folga da parcela desejada sai do código (simulate.ts) e vira parâmetro com vigência
-- (06-check §3.4). As versões já gravadas recebem o valor que estava fixo no código (0,15); depois o
-- default é removido, para toda versão nova informar o valor explicitamente.
-- ADD COLUMN não dispara o gatilho de imutabilidade (parameter_sets_guard é de UPDATE por linha).

-- AlterTable
ALTER TABLE "parameter_sets" ADD COLUMN "desired_installment_tolerance_ratio" DECIMAL(9,8) NOT NULL DEFAULT 0.15;
ALTER TABLE "parameter_sets" ALTER COLUMN "desired_installment_tolerance_ratio" DROP DEFAULT;
