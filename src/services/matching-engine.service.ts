// src/services/matching.engine.ts
//
// Price-Time priority matching engine for the internal exchange.
// All operations run inside the caller's Prisma transaction to
// guarantee consistency.  Never call this service outside a $transaction.

import { Prisma, PrismaClient } from "@/generated/prisma/client";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface MatchResult {
  matchedStake: Prisma.Decimal;
  remainingStake: Prisma.Decimal;
  trades: { tradeId: string; price: Prisma.Decimal; stake: Prisma.Decimal }[];
}

/**
 * Match an incoming BACK order against open LAY orders.
 *
 * Matching rule:
 *   - Find LAY orders on same selection where layPrice <= backPrice
 *   - Sort: lowest price first, then oldest first (price-time priority)
 */
export async function matchBackOrder(
  tx: Tx,
  incomingOrderId: string,
  selectionId: string,
  backPrice: Prisma.Decimal,
  stakeToMatch: Prisma.Decimal,
): Promise<MatchResult> {
  const trades: MatchResult["trades"] = [];
  let remaining = stakeToMatch;

  // Fetch candidate lay orders with a FOR UPDATE lock to prevent races
  const candidates = await tx.$queryRaw<
    {
      id: string;
      price: string;
      remainingStake: string;
      userId: string;
    }[]
  >`
    SELECT id, price::text, "remainingStake"::text AS "remainingStake", "userId"
    FROM "Order"
    WHERE "selectionId" = ${selectionId}
      AND side = 'LAY'
      AND status IN ('OPEN', 'PARTIAL')
      AND price <= ${backPrice}
    ORDER BY price ASC, "createdAt" ASC
    FOR UPDATE SKIP LOCKED
  `;

  for (const candidate of candidates) {
    if (remaining.lte(0)) break;

    const candidateRemaining = new Prisma.Decimal(candidate.remainingStake);
    const candidatePrice = new Prisma.Decimal(candidate.price);
    const tradeStake = remaining.lt(candidateRemaining)
      ? remaining
      : candidateRemaining;

    // Create trade record
    const trade = await tx.trade.create({
      data: {
        backOrderId: incomingOrderId,
        layOrderId: candidate.id,
        selectionId,
        price: candidatePrice,
        stake: tradeStake,
      },
    });

    trades.push({
      tradeId: trade.id,
      price: candidatePrice,
      stake: tradeStake,
    });

    // Update lay order
    const newCandidateRemaining = candidateRemaining.minus(tradeStake);
    const newCandidateMatched = await tx.order
      .findUniqueOrThrow({ where: { id: candidate.id } })
      .then((o) => o.matchedStake.plus(tradeStake));

    const newCandidateStatus = newCandidateRemaining.lte(0)
      ? "MATCHED"
      : "PARTIAL";

    await tx.order.update({
      where: { id: candidate.id },
      data: {
        matchedStake: newCandidateMatched,
        remainingStake: newCandidateRemaining,
        status: newCandidateStatus,
      },
    });

    // Release exposure on the lay side for matched portion
    // LAY exposure = (price - 1) * stake
    const layExposureReleased = candidatePrice.minus(1).mul(tradeStake);
    await adjustExposure(
      tx,
      candidate.userId,
      // We need the marketId – fetch from order relation
      await tx.order
        .findUniqueOrThrow({ where: { id: candidate.id } })
        .then((o) => o.marketId),
      layExposureReleased.neg(), // negative = release
    );

    remaining = remaining.minus(tradeStake);
  }

  const matchedStake = stakeToMatch.minus(remaining);
  return { matchedStake, remainingStake: remaining, trades };
}

/**
 * Match an incoming LAY order against open BACK orders.
 *
 * Matching rule:
 *   - Find BACK orders on same selection where backPrice >= layPrice
 *   - Sort: highest price first, then oldest first
 */
export async function matchLayOrder(
  tx: Tx,
  incomingOrderId: string,
  selectionId: string,
  layPrice: Prisma.Decimal,
  stakeToMatch: Prisma.Decimal,
): Promise<MatchResult> {
  const trades: MatchResult["trades"] = [];
  let remaining = stakeToMatch;

  const candidates = await tx.$queryRaw<
    {
      id: string;
      price: string;
      remainingStake: string;
      userId: string;
    }[]
  >`
    SELECT id, price::text, "remainingStake"::text AS "remainingStake", "userId"
    FROM "Order"
    WHERE "selectionId" = ${selectionId}
      AND side = 'BACK'
      AND status IN ('OPEN', 'PARTIAL')
      AND price >= ${layPrice}
    ORDER BY price DESC, "createdAt" ASC
    FOR UPDATE SKIP LOCKED
  `;

  for (const candidate of candidates) {
    if (remaining.lte(0)) break;

    const candidateRemaining = new Prisma.Decimal(candidate.remainingStake);
    const candidatePrice = new Prisma.Decimal(candidate.price);
    const tradeStake = remaining.lt(candidateRemaining)
      ? remaining
      : candidateRemaining;

    const trade = await tx.trade.create({
      data: {
        backOrderId: candidate.id,
        layOrderId: incomingOrderId,
        selectionId,
        price: candidatePrice,
        stake: tradeStake,
      },
    });

    trades.push({
      tradeId: trade.id,
      price: candidatePrice,
      stake: tradeStake,
    });

    // Update back order
    const newCandidateRemaining = candidateRemaining.minus(tradeStake);
    const newCandidateMatched = await tx.order
      .findUniqueOrThrow({ where: { id: candidate.id } })
      .then((o) => o.matchedStake.plus(tradeStake));

    const newCandidateStatus = newCandidateRemaining.lte(0)
      ? "MATCHED"
      : "PARTIAL";

    await tx.order.update({
      where: { id: candidate.id },
      data: {
        matchedStake: newCandidateMatched,
        remainingStake: newCandidateRemaining,
        status: newCandidateStatus,
      },
    });

    // Release BACK exposure for matched portion (exposure = stake for BACK)
    await adjustExposure(
      tx,
      candidate.userId,
      await tx.order
        .findUniqueOrThrow({ where: { id: candidate.id } })
        .then((o) => o.marketId),
      tradeStake.neg(),
    );

    remaining = remaining.minus(tradeStake);
  }

  const matchedStake = stakeToMatch.minus(remaining);
  return { matchedStake, remainingStake: remaining, trades };
}

/**
 * Adjust the Exposure record for a user+market.
 * Pass a positive delta to lock more, negative to release.
 */
export async function adjustExposure(
  tx: Tx,
  userId: string,
  marketId: string,
  delta: Prisma.Decimal,
): Promise<void> {
  await tx.marketExposure.upsert({
    where: { userId_marketId: { userId, marketId } },
    create: {
      userId,
      marketId,
      exposureAmount: delta.lt(0) ? new Prisma.Decimal(0) : delta,
    },
    update: {
      exposureAmount: {
        increment: delta,
      },
    },
  });
}
