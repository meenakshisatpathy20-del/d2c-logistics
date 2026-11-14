-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "advanceStatus" TEXT,
ADD COLUMN     "codAdvance" DECIMAL(12,2) NOT NULL DEFAULT 0;

