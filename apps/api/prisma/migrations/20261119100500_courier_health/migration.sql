-- AlterTable
ALTER TABLE "Courier" ADD COLUMN     "failures24h" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastBookedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastFailedAt" TIMESTAMP(3),
ADD COLUMN     "simulateError" TEXT;

-- AlterTable
ALTER TABLE "RedFlag" ADD COLUMN     "courierCode" TEXT;

