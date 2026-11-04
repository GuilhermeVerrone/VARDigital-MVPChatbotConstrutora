-- Fase 7: handoff com código e corretor responsável, texto do consentimento, entregas por lead
-- (sem simulação) e pendências de exclusão no WA-AKG.

-- AlterTable
ALTER TABLE "consents" ADD COLUMN "text_snapshot" TEXT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "handoff_code" TEXT,
ADD COLUMN "handoff_at" TIMESTAMPTZ(3),
ADD COLUMN "taken_by_broker_id" UUID,
ADD COLUMN "taken_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "delivery_jobs" ALTER COLUMN "simulation_id" DROP NOT NULL,
ADD COLUMN "lead_id" UUID;

-- CreateTable
CREATE TABLE "erasure_tasks" (
    "id" UUID NOT NULL,
    "chat_id" TEXT,
    "reason" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "erasure_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_handoff_code_key" ON "conversations"("handoff_code");

-- CreateIndex
CREATE INDEX "conversations_taken_by_broker_id_idx" ON "conversations"("taken_by_broker_id");

-- CreateIndex
CREATE INDEX "delivery_jobs_lead_id_idx" ON "delivery_jobs"("lead_id");

-- CreateIndex
CREATE INDEX "erasure_tasks_done_at_idx" ON "erasure_tasks"("done_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_taken_by_broker_id_fkey" FOREIGN KEY ("taken_by_broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Todo job pertence a uma simulação ou a um lead.
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_target_check" CHECK ("simulation_id" IS NOT NULL OR "lead_id" IS NOT NULL);
