-- Adds the Shopify review apps a merchant can migrate away from, and splits
-- the storefront's sort key (displayedAt) out of createdAt so a migration
-- import lands in the merchant's real timeline instead of collapsing onto
-- the second the CSV was uploaded.

-- AlterEnum
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PostgreSQL 12+
-- (Render runs 14+). The new values are not referenced by any statement in
-- this migration, which is the other restriction that rule carries.
ALTER TYPE "ImportMarketplace" ADD VALUE 'JUDGE_ME';
ALTER TYPE "ImportMarketplace" ADD VALUE 'LOOX';
ALTER TYPE "ImportMarketplace" ADD VALUE 'STAMPED';
ALTER TYPE "ImportMarketplace" ADD VALUE 'FERA';
ALTER TYPE "ImportMarketplace" ADD VALUE 'ALI_REVIEWS';
ALTER TYPE "ImportMarketplace" ADD VALUE 'YOTPO';
ALTER TYPE "ImportMarketplace" ADD VALUE 'OKENDO';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN "displayedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Backfill: existing rows keep the exact order they have today. Imported
-- rows that carry a source date adopt it; everything else keeps createdAt,
-- so no already-visible review moves as a result of this migration.
UPDATE "Review" SET "displayedAt" = COALESCE("sourceCreatedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Review_shopId_productId_status_displayedAt_idx" ON "Review"("shopId", "productId", "status", "displayedAt");
