-- AlterTable
ALTER TABLE "RedFlag" ADD COLUMN     "courierContactId" TEXT,
ADD COLUMN     "faultParty" TEXT,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "promiseAt" TIMESTAMP(3),
ADD COLUMN     "promiseText" TEXT,
ADD COLUMN     "promisesBroken" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "raisedById" TEXT,
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waitingOn" TEXT,
ADD COLUMN     "waitingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "flagId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorParty" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "via" TEXT,
    "promiseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierContact" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "courierCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "region" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueEvent_flagId_createdAt_idx" ON "IssueEvent"("flagId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierContact_brandId_courierCode_idx" ON "CourierContact"("brandId", "courierCode");

-- AddForeignKey
ALTER TABLE "RedFlag" ADD CONSTRAINT "RedFlag_courierContactId_fkey" FOREIGN KEY ("courierContactId") REFERENCES "CourierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "RedFlag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

