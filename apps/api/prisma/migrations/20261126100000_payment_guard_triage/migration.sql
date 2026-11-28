-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "payees" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentCheckedAt" TIMESTAMP(3),
ADD COLUMN     "paymentNote" TEXT,
ADD COLUMN     "paymentStatus" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "method" TEXT,
    "payee" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "courierCode" TEXT,
    "sender" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "refs" TEXT[],
    "kind" TEXT NOT NULL,
    "issueType" TEXT,
    "promiseAt" TIMESTAMP(3),
    "flagIds" TEXT[],
    "unmatched" TEXT[],
    "readBy" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_brandId_orderNumber_idx" ON "Payment"("brandId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_brandId_reference_key" ON "Payment"("brandId", "reference");

-- CreateIndex
CREATE INDEX "ChatMessage_brandId_sentAt_idx" ON "ChatMessage"("brandId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_brandId_hash_key" ON "ChatMessage"("brandId", "hash");
