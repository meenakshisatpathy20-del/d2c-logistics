-- DropIndex
DROP INDEX "RedFlag_type_shipmentId_pickupId_key";

-- CreateIndex
CREATE INDEX "RedFlag_type_shipmentId_pickupId_idx" ON "RedFlag"("type", "shipmentId", "pickupId");

