-- CreateTable
CREATE TABLE "yookassa_payments" (
    "id" TEXT NOT NULL,
    "yookassaPaymentId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "emailOrId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "userId" INTEGER,
    "grantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yookassa_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yookassa_payments_yookassaPaymentId_key" ON "yookassa_payments"("yookassaPaymentId");

-- CreateIndex
CREATE INDEX "yookassa_payments_yookassaPaymentId_idx" ON "yookassa_payments"("yookassaPaymentId");

-- CreateIndex
CREATE INDEX "yookassa_payments_status_idx" ON "yookassa_payments"("status");
