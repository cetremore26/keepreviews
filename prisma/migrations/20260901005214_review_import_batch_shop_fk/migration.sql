-- AddForeignKey
ALTER TABLE "ReviewImportBatch" ADD CONSTRAINT "ReviewImportBatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

