import { Request, Response } from "express";
import { prisma } from "@/configs";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, ApiResponse, asyncHandler } from "@/utils";
import {
  matchBackOrder,
  matchLayOrder,
} from "@/services/matching-engine.service";

// ─────────────────────────────────────────────────────────
// GET /api/sports/matches : WIP
// ─────────────────────────────────────────────────────────
export const getAllMatches = asyncHandler(
  async (req: Request, res: Response) => {
    const { sport, status, page, limit, search } = req.query;

    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string) || 20, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.MatchWhereInput = {};
    if (sport) where.sport = sport as string;
    if (status) where.status = status as any;
    if (search)
      where.OR = [
        { teamA: { contains: search as string, mode: "insensitive" } },
        { teamB: { contains: search as string, mode: "insensitive" } },
      ];

    const [matches, total] = await Promise.all([
      prisma.match.findMany({
        where,
        select: {
          id: true,
          teamA: true,
          teamB: true,
          sport: true,
          status: true,
          startTime: true,
          endTime: true,
          markets: {
            select: {
              id: true,
              name: true,
              status: true,
              runners: {
                select: {
                  id: true,
                  name: true,
                  referenceOdds: {
                    select: {
                      referenceBackPrice: true,
                      referenceLayPrice: true,
                      lastUpdated: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { startTime: "asc" },
        skip,
        take: limitNum,
      }),
      prisma.match.count({ where }),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          matches,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
            hasMore: pageNum < Math.ceil(total / limitNum),
          },
        },
        "Matches fetched successfully",
      ),
    );
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/sports/matches/:matchId : WIP
// ─────────────────────────────────────────────────────────
export const getMatchById = asyncHandler(
  async (req: Request, res: Response) => {
    const matchId = req.params.matchId.toString();

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        markets: {
          include: {
            runners: {
              include: {
                referenceOdds: true,
              },
            },
          },
        },
      },
    });

    if (!match) throw new ApiError(404, "Match not found");

    return res
      .status(200)
      .json(new ApiResponse(200, match, "Match fetched successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/sports/markets/:marketId/orderbook
// Returns aggregated order book for a selection
// ─────────────────────────────────────────────────────────
export const getOrderBook = asyncHandler(
  async (req: Request, res: Response) => {
    const marketId = req.params.marketId.toString();
    const { selectionId } = req.query;

    if (!selectionId)
      throw new ApiError(400, "selectionId query param required");

    // Aggregate available back/lay stake at each price level
    const [backLevels, layLevels] = await Promise.all([
      prisma.order.groupBy({
        by: ["price"],
        where: {
          marketId: marketId.toString(),
          selectionId: selectionId as string,
          side: "BACK",
          status: { in: ["OPEN", "PARTIAL"] },
        },
        _sum: { remainingStake: true },
        _count: { id: true },
        orderBy: { price: "desc" }, // best back = highest price shown first
      }),
      prisma.order.groupBy({
        by: ["price"],
        where: {
          marketId: marketId.toString(),
          selectionId: selectionId as string,
          side: "LAY",
          status: { in: ["OPEN", "PARTIAL"] },
        },
        _sum: { remainingStake: true },
        _count: { id: true },
        orderBy: { price: "asc" }, // best lay = lowest price shown first
      }),
    ]);

    const referenceOdds = await prisma.referenceOdds.findUnique({
      where: {
        marketId_selectionId: {
          marketId: marketId.toString(),
          selectionId: selectionId as string,
        },
      },
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          marketId,
          selectionId,
          referenceOdds,
          back: backLevels.map((l) => ({
            price: l.price.toString(),
            availableStake: l._sum.remainingStake?.toString() ?? "0",
            orderCount: l._count.id,
          })),
          lay: layLevels.map((l) => ({
            price: l.price.toString(),
            availableStake: l._sum.remainingStake?.toString() ?? "0",
            orderCount: l._count.id,
          })),
        },
        "Order book fetched successfully",
      ),
    );
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/sports/order : WIP
// Place a BACK or LAY order with immediate matching attempt
// ─────────────────────────────────────────────────────────
export const placeOrder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  const userId = req.user.id;
  const { marketId, selectionId, side, price, stake } = req.body;

  // Validation
  if (!marketId || !selectionId || !side || !price || !stake)
    throw new ApiError(
      400,
      "marketId, selectionId, side, price, stake are required",
    );

  if (!["BACK", "LAY"].includes(side))
    throw new ApiError(400, "side must be BACK or LAY");

  const orderPrice = new Prisma.Decimal(price);
  const orderStake = new Prisma.Decimal(stake);

  if (orderStake.lte(0)) throw new ApiError(400, "stake must be positive");
  if (orderPrice.lte(1)) throw new ApiError(400, "price must be > 1.00");

  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Validate market is open
      const market = await tx.market.findUnique({
        where: { id: marketId },
        select: { id: true, status: true, matchId: true },
      });
      if (!market) throw new ApiError(404, "Market not found");
      if (market.status !== "OPEN")
        throw new ApiError(400, `Market is ${market.status}`);

      // 2. Validate runner exists in this market
      const runner = await tx.runner.findFirst({
        where: { id: selectionId, marketId },
        select: { id: true, name: true },
      });
      if (!runner) throw new ApiError(404, "Runner not found in this market");

      // 3. Calculate required exposure
      let liability: Prisma.Decimal;
      if (side === "BACK") {
        liability = orderStake; // max loss for back = full stake
      } else {
        liability = orderPrice.minus(1).mul(orderStake); // lay liability
      }

      // 4. Lock exposure in wallet
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new ApiError(404, "Wallet not found");

      const availableBalance = wallet.balance.minus(wallet.exposure);
      if (availableBalance.lt(liability)) {
        throw new ApiError(
          400,
          `Insufficient balance. Required: ${liability}, Available: ${availableBalance}`,
        );
      }

      const newWalletExposure = wallet.exposure.plus(liability);
      await tx.wallet.update({
        where: { userId },
        data: { exposure: newWalletExposure },
      });

      // 5. Create order record
      const order = await tx.order.create({
        data: {
          userId,
          marketId,
          selectionId,
          side,
          price: orderPrice,
          stake: orderStake,
          remainingStake: orderStake,
          lockedExposure: liability,
          status: "OPEN",
        },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount: liability.neg(),
          type: "EXPOSURE_LOCK",
          balance: wallet.balance,
          notes: `${side} order placed @ ${orderPrice} × ${orderStake}`,
        },
      });

      // 6. Run matching engine
      let matchResult;
      if (side === "BACK") {
        matchResult = await matchBackOrder(
          tx as any,
          order.id,
          selectionId,
          orderPrice,
          orderStake,
        );
      } else {
        matchResult = await matchLayOrder(
          tx as any,
          order.id,
          selectionId,
          orderPrice,
          orderStake,
        );
      }

      // 7. Update the new order based on match result
      let finalStatus: "OPEN" | "PARTIAL" | "MATCHED" =
        matchResult.remainingStake.lte(0)
          ? "MATCHED"
          : matchResult.matchedStake.gt(0)
            ? "PARTIAL"
            : "OPEN";

      // Release exposure for matched portion (order now has skin in the game)
      // For matched portion, exposure transitions from "locked" to "committed to trade"
      // (exposure remains but is now backed by a trade)
      // We reduce wallet exposure only for the REMAINING (unmatched) portion adjustment
      // if the user over-exposed due to partial match at different price
      // For MVP simplicity: exposure stays locked until settlement

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          matchedStake: matchResult.matchedStake,
          remainingStake: matchResult.remainingStake,
          status: finalStatus,
        },
      });

      return {
        order: updatedOrder,
        trades: matchResult.trades,
        matchedStake: matchResult.matchedStake.toString(),
        remainingStake: matchResult.remainingStake.toString(),
        status: finalStatus,
      };
    },
    {
      timeout: 15_000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );

  // Emit socket events
  global.socketService?.emitBalanceUpdate(userId, {
    balance: (await prisma.wallet.findUnique({
      where: { userId },
    }))!.balance.toString(),
    exposure: (await prisma.wallet.findUnique({
      where: { userId },
    }))!.exposure.toString(),
    availableBalance: "0", // recalc from DB
    changedBy: "ORDER_PLACE",
    amount: -Number(stake),
  });

  return res
    .status(201)
    .json(new ApiResponse(201, result, "Order placed successfully"));
});

// ─────────────────────────────────────────────────────────
// DELETE /api/sports/order/:orderId : WIP
// Cancel an open or partial order and release exposure
// ─────────────────────────────────────────────────────────
export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  const userId = req.user.id;
  const orderId = req.params.orderId.toString();

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
    });

    if (!order) throw new ApiError(404, "Order not found");
    if (!["OPEN", "PARTIAL"].includes(order.status))
      throw new ApiError(
        400,
        `Cannot cancel an order with status ${order.status}`,
      );

    // Release exposure for remaining (unmatched) stake only
    let exposureToRelease: Prisma.Decimal;
    if (order.side === "BACK") {
      exposureToRelease = order.remainingStake;
    } else {
      exposureToRelease = order.price.minus(1).mul(order.remainingStake);
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });

    const wallet = await tx.wallet.update({
      where: { userId },
      data: { exposure: { decrement: exposureToRelease } },
    });

    await tx.ledger.create({
      data: {
        userId,
        amount: exposureToRelease,
        type: "EXPOSURE_RELEASE",
        balance: wallet.balance,
        notes: `Order cancelled: ${order.id}`,
      },
    });

    return {
      orderId: order.id,
      releasedExposure: exposureToRelease.toString(),
      newExposure: wallet.exposure.toString(),
      availableBalance: wallet.balance.minus(wallet.exposure).toString(),
    };
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Order cancelled successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/sports/orders
// Logged-in user's orders
// ─────────────────────────────────────────────────────────
export const getUserOrders = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const userId = req.user.id;
    const { page, limit, status, marketId } = req.query;

    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit as string) || 50, 1),
      100,
    );
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.OrderWhereInput = { userId };
    if (status) where.status = status as any;
    if (marketId) where.marketId = marketId as string;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          market: { select: { id: true, name: true } },
          selection: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.order.count({ where }),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          orders,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
            hasMore: pageNum < Math.ceil(total / limitNum),
          },
        },
        "Orders fetched successfully",
      ),
    );
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/sports/orders/:orderId
// ─────────────────────────────────────────────────────────
export const getOrderById = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const orderId = req.params.orderId.toString();

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: req.user.id },
      include: {
        market: { include: { match: true } },
        selection: true,
        backTrades: true,
        layTrades: true,
      },
    });

    if (!order) throw new ApiError(404, "Order not found");

    return res
      .status(200)
      .json(new ApiResponse(200, order, "Order fetched successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/exchange/markets/:marketId/reference-odds
// ─────────────────────────────────────────────────────────
export const getReferenceOdds = asyncHandler(
  async (req: Request, res: Response) => {
    const marketId = req.params.marketId.toString();

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, name: true, status: true },
    });

    if (!market) throw new ApiError(404, "Market not found");

    const referenceOdds = await prisma.referenceOdds.findMany({
      where: { marketId },
      include: {
        selection: { select: { id: true, name: true } },
      },
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          marketId: market.id,
          marketName: market.name,
          marketStatus: market.status,
          referenceOdds: referenceOdds.map((ro) => ({
            selectionId: ro.selectionId,
            selectionName: ro.selection.name,
            backPrice: ro.referenceBackPrice.toString(),
            layPrice: ro.referenceLayPrice.toString(),
            lastUpdated: ro.lastUpdated.toISOString(),
          })),
        },
        "Reference odds fetched successfully",
      ),
    );
  },
);
