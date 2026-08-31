-- CreateTable
CREATE TABLE "StorageUsage" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "lastAlertAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageUsage_pkey" PRIMARY KEY ("id")
);
