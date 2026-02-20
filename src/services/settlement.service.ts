// src/services/settlement.service.ts
//
// Runs every minute via cron.
// 1. Polls The Odds API scores endpoint for completed events.
// 2. Marks winning/losing selections.
// 3. Settles all unsettled Trades, updating wallet balances.

import { prisma } from "@/configs";
import { myEnvironment } from "@/configs/env.config";
import { Prisma } from "@/generated/prisma/client";
import axios from "axios";

const ODDS_API_KEY = myEnvironment.ODDS_API_KEY;
const ODDS_API_BASE = myEnvironment.ODDS_API_URL;

interface OddsApiScore {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}

export class SettlementService {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    console.log("[SettlementService] Starting — runs every 60 seconds");
    this.intervalId = setInterval(() => this.run(), 60_000);
    this.run(); // immediate first run
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async run(): Promise<void> {
    try {
      await this.checkAndSettleCompletedMatches();
    } catch (err) {
      console.error("[SettlementService] Error during settlement run:", err);
    }
  }

  // ----------------------------------------------------------------
  private async checkAndSettleCompletedMatches(): Promise<void> {
    // Find all LIVE matches that have an externalId
    const liveMatches = await prisma.match.findMany({
      where: {
        status: { in: ["LIVE", "UPCOMING"] },
        externalId: { not: null },
      },
      select: { id: true, externalId: true, sport: true },
    });

    if (liveMatches.length === 0) return;

    // Group by sport to minimise API calls
    const sports = [...new Set(liveMatches.map((m) => m.sport))];

    for (const sport of sports) {
      let scores: OddsApiScore[] = [];

      try {
        const res = await axios.get<OddsApiScore[]>(
          `${ODDS_API_BASE}/sports/${sport}/scores/`,
          { params: { apiKey: ODDS_API_KEY, daysFrom: 1 } },
        );
        scores = res.data;
      } catch (err) {
        console.warn(
          `[SettlementService] Could not fetch scores for ${sport}:`,
          err,
        );
        continue;
      }

      const completedMap = new Map(
        scores.filter((s) => s.completed && s.scores).map((s) => [s.id, s]),
      );

      const sportMatches = liveMatches.filter((m) => m.sport === sport);

      for (const match of sportMatches) {
        const apiEvent = completedMap.get(match.externalId!);
        if (!apiEvent) continue;

        await this.settleMatch(match.id, apiEvent);
      }
    }
  }

  // ----------------------------------------------------------------
  private async settleMatch(
    matchId: string,
    event: OddsApiScore,
  ): Promise<void> {
    // Determine winner from scores
    if (!event.scores || event.scores.length < 2) return;

    const [teamA, teamB] = event.scores;
    const teamAScore = parseInt(teamA.score, 10);
    const teamBScore = parseInt(teamB.score, 10);

    let winnerName: string | null = null;
    if (teamAScore > teamBScore) winnerName = teamA.name;
    else if (teamBScore > teamAScore) winnerName = teamB.name;
    // draw = winnerName stays null

    await prisma.$transaction(async (tx) => {
      // 1. Mark match COMPLETED
      await tx.match.update({
        where: { id: matchId },
        data: { status: "COMPLETED" },
      });

      // 2. Find all open markets for this match
      const markets = await tx.market.findMany({
        where: { matchId, status: { in: ["OPEN", "SUSPENDED"] } },
        include: { runners: true },
      });

      for (const market of markets) {
        // 3. Mark market SETTLED
        await tx.market.update({
          where: { id: market.id },
          data: { status: "SETTLED" },
        });

        // 4. Determine winning runner (Match Odds market)
        for (const runner of market.runners) {
          const isWinner =
            winnerName !== null &&
            runner.name.toLowerCase() === winnerName.toLowerCase();

          await tx.runner.update({
            where: { id: runner.id },
            data: { isWinner },
          });
        }

        // 5. Settle all unsettled trades in this market
        const unsettledTrades = await tx.trade.findMany({
          where: {
            selectionId: { in: market.runners.map((r) => r.id) },
            settled: false,
          },
          include: {
            backOrder: true,
            layOrder: true,
            selection: true,
          },
        });

        for (const trade of unsettledTrades) {
          if (trade.selection.isWinner === null) {
            // Draw — refund both sides
            await this.refundTrade(tx, trade);
          } else if (trade.selection.isWinner) {
            // BACK wins
            await this.settleTrade(tx, trade, "BACK_WINS");
          } else {
            // LAY wins
            await this.settleTrade(tx, trade, "LAY_WINS");
          }
        }

        // 6. Cancel remaining OPEN/PARTIAL orders and release exposure
        await this.cancelOpenOrders(tx, market.id);
      }
    });

    console.log(`[SettlementService] Settled match ${matchId}`);
  }

  // ----------------------------------------------------------------
  private async settleTrade(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    trade: {
      id: string;
      price: Prisma.Decimal;
      stake: Prisma.Decimal;
      backOrder: { userId: string; marketId: string };
      layOrder: { userId: string; marketId: string };
    },
    outcome: "BACK_WINS" | "LAY_WINS",
  ): Promise<void> {
    const profit = trade.price.minus(1).mul(trade.stake); // BACK profit formula
    const backUserId = trade.backOrder.userId;
    const layUserId = trade.layOrder.userId;
    const marketId = trade.backOrder.marketId;

    if (outcome === "BACK_WINS") {
      // BACK receives: stake (returned) + profit
      const backPayout = trade.stake.plus(profit);
      await this.creditWallet(
        tx,
        backUserId,
        backPayout,
        marketId,
        `Bet won: trade ${trade.id}`,
      );
      // LAY loses their liability (already locked as exposure, just release it and don't return)
      await this.releaseExposure(tx, layUserId, marketId, profit);
    } else {
      // LAY wins: receives the back staker's stake
      await this.creditWallet(
        tx,
        layUserId,
        trade.stake,
        marketId,
        `Lay won: trade ${trade.id}`,
      );
      // BACK loses stake (already deducted on order placement)
      await this.releaseExposure(tx, backUserId, marketId, trade.stake);
    }

    await tx.trade.update({
      where: { id: trade.id },
      data: { settled: true, settledAt: new Date() },
    });
  }

  private async refundTrade(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    trade: {
      id: string;
      price: Prisma.Decimal;
      stake: Prisma.Decimal;
      backOrder: { userId: string; marketId: string };
      layOrder: { userId: string; marketId: string };
    },
  ): Promise<void> {
    const marketId = trade.backOrder.marketId;

    // Refund BACK stake
    await this.creditWallet(
      tx,
      trade.backOrder.userId,
      trade.stake,
      marketId,
      `Refund (draw): trade ${trade.id}`,
    );
    // Refund LAY liability
    const layLiability = trade.price.minus(1).mul(trade.stake);
    await this.creditWallet(
      tx,
      trade.layOrder.userId,
      layLiability,
      marketId,
      `Refund (draw): trade ${trade.id}`,
    );

    await tx.trade.update({
      where: { id: trade.id },
      data: { settled: true, settledAt: new Date() },
    });
  }

  private async creditWallet(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    amount: Prisma.Decimal,
    marketId: string,
    notes: string,
  ): Promise<void> {
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });

    await tx.ledger.create({
      data: {
        userId,
        amount,
        type: "ORDER_SETTLE",
        balance: wallet.balance,
        notes,
      },
    });
  }

  private async releaseExposure(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    marketId: string,
    amount: Prisma.Decimal,
  ): Promise<void> {
    // Decrement global wallet exposure
    await tx.wallet.update({
      where: { userId },
      data: { exposure: { decrement: amount } },
    });

    // Decrement per-market exposure record
    await tx.marketExposure.updateMany({
      where: { userId, marketId },
      data: { exposureAmount: { decrement: amount } },
    });
  }

  private async cancelOpenOrders(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    marketId: string,
  ): Promise<void> {
    const openOrders = await tx.order.findMany({
      where: { marketId, status: { in: ["OPEN", "PARTIAL"] } },
    });

    for (const order of openOrders) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });

      // Release the exposure for remaining unmatched stake
      let exposureToRelease: Prisma.Decimal;
      if (order.side === "BACK") {
        exposureToRelease = order.remainingStake;
      } else {
        exposureToRelease = order.price.minus(1).mul(order.remainingStake);
      }

      await tx.wallet.update({
        where: { userId: order.userId },
        data: { exposure: { decrement: exposureToRelease } },
      });

      await tx.marketExposure.updateMany({
        where: { userId: order.userId, marketId },
        data: { exposureAmount: { decrement: exposureToRelease } },
      });

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: order.userId },
      });

      await tx.ledger.create({
        data: {
          userId: order.userId,
          amount: exposureToRelease,
          type: "EXPOSURE_RELEASE",
          balance: wallet.balance,
          notes: `Order cancelled on market close: ${order.id}`,
        },
      });
    }
  }
}

export const settlementService = new SettlementService();
