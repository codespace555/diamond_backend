-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT', 'USER');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'BET_PLACE', 'BET_SETTLE', 'BET_REFUND', 'ORDER_PLACE', 'ORDER_CANCEL', 'ORDER_SETTLE', 'EXPOSURE_LOCK', 'EXPOSURE_RELEASE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'SUSPENDED', 'CLOSED', 'SETTLED');

-- CreateEnum
CREATE TYPE "BetType" AS ENUM ('BACK', 'LAY');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BACK', 'LAY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PARTIAL', 'MATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BET', 'WIN', 'LOSS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "parentId" TEXT,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "exposure" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" "LedgerType" NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "teamA" TEXT NOT NULL,
    "teamB" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'UPCOMING',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'OPEN',
    "winnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runner" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backOdds" DECIMAL(10,2) NOT NULL,
    "layOdds" DECIMAL(10,2) NOT NULL,
    "isWinner" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "type" "BetType" NOT NULL,
    "odds" DECIMAL(10,2) NOT NULL,
    "stake" DECIMAL(15,2) NOT NULL,
    "liability" DECIMAL(15,2) NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'PENDING',
    "payout" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stake" DECIMAL(15,2) NOT NULL,
    "matchedStake" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "remainingStake" DECIMAL(15,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "lockedExposure" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "backOrderId" TEXT NOT NULL,
    "layOrderId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stake" DECIMAL(15,2) NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "exposureAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceOdds" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "referenceBackPrice" DECIMAL(10,2) NOT NULL,
    "referenceLayPrice" DECIMAL(10,2) NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceOdds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "thumbnail" TEXT,
    "launchUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "balanceBefore" DECIMAL(15,2) NOT NULL,
    "balanceAfter" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'INFO',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_parentId_idx" ON "User"("parentId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isBanned_idx" ON "User"("isBanned");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Ledger_userId_createdAt_idx" ON "Ledger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Ledger_type_idx" ON "Ledger"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_startTime_idx" ON "Match"("startTime");

-- CreateIndex
CREATE INDEX "Match_externalId_idx" ON "Match"("externalId");

-- CreateIndex
CREATE INDEX "Market_matchId_idx" ON "Market"("matchId");

-- CreateIndex
CREATE INDEX "Market_status_idx" ON "Market"("status");

-- CreateIndex
CREATE INDEX "Runner_marketId_idx" ON "Runner"("marketId");

-- CreateIndex
CREATE INDEX "Bet_userId_idx" ON "Bet"("userId");

-- CreateIndex
CREATE INDEX "Bet_matchId_idx" ON "Bet"("matchId");

-- CreateIndex
CREATE INDEX "Bet_status_idx" ON "Bet"("status");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_marketId_idx" ON "Order"("marketId");

-- CreateIndex
CREATE INDEX "Order_selectionId_idx" ON "Order"("selectionId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_side_price_createdAt_idx" ON "Order"("side", "price", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_backOrderId_idx" ON "Trade"("backOrderId");

-- CreateIndex
CREATE INDEX "Trade_layOrderId_idx" ON "Trade"("layOrderId");

-- CreateIndex
CREATE INDEX "Trade_selectionId_idx" ON "Trade"("selectionId");

-- CreateIndex
CREATE INDEX "Trade_settled_idx" ON "Trade"("settled");

-- CreateIndex
CREATE INDEX "MarketExposure_userId_idx" ON "MarketExposure"("userId");

-- CreateIndex
CREATE INDEX "MarketExposure_marketId_idx" ON "MarketExposure"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketExposure_userId_marketId_key" ON "MarketExposure"("userId", "marketId");

-- CreateIndex
CREATE INDEX "ReferenceOdds_marketId_idx" ON "ReferenceOdds"("marketId");

-- CreateIndex
CREATE INDEX "ReferenceOdds_selectionId_idx" ON "ReferenceOdds"("selectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceOdds_marketId_selectionId_key" ON "ReferenceOdds"("marketId", "selectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_slug_key" ON "Game"("slug");

-- CreateIndex
CREATE INDEX "Game_category_idx" ON "Game"("category");

-- CreateIndex
CREATE INDEX "CasinoTransaction_userId_idx" ON "CasinoTransaction"("userId");

-- CreateIndex
CREATE INDEX "CasinoTransaction_gameId_idx" ON "CasinoTransaction"("gameId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Runner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runner" ADD CONSTRAINT "Runner_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_backOrderId_fkey" FOREIGN KEY ("backOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_layOrderId_fkey" FOREIGN KEY ("layOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Runner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketExposure" ADD CONSTRAINT "MarketExposure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketExposure" ADD CONSTRAINT "MarketExposure_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceOdds" ADD CONSTRAINT "ReferenceOdds_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceOdds" ADD CONSTRAINT "ReferenceOdds_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTransaction" ADD CONSTRAINT "CasinoTransaction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
