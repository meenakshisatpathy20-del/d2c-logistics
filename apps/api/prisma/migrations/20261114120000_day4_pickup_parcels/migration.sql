-- AlterTable
ALTER TABLE "Pickup" ADD COLUMN     "movedToId" TEXT,
ADD COLUMN     "parcelCount" INTEGER NOT NULL DEFAULT 0;
