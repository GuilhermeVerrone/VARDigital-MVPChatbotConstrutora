-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "owner_broker_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_simulations" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "simulation_id" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "attached_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "simulation_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_phone_key" ON "crm_contacts"("phone");

-- CreateIndex
CREATE INDEX "crm_contacts_owner_broker_id_idx" ON "crm_contacts"("owner_broker_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_simulations_simulation_id_key" ON "crm_simulations"("simulation_id");

-- CreateIndex
CREATE INDEX "crm_simulations_contact_id_idx" ON "crm_simulations"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_jobs_dedupe_key_key" ON "delivery_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_available_at_idx" ON "delivery_jobs"("status", "available_at");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_owner_broker_id_fkey" FOREIGN KEY ("owner_broker_id") REFERENCES "brokers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_simulations" ADD CONSTRAINT "crm_simulations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
