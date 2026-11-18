-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('scheduled', 'collected', 'canceled');

-- AlterTable
ALTER TABLE "PickupLocation" ADD COLUMN     "contactMobile" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Pickup" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "merchantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "addressText" TEXT NOT NULL,
    "areaId" UUID,
    "contactName" TEXT NOT NULL,
    "contactMobile" TEXT NOT NULL,
    "pickupDate" DATE NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'scheduled',
    "repeatWeekly" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" UUID,
    "collectedCount" INTEGER,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pickup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupOrder" (
    "pickupId" UUID NOT NULL,
    "orderId" UUID NOT NULL,

    CONSTRAINT "PickupOrder_pkey" PRIMARY KEY ("pickupId","orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pickup_number_key" ON "Pickup"("number");

-- CreateIndex
CREATE INDEX "Pickup_merchantId_status_pickupDate_idx" ON "Pickup"("merchantId", "status", "pickupDate");

-- CreateIndex
CREATE INDEX "Pickup_locationId_pickupDate_idx" ON "Pickup"("locationId", "pickupDate");

-- CreateIndex
CREATE INDEX "Pickup_pickupDate_status_idx" ON "Pickup"("pickupDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PickupOrder_orderId_key" ON "PickupOrder"("orderId");

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "PickupLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupOrder" ADD CONSTRAINT "PickupOrder_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupOrder" ADD CONSTRAINT "PickupOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
