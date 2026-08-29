-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "reviewRequestDelayDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "reviewRequestsEnabled" BOOLEAN NOT NULL DEFAULT false;
