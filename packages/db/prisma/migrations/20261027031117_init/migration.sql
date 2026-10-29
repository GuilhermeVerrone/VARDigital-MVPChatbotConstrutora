-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'SIMULATED', 'HANDOFF', 'DELIVERED', 'OPTED_OUT', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScoreClass" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('CLT', 'AUTONOMO', 'SERVIDOR', 'APOSENTADO', 'OUTROS');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD');

-- CreateEnum
CREATE TYPE "ParameterStatus" AS ENUM ('ILUSTRATIVO', 'VALIDADO');

-- CreateEnum
CREATE TYPE "AmortizationSystem" AS ENUM ('SAC', 'PRICE');

-- CreateEnum
CREATE TYPE "RateConvention" AS ENUM ('NOMINAL', 'EFFECTIVE');

-- CreateEnum
CREATE TYPE "AgeRule" AS ENUM ('OLDEST', 'YOUNGEST');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('VIAVEL', 'VIAVEL_COM_AJUSTES', 'INVIAVEL');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "channel_jid" TEXT,
    "email" TEXT,
    "birth_date" DATE,
    "origin" TEXT,
    "campaign" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "score" INTEGER,
    "score_class" "ScoreClass",
    "broker_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "text_version" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "state" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "history" JSONB NOT NULL DEFAULT '[]',
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_profiles" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "gross_monthly_income" DECIMAL(14,2) NOT NULL,
    "income_type" "IncomeType" NOT NULL,
    "monthly_debts" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "available_down_payment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fgts_balance" DECIMAL(14,2),
    "fgts_contribution_months" INTEGER,
    "owns_residential_property" BOOLEAN NOT NULL,
    "first_financing" BOOLEAN NOT NULL,
    "co_applicant_income" DECIMAL(14,2),
    "co_applicant_income_type" "IncomeType",
    "co_applicant_birth_date" DATE,
    "co_applicant_monthly_debts" DECIMAL(14,2),
    "co_applicant_fgts_balance" DECIMAL(14,2),
    "co_applicant_fgts_months" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developments" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "delivery_date" DATE NOT NULL,
    "faq" JSONB NOT NULL DEFAULT '[]',
    "materials" JSONB NOT NULL DEFAULT '[]',
    "signal_ratio" DECIMAL(5,4),
    "balloon_ratio" DECIMAL(5,4),
    "balloon_interval_months" INTEGER,
    "data_status" TEXT NOT NULL DEFAULT 'ILUSTRATIVO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "developments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "development_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "typology" TEXT NOT NULL,
    "area_m2" DECIMAL(8,2) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_sets" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ParameterStatus" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "default_system" "AmortizationSystem" NOT NULL,
    "adjustment_tolerance_ratio" DECIMAL(9,8) NOT NULL,
    "high_commitment_alert_ratio" DECIMAL(9,8) NOT NULL,
    "informal_income_types" "IncomeType"[],
    "based_on_id" UUID,
    "superseded_by_id" UUID,
    "created_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parameter_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_lines" (
    "id" UUID NOT NULL,
    "parameter_set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "max_family_income" DECIMAL(14,2),
    "max_property_value" DECIMAL(14,2),
    "requires_first_financing" BOOLEAN NOT NULL,
    "requires_no_owned_property" BOOLEAN NOT NULL,
    "max_ltv" DECIMAL(9,8) NOT NULL,
    "annual_interest_rate" DECIMAL(9,8) NOT NULL,
    "rate_convention" "RateConvention" NOT NULL,
    "max_income_commitment" DECIMAL(9,8) NOT NULL,
    "term_min_months" INTEGER NOT NULL,
    "term_max_months" INTEGER NOT NULL,
    "max_age_at_end_months" INTEGER NOT NULL,
    "age_rule" "AgeRule" NOT NULL,
    "systems" "AmortizationSystem"[],
    "mip_monthly_rate_by_age" JSONB NOT NULL,
    "dfi_monthly_rate" DECIMAL(12,10) NOT NULL,
    "admin_fee_monthly" DECIMAL(14,2) NOT NULL,
    "other_monthly_fees" JSONB NOT NULL DEFAULT '[]',
    "subsidy" JSONB,
    "fgts" JSONB NOT NULL,

    CONSTRAINT "credit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "unit_id" UUID,
    "credit_line_id" UUID,
    "system" "AmortizationSystem",
    "term_months" INTEGER,
    "reference_date" DATE NOT NULL,
    "property_value" DECIMAL(14,2) NOT NULL,
    "financed_amount" DECIMAL(14,2),
    "required_down_payment" DECIMAL(14,2),
    "subsidy" DECIMAL(14,2),
    "fgts_used" DECIMAL(14,2),
    "first_installment" DECIMAL(14,2),
    "last_installment" DECIMAL(14,2),
    "construction_flow" JSONB,
    "verdict" "Verdict" NOT NULL,
    "parameters_version" TEXT NOT NULL,
    "parameter_set_id" UUID NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "team" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB,
    "last_assigned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_messages" (
    "id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "lead_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_phone_key" ON "leads"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "leads_channel_jid_key" ON "leads"("channel_jid");

-- CreateIndex
CREATE INDEX "leads_broker_id_idx" ON "leads"("broker_id");

-- CreateIndex
CREATE INDEX "consents_lead_id_idx" ON "consents"("lead_id");

-- CreateIndex
CREATE INDEX "conversations_lead_id_idx" ON "conversations"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_profiles_lead_id_key" ON "financial_profiles"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "developments_slug_key" ON "developments"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "units_development_id_code_key" ON "units"("development_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_sets_version_key" ON "parameter_sets"("version");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_sets_superseded_by_id_key" ON "parameter_sets"("superseded_by_id");

-- CreateIndex
CREATE INDEX "parameter_sets_valid_from_idx" ON "parameter_sets"("valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "credit_lines_parameter_set_id_code_key" ON "credit_lines"("parameter_set_id", "code");

-- CreateIndex
CREATE INDEX "simulations_lead_id_idx" ON "simulations"("lead_id");

-- CreateIndex
CREATE INDEX "simulations_parameter_set_id_idx" ON "simulations"("parameter_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokers_phone_key" ON "brokers"("phone");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE UNIQUE INDEX "processed_messages_channel_session_id_external_id_key" ON "processed_messages"("channel", "session_id", "external_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_development_id_fkey" FOREIGN KEY ("development_id") REFERENCES "developments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_sets" ADD CONSTRAINT "parameter_sets_based_on_id_fkey" FOREIGN KEY ("based_on_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_sets" ADD CONSTRAINT "parameter_sets_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_lines" ADD CONSTRAINT "credit_lines_parameter_set_id_fkey" FOREIGN KEY ("parameter_set_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_credit_line_id_fkey" FOREIGN KEY ("credit_line_id") REFERENCES "credit_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_parameter_set_id_fkey" FOREIGN KEY ("parameter_set_id") REFERENCES "parameter_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantias que o Prisma não modela (escritas à mão).
-- ---------------------------------------------------------------------------

-- Vigência coerente e sem sobreposição entre versões ativas (não substituídas).
-- daterange '[]' = datas inclusivas; valid_to NULL = sem fim.
ALTER TABLE "parameter_sets"
  ADD CONSTRAINT "parameter_sets_valid_range" CHECK ("valid_to" IS NULL OR "valid_from" <= "valid_to");
ALTER TABLE "parameter_sets"
  ADD CONSTRAINT "parameter_sets_no_overlap"
  EXCLUDE USING gist (daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("superseded_by_id" IS NULL)
  -- Adiada até o commit: substituir uma versão (mesma data de início) insere a nova antes de
  -- marcar a antiga como substituída, dentro da mesma transação.
  DEFERRABLE INITIALLY DEFERRED;

-- Versão de parâmetros é imutável: só o fim da vigência e a substituição podem mudar.
CREATE FUNCTION "parameter_sets_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'parameter_sets é histórico: versões não podem ser apagadas';
  END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'superseded_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'superseded_by_id') THEN
    RAISE EXCEPTION 'parameter_sets é imutável: crie uma nova versão (só valid_to e superseded_by_id podem mudar)';
  END IF;
  IF OLD."superseded_by_id" IS NOT NULL AND NEW."superseded_by_id" IS DISTINCT FROM OLD."superseded_by_id" THEN
    RAISE EXCEPTION 'versão já substituída não pode ser alterada';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "parameter_sets_guard" BEFORE UPDATE OR DELETE ON "parameter_sets"
  FOR EACH ROW EXECUTE FUNCTION "parameter_sets_guard"();

CREATE FUNCTION "reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% é somente inserção (% bloqueado)', TG_TABLE_NAME, TG_OP;
END $$;
-- Linhas de crédito pertencem a uma versão imutável.
CREATE TRIGGER "credit_lines_immutable" BEFORE UPDATE OR DELETE ON "credit_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_change"();
-- Log de auditoria: só inserção (RF-52).
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_change"();
