-- V2 / Fase 11: dados da V2 (migration aditiva; ver docs/v2/03-impactos.md §3).
-- Novos: sales_conditions (versionada, imutável), flow_configs (rascunho -> publicada), users e
-- user_sessions. Campos novos em leads, simulations, financial_profiles e developments.
-- Únicas mudanças em colunas existentes: simulations.parameters_version e parameter_set_id passam a
-- aceitar nulo (o modo à vista e a estimativa do banco desligada não usam parâmetros do banco).
-- delivery_jobs.kind é texto: FIRST_CONTACT não precisa de migration.

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('SITE_FORM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA');

-- CreateEnum
CREATE TYPE "FlowConfigStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'GERENTE', 'CORRETOR');

-- AlterTable
ALTER TABLE "developments" ADD COLUMN     "address" TEXT,
ADD COLUMN     "gallery" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "hero_image" TEXT,
ADD COLUMN     "highlights" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "financial_profiles" ADD COLUMN     "accepts_balloons" BOOLEAN,
ADD COLUMN     "cash_now" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contact_confirmed_at" TIMESTAMPTZ(3),
ADD COLUMN     "development_id" UUID,
ADD COLUMN     "form_submitted_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_mode" "PaymentMode",
ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "utm" JSONB;

-- AlterTable
ALTER TABLE "simulations" ADD COLUMN     "bank_estimate" JSONB,
ADD COLUMN     "down_payment_plan" JSONB,
ADD COLUMN     "payment_mode" "PaymentMode",
ADD COLUMN     "sales_condition_id" UUID,
ALTER COLUMN "parameters_version" DROP NOT NULL,
ALTER COLUMN "parameter_set_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sales_conditions" (
    "id" UUID NOT NULL,
    "development_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ParameterStatus" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "rules" JSONB NOT NULL,
    "based_on_id" UUID,
    "superseded_by_id" UUID,
    "created_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_configs" (
    "id" UUID NOT NULL,
    "version" SERIAL NOT NULL,
    "status" "FlowConfigStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "based_on_id" UUID,
    "created_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "published_by" TEXT,

    CONSTRAINT "flow_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "broker_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_conditions_version_key" ON "sales_conditions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "sales_conditions_superseded_by_id_key" ON "sales_conditions"("superseded_by_id");

-- CreateIndex
CREATE INDEX "sales_conditions_development_id_valid_from_idx" ON "sales_conditions"("development_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "flow_configs_version_key" ON "flow_configs"("version");

-- CreateIndex
CREATE INDEX "flow_configs_status_idx" ON "flow_configs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_broker_id_key" ON "users"("broker_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "leads_development_id_idx" ON "leads"("development_id");

-- CreateIndex
CREATE INDEX "simulations_sales_condition_id_idx" ON "simulations"("sales_condition_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "developments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_conditions" ADD CONSTRAINT "sales_conditions_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "developments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_conditions" ADD CONSTRAINT "sales_conditions_based_on_id_fkey" FOREIGN KEY ("based_on_id") REFERENCES "sales_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_conditions" ADD CONSTRAINT "sales_conditions_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "sales_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_configs" ADD CONSTRAINT "flow_configs_based_on_id_fkey" FOREIGN KEY ("based_on_id") REFERENCES "flow_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_sales_condition_id_fkey" FOREIGN KEY ("sales_condition_id") REFERENCES "sales_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Garantias que o Prisma não modela (escritas à mão).
-- ---------------------------------------------------------------------------

-- Condição comercial: mesma regra dos parâmetros, mas uma linha do tempo POR empreendimento.
-- A igualdade de development_id em índice GiST exige btree_gist (extensão "trusted" no PG 13+).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "sales_conditions"
  ADD CONSTRAINT "sales_conditions_valid_range" CHECK ("valid_to" IS NULL OR "valid_from" <= "valid_to");
ALTER TABLE "sales_conditions"
  ADD CONSTRAINT "sales_conditions_no_overlap"
  EXCLUDE USING gist ("development_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("superseded_by_id" IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

-- Versão imutável: só o fim da vigência e a substituição podem mudar; não se apaga.
CREATE FUNCTION "sales_conditions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales_conditions é histórico: versões não podem ser apagadas';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'superseded_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'superseded_by_id') THEN
    RAISE EXCEPTION 'sales_conditions é imutável: crie uma nova versão (só valid_to e superseded_by_id podem mudar)';
  END IF;
  IF OLD."superseded_by_id" IS NOT NULL AND NEW."superseded_by_id" IS DISTINCT FROM OLD."superseded_by_id" THEN
    RAISE EXCEPTION 'versão já substituída não pode ser alterada';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "sales_conditions_guard" BEFORE UPDATE OR DELETE ON "sales_conditions"
  FOR EACH ROW EXECUTE FUNCTION "sales_conditions_guard"();

-- Fluxo do bot: rascunho é editável e apagável; publicada só pode virar RETIRED (nada mais muda);
-- RETIRED é definitiva.
CREATE FUNCTION "flow_configs_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'flow_configs publicada é histórico: não pode ser apagada';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED'
     AND (to_jsonb(NEW) - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'flow_configs publicada é imutável: crie um rascunho novo e publique';
END $$;
CREATE TRIGGER "flow_configs_guard" BEFORE UPDATE OR DELETE ON "flow_configs"
  FOR EACH ROW EXECUTE FUNCTION "flow_configs_guard"();
