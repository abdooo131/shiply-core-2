-- CreateTable
CREATE TABLE "SavedView" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_userId_merchantId_idx" ON "SavedView"("userId", "merchantId");

-- CreateIndex
CREATE INDEX "Order_merchantId_updatedAt_idx" ON "Order"("merchantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Order_merchantId_customerMobile_idx" ON "Order"("merchantId", "customerMobile");
