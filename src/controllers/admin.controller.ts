import { Request, Response } from "express";
import { prisma } from "@/configs";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, ApiResponse, asyncHandler } from "@/utils";
import bcrypt from "bcryptjs";

// ─────────────────────────────────────────────────────────
// GET /api/admin/users
// ─────────────────────────────────────────────────────────
export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN","AGENT"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { page, limit, role, search } = req.query;

  const pageNum = Math.max(parseInt(page as string) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit as string) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role as any;
  if (search)
    where.OR = [
      { name: { contains: search as string, mode: "insensitive" } },
      { email: { contains: search as string, mode: "insensitive" } },
    ];

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        parentId: true,
        createdAt: true,
        wallet: {
          select: {
            balance: true,
            exposure: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    }),
    prisma.user.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        users: users.map((u) => ({
          ...u,
          availableBalance: u.wallet
            ? u.wallet.balance.minus(u.wallet.exposure).toString()
            : "0",
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      "Users fetched successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/users
// Create a sub-user (agent, user, etc.)
// ─────────────────────────────────────────────────────────
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN","AGENT"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { email, password, name, role, parentId } = req.body;

  if (!email || !password || !name || !role)
    throw new ApiError(400, "email, password, name, role are required");

  if (!["ADMIN", "AGENT", "USER"].includes(role))
    throw new ApiError(400, "Invalid role");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(400, "Email already in use");

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        parentId: parentId || req.user!.id,
        wallet: {
          create: { balance: 0, exposure: 0 },
        },
      },
      include: { wallet: true },
    });

    await tx.ledger.create({
      data: {
        userId: newUser.id,
        amount: 0,
        type: "CREDIT",
        balance: 0,
        notes: "Account created",
      },
    });

    return newUser;
  });

  const { password: _, ...userWithoutPassword } = user;

  return res
    .status(201)
    .json(
      new ApiResponse(201, userWithoutPassword, "User created successfully"),
    );
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/matches
// Create a match. If externalId already exists, returns the
// existing match (idempotent) so the caller can still add
// markets to it without hitting a unique-constraint crash.
// ─────────────────────────────────────────────────────────
export const createMatch = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { teamA, teamB, sport, startTime, externalId, markets } = req.body;

  if (!teamA || !teamB || !sport || !startTime)
    throw new ApiError(400, "teamA, teamB, sport, startTime are required");

  const parsedStart = new Date(startTime);
  if (isNaN(parsedStart.getTime()))
    throw new ApiError(400, "startTime is not a valid ISO date string");

  // ── Idempotency: if externalId already exists return the existing match ──
  if (externalId) {
    const existing = await prisma.match.findUnique({
      where: { externalId: String(externalId).trim() },
      include: { markets: { include: { runners: true } } },
    });

    if (existing) {
      // 409 with the existing record — frontend can extract matchId and
      // continue creating markets under it without any extra lookup.
      return res.status(409).json(
        new ApiResponse(
          409,
          existing,
          "Match with this externalId already exists",
        ),
      );
    }
  }

  const match = await prisma.match.create({
    data: {
      teamA:      String(teamA).trim(),
      teamB:      String(teamB).trim(),
      sport:      String(sport).trim(),
      startTime:  parsedStart,
      externalId: externalId ? String(externalId).trim() : null,
      markets: {
        create: (markets || []).map(
          (m: {
            name: string;
            runners?: { name: string; backOdds?: number; layOdds?: number }[];
          }) => ({
            name: String(m.name).trim(),
            runners: {
              create: (m.runners || []).map(
                (s: { name: string; backOdds?: number; layOdds?: number }) => ({
                  name:     String(s.name).trim(),
                  backOdds: Number(s.backOdds ?? 2.0),
                  layOdds:  Number(s.layOdds  ?? 2.02),
                }),
              ),
            },
          }),
        ),
      },
    },
    include: {
      markets: { include: { runners: true } },
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, match, "Match created successfully"));
});

// ─────────────────────────────────────────────────────────
// PATCH /api/admin/matches/:matchId/status
// Update match status (LIVE, COMPLETED, CANCELLED)
// ─────────────────────────────────────────────────────────
export const updateMatchStatus = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { matchId } = req.params;
    const { status } = req.body;

    const validStatuses = ["UPCOMING", "LIVE", "COMPLETED", "CANCELLED"];
    if (!validStatuses.includes(status))
      throw new ApiError(
        400,
        `status must be one of ${validStatuses.join(", ")}`,
      );

    const match = await prisma.match.update({
      where: { id: matchId.toString() },
      data: { status },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, match, "Match status updated successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/admin/markets
// Create a standalone market for an existing match.
// ─────────────────────────────────────────────────────────
export const createMarket = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { matchId, name, runners } = req.body;
console.log("createMarket payload:", req.body);
    // ── Field presence ──────────────────────────────────────────────────────
    if (!matchId || typeof matchId !== "string")
      throw new ApiError(400, "matchId is required and must be a string");

    if (!name || typeof name !== "string" || !name.trim())
      throw new ApiError(400, "name is required and must be a non-empty string");

    if (!Array.isArray(runners) || runners.length < 2)
      throw new ApiError(
        400,
        "runners must be an array with at least 2 entries",
      );

    // ── Per-runner validation ───────────────────────────────────────────────
    for (let i = 0; i < runners.length; i++) {
      const r = runners[i];

      if (!r || typeof r !== "object")
        throw new ApiError(400, `runners[${i}] must be an object`);

      if (!r.name || typeof r.name !== "string" || !String(r.name).trim())
        throw new ApiError(400, `runners[${i}].name is required`);

      const back = parseFloat(r.backOdds);
      const lay  = parseFloat(r.layOdds);

      if (isNaN(back) || back <= 1)
        throw new ApiError(
          400,
          `runners[${i}].backOdds must be a decimal number greater than 1`,
        );

      if (isNaN(lay) || lay <= 1)
        throw new ApiError(
          400,
          `runners[${i}].layOdds must be a decimal number greater than 1`,
        );

      if (lay < back)
        throw new ApiError(
          400,
          `runners[${i}].layOdds (${lay}) must be >= backOdds (${back})`,
        );
    }

    // ── Verify match exists ─────────────────────────────────────────────────
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new ApiError(404, `Match not found: ${matchId}`);

    // ── Create ──────────────────────────────────────────────────────────────
    const market = await prisma.market.create({
      data: {
        matchId,
        name: name.trim(),
        runners: {
          create: runners.map(
            (r: { name: string; backOdds: number; layOdds: number }) => ({
              name:     String(r.name).trim(),
              backOdds: parseFloat(parseFloat(r.backOdds.toString()).toFixed(2)),
              layOdds:  parseFloat(parseFloat(r.layOdds.toString()).toFixed(2)),
            }),
          ),
        },
      },
      include: { runners: true },
    });

    return res
      .status(201)
      .json(new ApiResponse(201, market, "Market created successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/admin/markets/:marketId/force-close
// Admin force-closes a market, cancels all open orders,
// and triggers settlement if winning selections are given.
// ─────────────────────────────────────────────────────────
export const forceCloseMarket = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const marketId = req.params.marketId.toString();
    /**
     * winnerSelectionIds: string[] — selections that won.
     * If empty / not provided, all trades are refunded (e.g. match abandoned).
     */
    const { winnerSelectionIds = [] } = req.body;

    const result = await prisma.$transaction(
      async (tx) => {
        const market = await tx.market.findUnique({
          where: { id: marketId.toString() },
          include: { runners: true },
        });

        if (!market) throw new ApiError(404, "Market not found");
        if (market.status === "SETTLED")
          throw new ApiError(400, "Market is already settled");

        // 1. Mark market CLOSED
        await tx.market.update({
          where: { id: marketId.toString() },
          data: { status: "CLOSED" },
        });

        // 2. Mark winning / losing runners
        for (const sel of market.runners) {
          await tx.runner.update({
            where: { id: sel.id },
            data: {
              isWinner:
                winnerSelectionIds.length > 0
                  ? winnerSelectionIds.includes(sel.id)
                  : null, // null = refund
            },
          });
        }

        // 3. Cancel all open / partial orders and release their exposure
        const openOrders = await tx.order.findMany({
          where: {
            marketId: marketId.toString(),
            status: { in: ["OPEN", "PARTIAL"] },
          },
        });

        let cancelledCount = 0;
        for (const order of openOrders) {
          const exposureToRelease =
            order.side === "BACK"
              ? order.remainingStake
              : order.price.minus(1).mul(order.remainingStake);

          await tx.order.update({
            where: { id: order.id },
            data: { status: "CANCELLED" },
          });

          const wallet = await tx.wallet.update({
            where: { userId: order.userId },
            data: { exposure: { decrement: exposureToRelease } },
          });

          await tx.marketExposure.updateMany({
            where: { userId: order.userId, marketId },
            data: { exposureAmount: { decrement: exposureToRelease } },
          });

          await tx.ledger.create({
            data: {
              userId: order.userId,
              amount: exposureToRelease,
              type: "EXPOSURE_RELEASE",
              balance: wallet.balance,
              notes: `Admin force-closed market ${marketId}`,
            },
          });

          cancelledCount++;
        }

        // 4. Settle all unsettled trades
        const trades = await tx.trade.findMany({
          where: {
            selectionId: { in: market.runners.map((s) => s.id) },
            settled: false,
          },
          include: {
            backOrder: true,
            layOrder: true,
            selection: true,
          },
        });

        let settledCount = 0;
        for (const trade of trades) {
          const isWinner = trade.selection.isWinner;

          if (isWinner === null) {
            // Refund both sides
            const backStake = trade.stake;
            const layLiability = trade.price.minus(1).mul(trade.stake);

            for (const [uid, amount] of [
              [trade.backOrder.userId, backStake],
              [trade.layOrder.userId, layLiability],
            ] as [string, Prisma.Decimal][]) {
              const wallet = await tx.wallet.update({
                where: { userId: uid },
                data: { balance: { increment: amount } },
              });

              await tx.ledger.create({
                data: {
                  userId: uid,
                  amount,
                  type: "ORDER_SETTLE",
                  balance: wallet.balance,
                  notes: `Refund - market abandoned: trade ${trade.id}`,
                },
              });
            }
          } else if (isWinner) {
            // BACK wins
            const profit = trade.price.minus(1).mul(trade.stake);
            const backPayout = trade.stake.plus(profit);

            const backWallet = await tx.wallet.update({
              where: { userId: trade.backOrder.userId },
              data: { balance: { increment: backPayout } },
            });
            await tx.ledger.create({
              data: {
                userId: trade.backOrder.userId,
                amount: backPayout,
                type: "ORDER_SETTLE",
                balance: backWallet.balance,
                notes: `Back won: trade ${trade.id}`,
              },
            });

            // Release lay liability (already locked)
            const layWallet = await tx.wallet.update({
              where: { userId: trade.layOrder.userId },
              data: { exposure: { decrement: profit } },
            });
            await tx.ledger.create({
              data: {
                userId: trade.layOrder.userId,
                amount: profit.neg(),
                type: "ORDER_SETTLE",
                balance: layWallet.balance,
                notes: `Lay lost: trade ${trade.id}`,
              },
            });
          } else {
            // LAY wins — receives the back stake
            const layWallet = await tx.wallet.update({
              where: { userId: trade.layOrder.userId },
              data: { balance: { increment: trade.stake } },
            });
            await tx.ledger.create({
              data: {
                userId: trade.layOrder.userId,
                amount: trade.stake,
                type: "ORDER_SETTLE",
                balance: layWallet.balance,
                notes: `Lay won: trade ${trade.id}`,
              },
            });

            // Release back exposure (back stake already locked)
            const backWallet = await tx.wallet.update({
              where: { userId: trade.backOrder.userId },
              data: { exposure: { decrement: trade.stake } },
            });
            await tx.ledger.create({
              data: {
                userId: trade.backOrder.userId,
                amount: trade.stake.neg(),
                type: "ORDER_SETTLE",
                balance: backWallet.balance,
                notes: `Back lost: trade ${trade.id}`,
              },
            });
          }

          await tx.trade.update({
            where: { id: trade.id },
            data: { settled: true, settledAt: new Date() },
          });

          settledCount++;
        }

        // 5. Mark market SETTLED
        await tx.market.update({
          where: { id: marketId },
          data: { status: "SETTLED" },
        });

        return { cancelledOrders: cancelledCount, settledTrades: settledCount };
      },
      { timeout: 30_000 },
    );

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          result,
          "Market force-closed and settled successfully",
        ),
      );
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/admin/markets/:marketId/orders
// View all orders in a market (admin oversight)
// ─────────────────────────────────────────────────────────
export const getMarketOrders = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const marketId = req.params.marketId.toString();
    const { status, selectionId } = req.query;

    const where: Prisma.OrderWhereInput = { marketId };
    if (status) where.status = status as any;
    if (selectionId) where.selectionId = selectionId as string;

    const orders = await prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        selection: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, orders, "Market orders fetched successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// GET /api/admin/markets/:marketId/trades
// View all trades (matched bets) in a market
// ─────────────────────────────────────────────────────────
export const getMarketTrades = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { marketId } = req.params;

    const trades = await prisma.trade.findMany({
      where: {
        backOrder: { marketId: marketId.toString() },
      },
      include: {
        backOrder: {
          include: { user: { select: { id: true, name: true } } },
        },
        layOrder: {
          include: { user: { select: { id: true, name: true } } },
        },
        selection: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, trades, "Market trades fetched successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/admin/markets/:marketId/suspend
// Suspend / unsuspend a market (no new orders accepted)
// ─────────────────────────────────────────────────────────
export const updateMarketStatus = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { marketId } = req.params;
    const { status } = req.body;

    if (!["OPEN", "SUSPENDED", "CLOSED"].includes(status))
      throw new ApiError(400, "status must be OPEN, SUSPENDED, or CLOSED");

    const market = await prisma.market.update({
      where: { id: marketId.toString() },
      data: { status },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, market, "Market status updated successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/admin/users/:userId
// Update a user's details
// ─────────────────────────────────────────────────────────
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { userId } = req.params;
  const { name, role } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: { name, role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      parentId: true,
      isBanned: true,
      createdAt: true,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, user, "User updated successfully"));
});

// ─────────────────────────────────────────────────────────
// DELETE /api/admin/users/:userId
// ─────────────────────────────────────────────────────────
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (req.user.role !== "SUPER_ADMIN")
    throw new ApiError(403, "Only Super Admin can delete users");

  const { userId } = req.params;
  if (userId === req.user.id) throw new ApiError(400, "Cannot delete yourself");

  await prisma.user.delete({ where: { id: userId } });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "User deleted successfully"));
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/users/:userId/ban
// ─────────────────────────────────────────────────────────
export const banUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { userId } = req.params;
  if (userId === req.user.id) throw new ApiError(400, "Cannot ban yourself");

  await prisma.user.update({
    where: { id: userId },
    data: { isBanned: true },
  });

  global.socketService?.emitSystemAlert({
    level: "error",
    title: "Account Suspended",
    message: `User ${userId} has been banned`,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "User banned successfully"));
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/users/:userId/unban
// ─────────────────────────────────────────────────────────
export const unbanUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { userId } = req.params;

  await prisma.user.update({
    where: { id: userId },
    data: { isBanned: false },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, null, "User unbanned successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/admin/trades
// View all trades (global, paginated)
// ─────────────────────────────────────────────────────────
export const getTrades = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const { page = 1, limit = 20, marketId, settled } = req.query as any;

  const pageNum = Math.max(parseInt(page) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.TradeWhereInput = {};
  if (settled !== undefined) where.settled = settled === "true";
  if (marketId) where.backOrder = { marketId };

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      include: {
        backOrder: {
          include: { user: { select: { id: true, name: true } } },
        },
        layOrder: {
          include: { user: { select: { id: true, name: true } } },
        },
        selection: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    }),
    prisma.trade.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        trades,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      "Trades fetched successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────
// GET /api/admin/stats
// Dashboard statistics
// ─────────────────────────────────────────────────────────
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const [
    totalUsers,
    activeUsers,
    activeMatches,
    pendingOrders,
    walletAgg,
    volumeAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isBanned: false } }),
    prisma.match.count({ where: { status: "LIVE" } }),
    prisma.order.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } }),
    prisma.wallet.aggregate({ _sum: { balance: true, exposure: true } }),
    prisma.trade.aggregate({ _sum: { stake: true } }),
  ]);

  const totalBalance = parseFloat((walletAgg._sum.balance ?? 0).toString());
  const totalExposure = parseFloat((walletAgg._sum.exposure ?? 0).toString());
  const totalVolume = parseFloat((volumeAgg._sum.stake ?? 0).toString());

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalUsers,
        activeUsers,
        activeMatches,
        pendingOrders,
        totalBalance,
        totalExposure,
        totalVolume,
      },
      "Stats fetched successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────
// POST /api/admin/notifications
// Send notification to a user or broadcast to all
// ─────────────────────────────────────────────────────────
export const sendNotification = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const {
      userId,
      title,
      message,
      type = "INFO",
      broadcast = false,
    } = req.body;

    if (!title || !message)
      throw new ApiError(400, "title and message are required");

    if (broadcast) {
      const users = await prisma.user.findMany({ select: { id: true } });
      await prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          title,
          message,
          type: type.toUpperCase() as any,
        })),
      });

      global.socketService?.emitSystemAlert({
        level: type.toLowerCase() as any,
        title,
        message,
      });
    } else if (userId) {
      await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type: type.toUpperCase() as any,
        },
      });

      global.socketService?.emitBalanceUpdate(userId, {
        balance: "0",
        exposure: "0",
        availableBalance: "0",
        changedBy: "ADMIN_CREDIT",
        amount: 0,
      });
    } else {
      throw new ApiError(400, "Provide userId or set broadcast=true");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Notification sent successfully"));
  },
);
