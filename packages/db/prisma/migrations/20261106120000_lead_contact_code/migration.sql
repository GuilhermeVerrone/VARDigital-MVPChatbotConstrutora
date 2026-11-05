-- V2 / Fase 12: código curto do lead do formulário (ELV-4821), para casar o lead quando a resposta
-- no WhatsApp vem de um endereço @lid em vez do telefone. Migration aditiva.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contact_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_contact_code_key" ON "leads"("contact_code");
