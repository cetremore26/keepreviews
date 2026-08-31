-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");
