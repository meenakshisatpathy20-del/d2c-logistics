-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE', 'VENDOR', 'COURIER');

-- CreateEnum
CREATE TYPE "CourierMode" AS ENUM ('DEMO', 'LIVE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('PREPAID', 'COD');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('MANUAL', 'CSV', 'OMS_GURU', 'API');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'READY_TO_SHIP', 'IN_TRANSIT', 'DELIVERED', 'NEEDS_ATTENTION', 'RTO', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('BOOKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NDR', 'RTO_INITIATED', 'RTO_DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'PICKED_UP', 'MISSED', 'POSTPONED', 'REASSIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'BRAND', 'SYSTEM');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL,
    "managerId" TEXT,
    "warehouseId" TEXT,
    "courierCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "cluster" TEXT,
    "isRtoLocation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Courier" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "CourierMode" NOT NULL DEFAULT 'DEMO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "pickupWarehouseId" TEXT NOT NULL,
    "rtoWarehouseId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL,
    "orderValue" DECIMAL(12,2) NOT NULL,
    "codAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "codConfirmed" BOOLEAN,
    "weightGrams" INTEGER NOT NULL,
    "lengthCm" INTEGER NOT NULL,
    "breadthCm" INTEGER NOT NULL,
    "heightCm" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "rtoRisk" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "awb" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT true,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'BOOKED',
    "chargedAmount" DECIMAL(12,2) NOT NULL,
    "chargedWeightG" INTEGER NOT NULL,
    "labelUrl" TEXT,
    "packingProofUrls" TEXT[],
    "expectedDelivery" TIMESTAMP(3),
    "pickupId" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "location" TEXT,
    "remark" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pickup" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "executiveName" TEXT,
    "executivePhone" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "missCount" INTEGER NOT NULL DEFAULT 0,
    "postponeReason" TEXT,
    "missReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedFlag" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "type" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "senderName" TEXT,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_brandId_phone_key" ON "User"("brandId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_brandId_code_key" ON "Warehouse"("brandId", "code");

-- CreateIndex
CREATE INDEX "Order_brandId_status_idx" ON "Order"("brandId", "status");

-- CreateIndex
CREATE INDEX "Order_customerPhone_idx" ON "Order"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Order_brandId_orderNumber_key" ON "Order"("brandId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_idempotencyKey_key" ON "Shipment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Shipment_brandId_status_idx" ON "Shipment"("brandId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_courierCode_awb_key" ON "Shipment"("courierCode", "awb");

-- CreateIndex
CREATE INDEX "TrackingEvent_shipmentId_occurredAt_idx" ON "TrackingEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "Pickup_brandId_slotStart_idx" ON "Pickup"("brandId", "slotStart");

-- CreateIndex
CREATE INDEX "Task_brandId_status_dueAt_idx" ON "Task"("brandId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "RedFlag_brandId_resolvedAt_idx" ON "RedFlag"("brandId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Message_orderId_createdAt_idx" ON "Message"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_brandId_entityType_entityId_idx" ON "AuditLog"("brandId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupWarehouseId_fkey" FOREIGN KEY ("pickupWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_rtoWarehouseId_fkey" FOREIGN KEY ("rtoWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_courierCode_fkey" FOREIGN KEY ("courierCode") REFERENCES "Courier"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_courierCode_fkey" FOREIGN KEY ("courierCode") REFERENCES "Courier"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
