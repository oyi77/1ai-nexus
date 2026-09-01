-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Watchlist_userId_symbol_market_key" ON "Watchlist"("userId", "symbol", "market");
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
