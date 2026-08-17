-- DropIndex
DROP INDEX "Message_conversationId_createdAt_idx";

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt" DESC, "id" DESC);
