-- AlterTable
ALTER TABLE "RedFlag" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "closesAt" INTEGER NOT NULL DEFAULT 19,
ADD COLUMN     "opensAt" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "saturdayClosesAt" INTEGER DEFAULT 16;

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

