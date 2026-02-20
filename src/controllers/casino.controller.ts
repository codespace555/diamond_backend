import { Request, Response, NextFunction } from "express";
import { prisma } from "@/configs";
import { myEnvironment } from "@/configs/env.config";
import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/utils";
import { ApiResponse } from "@/utils";
import { BalanceUpdatePayload } from "@/types/events";

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// GET /api/casino/games
export const getAllGames = asyncHandler(async (req: Request, res: Response) => {
  const { category, search, page, limit } = req.query;

  const pageNum = page ? parseInt(page as string) : 1;
  const limitNum = limit ? parseInt(limit as string) : 20;
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.GameWhereInput = {};

  if (category) {
    where.category = category as string;
  }

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: "insensitive" } },
      { slug: { contains: search as string, mode: "insensitive" } },
    ];
  }

  const [games, total] = await Promise.all([
    prisma.game.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: limitNum,
    }),
    prisma.game.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limitNum);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        games,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      },
      "Games fetched successfully",
    ),
  );
});

// GET /api/casino/games/:gameId
export const getGameById = asyncHandler(async (req: Request, res: Response) => {
  const gameId = req.params.gameId as string;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      transactions: {
        select: {
          id: true,
          type: true,
          amount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!game) throw new ApiError(404, "Game not found");

  return res
    .status(200)
    .json(new ApiResponse(200, game, "Game fetched successfully"));
});

// POST /api/casino/launch
export const launchGame = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ApiError(401, "Authentication required");
  }

  const userId = req.user.id;
  const { gameId } = req.body;

  if (!gameId) throw new ApiError(400, "Game ID is required");

  const game = await prisma.game.findUnique({
    where: { id: gameId },
  });

  if (!game) throw new ApiError(404, "Game not found");

  const baseUrl = myEnvironment.BASE_URL;
  const launchUrl = `${baseUrl}${game.launchUrl}?userId=${userId}&gameId=${gameId}`;

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { gameId: game.id, name: game.name, launchUrl },
        "Game launched successfully",
      ),
    );
});

// POST /api/casino/bet
export const placeCasinoBet = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userId = req.user.id;
    const { gameId, amount } = req.body;

    if (!gameId || !amount) {
      throw new ApiError(400, "Game ID and amount are required");
    }

    const betAmount = new Prisma.Decimal(amount);

    if (betAmount.lte(0)) {
      throw new ApiError(400, "Bet amount must be positive");
    }

    const result = await prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game) throw new ApiError(404, "Game not found");

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new ApiError(404, "Wallet not found");

      const availableBalance = wallet.balance.minus(wallet.exposure);
      if (availableBalance.lt(betAmount)) {
        throw new ApiError(
          400,
          `Insufficient balance. Available: ${availableBalance.toString()}`,
        );
      }

      const balanceBefore = wallet.balance;
      const newBalance = wallet.balance.minus(betAmount);

      await tx.wallet.update({
        where: { userId },
        data: { balance: newBalance },
      });

      const transaction = await tx.casinoTransaction.create({
        data: {
          userId,
          gameId,
          type: "BET",
          amount: betAmount,
          balanceBefore,
          balanceAfter: newBalance,
        },
        include: { game: true },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount: betAmount.neg(),
          type: "DEBIT",
          balance: newBalance,
          notes: `Casino bet: ${game.name}`,
        },
      });

      return {
        transaction,
        newBalance: newBalance.toString(),
        exposure: wallet.exposure.toString(),
        availableBalance: newBalance.minus(wallet.exposure).toString(),
      };
    });

    global.socketService?.emitCasinoTransaction(userId, {
      transactionId: result.transaction.id,
      gameId,
      gameName: result.transaction.game.name,
      type: "BET",
      amount: betAmount.toNumber(),
      balanceBefore: result.transaction.balanceBefore.toString(),
      balanceAfter: result.transaction.balanceAfter.toString(),
    });

    global.socketService?.emitBalanceUpdate(userId, {
      balance: result.newBalance,
      exposure: result.exposure,
      availableBalance: result.availableBalance,
      changedBy: "CASINO_BET" as BalanceUpdatePayload["changedBy"],
      amount: betAmount.neg().toNumber(),
    });

    return res
      .status(201)
      .json(new ApiResponse(201, result, "Casino bet placed successfully"));
  },
);

// POST /api/casino/win
export const processCasinoWin = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userId = req.user.id;
    const { gameId, amount } = req.body;

    if (!gameId || !amount) {
      throw new ApiError(400, "Game ID and amount are required");
    }

    const winAmount = new Prisma.Decimal(amount);

    if (winAmount.lte(0)) {
      throw new ApiError(400, "Win amount must be positive");
    }

    const result = await prisma.$transaction(async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game) throw new ApiError(404, "Game not found");

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new ApiError(404, "Wallet not found");

      const balanceBefore = wallet.balance;
      const newBalance = wallet.balance.plus(winAmount);

      await tx.wallet.update({
        where: { userId },
        data: { balance: newBalance },
      });

      const transaction = await tx.casinoTransaction.create({
        data: {
          userId,
          gameId,
          type: "WIN",
          amount: winAmount,
          balanceBefore,
          balanceAfter: newBalance,
        },
        include: { game: true },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount: winAmount,
          type: "CREDIT",
          balance: newBalance,
          notes: `Casino win: ${game.name}`,
        },
      });

      return {
        transaction,
        newBalance: newBalance.toString(),
        exposure: wallet.exposure.toString(),
        availableBalance: newBalance.minus(wallet.exposure).toString(),
      };
    });

    global.socketService?.emitCasinoTransaction(userId, {
      transactionId: result.transaction.id,
      gameId,
      gameName: result.transaction.game.name,
      type: "WIN",
      amount: winAmount.toNumber(),
      balanceBefore: result.transaction.balanceBefore.toString(),
      balanceAfter: result.transaction.balanceAfter.toString(),
    });

    global.socketService?.emitBalanceUpdate(userId, {
      balance: result.newBalance,
      exposure: result.exposure,
      availableBalance: result.availableBalance,
      changedBy: "CASINO_WIN" as BalanceUpdatePayload["changedBy"],
      amount: winAmount.toNumber(),
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, "Casino win processed successfully"));
  },
);

// GET /api/casino/transactions
export const getCasinoTransactions = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userId = req.user.id;
    const { page, limit, gameId, type, startDate, endDate } = req.query;

    const pageNum = page ? parseInt(page as string) : 1;
    const limitNum = limit ? parseInt(limit as string) : 50;
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.CasinoTransactionWhereInput = { userId };

    if (gameId) {
      where.gameId = gameId as string;
    }

    if (type) {
      where.type = type as Prisma.EnumTransactionTypeFilter;
    }

    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate && { gte: new Date(startDate as string) }),
        ...(endDate && { lte: new Date(endDate as string) }),
      };
    }

    const [transactions, total] = await Promise.all([
      prisma.casinoTransaction.findMany({
        where,
        include: { game: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.casinoTransaction.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          transactions,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
            hasMore: pageNum < totalPages,
          },
        },
        "Casino transactions fetched successfully",
      ),
    );
  },
);

// GET /api/casino/statistics
export const getCasinoStatistics = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const hasDateFilter = startDate || endDate;
    const dateFilter: Prisma.DateTimeFilter = {
      ...(startDate && { gte: new Date(startDate as string) }),
      ...(endDate && { lte: new Date(endDate as string) }),
    };
    const createdAtFilter = hasDateFilter ? { createdAt: dateFilter } : {};

    const [totalBets, totalWins, totalBetAmount, totalWinAmount, gameStats] =
      await Promise.all([
        prisma.casinoTransaction.count({
          where: { userId, type: "BET", ...createdAtFilter },
        }),
        prisma.casinoTransaction.count({
          where: { userId, type: "WIN", ...createdAtFilter },
        }),
        prisma.casinoTransaction.aggregate({
          where: { userId, type: "BET", ...createdAtFilter },
          _sum: { amount: true },
        }),
        prisma.casinoTransaction.aggregate({
          where: { userId, type: "WIN", ...createdAtFilter },
          _sum: { amount: true },
        }),
        prisma.casinoTransaction.groupBy({
          by: ["gameId"],
          where: { userId, ...createdAtFilter },
          _count: true,
          _sum: { amount: true },
        }),
      ]);

    const gameIds = gameStats.map((stat) => stat.gameId);
    const games = await prisma.game.findMany({
      where: { id: { in: gameIds } },
      select: { id: true, name: true, category: true },
    });

    const gameStatsWithNames = gameStats.map((stat) => {
      const game = games.find((g) => g.id === stat.gameId);
      return {
        gameId: stat.gameId,
        gameName: game?.name ?? "Unknown",
        category: game?.category ?? "Unknown",
        transactions: stat._count,
        totalAmount: stat._sum.amount?.toString() ?? "0",
      };
    });

    const totalBetDecimal = totalBetAmount._sum.amount ?? new Prisma.Decimal(0);
    const totalWinDecimal = totalWinAmount._sum.amount ?? new Prisma.Decimal(0);
    const totalProfit = totalWinDecimal.minus(totalBetDecimal).toString();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          totalBets,
          totalWins,
          totalBetAmount: totalBetDecimal.toString(),
          totalWinAmount: totalWinDecimal.toString(),
          totalProfit,
          gameStatistics: gameStatsWithNames,
        },
        "Casino statistics fetched successfully",
      ),
    );
  },
);

// GET /api/casino/categories
export const getCategories = asyncHandler(
  async (_req: Request, res: Response) => {
    const categories = await prisma.game.findMany({
      select: { category: true },
      distinct: ["category"],
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        categories.map((c) => c.category),
        "Categories fetched successfully",
      ),
    );
  },
);
