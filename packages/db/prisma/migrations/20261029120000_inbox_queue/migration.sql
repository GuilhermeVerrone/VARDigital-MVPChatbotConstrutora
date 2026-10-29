-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

-- AlterTable
ALTER TABLE "processed_messages"
    ADD COLUMN "chat_key" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "status" "InboxStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "payload" JSONB,
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "locked_until" TIMESTAMPTZ(3),
    ADD COLUMN "last_error" TEXT;

-- Linhas anteriores à fila não têm payload: já foram tratadas.
UPDATE "processed_messages" SET "status" = 'DONE';

ALTER TABLE "processed_messages" ALTER COLUMN "chat_key" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "processed_messages_status_available_at_idx" ON "processed_messages"("status", "available_at");

-- CreateIndex
CREATE INDEX "processed_messages_chat_key_received_at_idx" ON "processed_messages"("chat_key", "received_at");
