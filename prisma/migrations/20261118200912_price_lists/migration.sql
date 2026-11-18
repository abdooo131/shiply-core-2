-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('small', 'medium', 'large', 'light_bulky', 'heavy_bulky');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('deliver', 'pick_and_choose', 'exchange', 'return', 'sign_and_return', 'cash_collection');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('pending', 'active', 'retired', 'replaced');

-- CreateTable
CREATE TABLE "PriceList" (
    "id" UUID NOT NULL,
    "merchantId" UUID,
    "version" INTEGER NOT NULL,
    "status" "PriceListStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListLine" (
    "priceListId" UUID NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "size" "PackageSize" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "shippingPiasters" INTEGER NOT NULL,

    CONSTRAINT "PriceListLine_pkey" PRIMARY KEY ("priceListId","zoneCode","size","orderType")
);

-- CreateTable
CREATE TABLE "ActivePriceList" (
    "scope" TEXT NOT NULL,
    "priceListId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivePriceList_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE INDEX "PriceList_merchantId_status_idx" ON "PriceList"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ActivePriceList_priceListId_key" ON "ActivePriceList"("priceListId");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListLine" ADD CONSTRAINT "PriceListLine_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListLine" ADD CONSTRAINT "PriceListLine_zoneCode_fkey" FOREIGN KEY ("zoneCode") REFERENCES "PricingZone"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivePriceList" ADD CONSTRAINT "ActivePriceList_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
