-- CreateTable
CREATE TABLE "PricingZone" (
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PricingZone_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "governorateCode" TEXT NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL,
    "isServed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_zoneCode_idx" ON "Area"("zoneCode");

-- CreateIndex
CREATE UNIQUE INDEX "Area_governorateCode_nameEn_key" ON "Area"("governorateCode", "nameEn");

-- CreateIndex
CREATE INDEX "PickupLocation_areaId_idx" ON "PickupLocation"("areaId");

-- AddForeignKey
ALTER TABLE "PickupLocation" ADD CONSTRAINT "PickupLocation_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_governorateCode_fkey" FOREIGN KEY ("governorateCode") REFERENCES "Governorate"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_zoneCode_fkey" FOREIGN KEY ("zoneCode") REFERENCES "PricingZone"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
