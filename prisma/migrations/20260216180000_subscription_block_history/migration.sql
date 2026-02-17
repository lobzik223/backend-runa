-- CreateTable
CREATE TABLE "subscription_history" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_history" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "reason" TEXT,
    "unblockedAt" TIMESTAMP(3),

    CONSTRAINT "block_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_history_userId_createdAt_idx" ON "subscription_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "block_history_userId_idx" ON "block_history"("userId");

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_history" ADD CONSTRAINT "block_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
