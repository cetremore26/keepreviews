-- CreateEnum
CREATE TYPE "ImportMarketplace" AS ENUM ('ALIEXPRESS', 'AMAZON', 'ETSY', 'SHOPEE', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "ReviewSource" ADD VALUE 'IMPORTED';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "importDedupeKey" TEXT,
ADD COLUMN     "importMarketplace" "ImportMarketplace",
ADD COLUMN     "sourceCreatedAt" TIMESTAMP(3),
ADD COLUMN     "sourceReviewUrl" TEXT;

-- CreateTable
CREATE TABLE "ReviewImportBatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "marketplace" "ImportMarketplace" NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PROCESSING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedDuplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewImportBatch_shopId_createdAt_idx" ON "ReviewImportBatch"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_shopId_importDedupeKey_key" ON "Review"("shopId", "importDedupeKey");

