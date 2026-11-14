-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "productBrand" TEXT;

-- AlterTable
ALTER TABLE "RedFlag" ADD COLUMN     "action" TEXT,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "pickupId" TEXT,
ADD COLUMN     "title" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "etaDays" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE UNIQUE INDEX "Pickup_warehouseId_courierCode_slotStart_key" ON "Pickup"("warehouseId", "courierCode", "slotStart");

-- CreateIndex
CREATE UNIQUE INDEX "RedFlag_type_shipmentId_pickupId_key" ON "RedFlag"("type", "shipmentId", "pickupId");

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
