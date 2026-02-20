import { Request, Response } from "express";
import { prisma } from "@/configs";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, ApiResponse, asyncHandler } from "@/utils";
import { TransferPayload } from "@/types/events";

// ─────────────────────────────────────────────────────────
// GET /api/wallet
// ─────────────────────────────────────────────────────────
export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  const wallet = await prisma.wallet.findUnique({
    where: { userId: req.user.id },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });

  if (!wallet) throw new ApiError(404, "Wallet not found");

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...wallet,
        availableBalance: wallet.balance.minus(wallet.exposure).toString(),
      },
      "Wallet fetched successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────
// GET /api/wallet/ledger
// ─────────────────────────────────────────────────────────
export const getLedger = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  const userId = req.user.id;
  const { page, limit, type, startDate, endDate } = req.query;

  const pageNum = Math.max(parseInt(page as string) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.LedgerWhereInput = { userId };
  if (type) where.type = type as any;
  if (startDate || endDate)
    where.createdAt = {
      ...(startDate && { gte: new Date(startDate as string) }),
      ...(endDate && { lte: new Date(endDate as string) }),
    };

  const [entries, total] = await Promise.all([
    prisma.ledger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    }),
    prisma.ledger.count({ where }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        entries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasMore: pageNum < Math.ceil(total / limitNum),
        },
      },
      "Ledger fetched successfully",
    ),
  );
});

// ─────────────────────────────────────────────────────────
// POST /api/wallet/lock-exposure  (internal / service use) : WIP
// Explicitly lock additional exposure for a user + market.
// Called by the matching engine via the betting controller,
// but exposed here as a convenience admin endpoint too.
// ─────────────────────────────────────────────────────────
export const lockExposure = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { userId, marketId, amount } = req.body;
    if (!userId || !marketId || !amount)
      throw new ApiError(400, "userId, marketId, amount are required");

    const lockAmount = new Prisma.Decimal(amount);
    if (lockAmount.lte(0)) throw new ApiError(400, "amount must be positive");

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new ApiError(404, "Wallet not found");

      const available = wallet.balance.minus(wallet.exposure);
      if (available.lt(lockAmount))
        throw new ApiError(
          400,
          `Insufficient available balance: ${available.toString()}`,
        );

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { exposure: { increment: lockAmount } },
      });

      await tx.marketExposure.upsert({
        where: { userId_marketId: { userId, marketId } },
        create: { userId, marketId, exposureAmount: lockAmount },
        update: { exposureAmount: { increment: lockAmount } },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount: lockAmount.neg(),
          type: "EXPOSURE_LOCK",
          balance: updatedWallet.balance,
          notes: `Exposure locked for market ${marketId}`,
        },
      });

      return {
        newExposure: updatedWallet.exposure.toString(),
        availableBalance: updatedWallet.balance
          .minus(updatedWallet.exposure)
          .toString(),
      };
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, "Exposure locked successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/wallet/release-exposure  (internal / admin) : WIP
// ─────────────────────────────────────────────────────────
export const releaseExposure = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");
    if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
      throw new ApiError(403, "Insufficient permissions");

    const { userId, marketId, amount } = req.body;
    if (!userId || !marketId || !amount)
      throw new ApiError(400, "userId, marketId, amount are required");

    const releaseAmount = new Prisma.Decimal(amount);
    if (releaseAmount.lte(0))
      throw new ApiError(400, "amount must be positive");

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new ApiError(404, "Wallet not found");

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: {
          exposure: {
            decrement: releaseAmount,
          },
        },
      });

      await tx.marketExposure.updateMany({
        where: { userId, marketId },
        data: { exposureAmount: { decrement: releaseAmount } },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount: releaseAmount,
          type: "EXPOSURE_RELEASE",
          balance: updatedWallet.balance,
          notes: `Exposure released for market ${marketId}`,
        },
      });

      return {
        newExposure: updatedWallet.exposure.toString(),
        availableBalance: updatedWallet.balance
          .minus(updatedWallet.exposure)
          .toString(),
      };
    });

    return res
      .status(200)
      .json(new ApiResponse(200, result, "Exposure released successfully"));
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/wallet/transfer
// Transfer coins to a direct child user only
// ─────────────────────────────────────────────────────────
export const transferCoins = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const fromUserId = req.user.id;
    const { toUserId, amount, notes } = req.body;

    if (!toUserId || !amount)
      throw new ApiError(400, "toUserId and amount are required");

    const transferAmount = new Prisma.Decimal(amount);
    if (transferAmount.lte(0))
      throw new ApiError(400, "amount must be positive");

    const fromUser = await prisma.user.findUnique({
      where: { id: fromUserId },
      include: { children: { select: { id: true } } },
    });
    if (!fromUser) throw new ApiError(404, "Sender not found");

    if (!fromUser.children.some((c) => c.id === toUserId))
      throw new ApiError(403, "Can only transfer to direct children");

    const toUser = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, name: true },
    });
    if (!toUser) throw new ApiError(404, "Recipient not found");

    const result = await prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({
        where: { userId: fromUserId },
      });
      if (!senderWallet) throw new ApiError(404, "Sender wallet not found");

      const available = senderWallet.balance.minus(senderWallet.exposure);
      if (available.lt(transferAmount))
        throw new ApiError(
          400,
          `Insufficient balance. Available: ${available.toString()}`,
        );

      const receiverWallet = await tx.wallet.findUnique({
        where: { userId: toUserId },
      });
      if (!receiverWallet) throw new ApiError(404, "Receiver wallet not found");

      const newSenderBalance = senderWallet.balance.minus(transferAmount);
      const newReceiverBalance = receiverWallet.balance.plus(transferAmount);

      await tx.wallet.update({
        where: { userId: fromUserId },
        data: { balance: newSenderBalance },
      });

      await tx.wallet.update({
        where: { userId: toUserId },
        data: { balance: newReceiverBalance },
      });

      await tx.ledger.create({
        data: {
          userId: fromUserId,
          amount: transferAmount.neg(),
          type: "TRANSFER_OUT",
          balance: newSenderBalance,
          notes: notes || `Transfer to ${toUserId}`,
        },
      });

      await tx.ledger.create({
        data: {
          userId: toUserId,
          amount: transferAmount,
          type: "TRANSFER_IN",
          balance: newReceiverBalance,
          notes: notes || `Transfer from ${fromUserId}`,
        },
      });

      return {
        newSenderBalance: newSenderBalance.toString(),
        newReceiverBalance: newReceiverBalance.toString(),
        senderExposure: senderWallet.exposure.toString(),
        senderAvailableBalance: newSenderBalance
          .minus(senderWallet.exposure)
          .toString(),
        receiverExposure: receiverWallet.exposure.toString(),
        receiverAvailableBalance: newReceiverBalance
          .minus(receiverWallet.exposure)
          .toString(),
      };
    });

    const transferPayload: TransferPayload = {
      fromUserId,
      fromUserName: fromUser.name,
      toUserId,
      toUserName: toUser.name,
      amount: transferAmount.toNumber(),
      newBalance: result.newSenderBalance,
      timestamp: new Date().toISOString(),
    };

    global.socketService?.emitTransferSent(fromUserId, transferPayload);
    global.socketService?.emitTransferReceived(toUserId, {
      ...transferPayload,
      newBalance: result.newReceiverBalance,
    });

    global.socketService?.emitBalanceUpdate(fromUserId, {
      balance: result.newSenderBalance,
      exposure: result.senderExposure,
      availableBalance: result.senderAvailableBalance,
      changedBy: "TRANSFER_OUT",
      amount: transferAmount.neg().toNumber(),
    });

    global.socketService?.emitBalanceUpdate(toUserId, {
      balance: result.newReceiverBalance,
      exposure: result.receiverExposure,
      availableBalance: result.receiverAvailableBalance,
      changedBy: "TRANSFER_IN",
      amount: transferAmount.toNumber(),
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          fromBalance: result.newSenderBalance,
          toBalance: result.newReceiverBalance,
          amount: transferAmount.toNumber(),
        },
        "Transfer successful",
      ),
    );
  },
);

// ─────────────────────────────────────────────────────────
// POST /api/wallet/add-balance  (Admin only)
// ─────────────────────────────────────────────────────────
export const addBalance = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.user.role))
    throw new ApiError(403, "Insufficient permissions");

  const adminUserId = req.user.id;
  const { userId, amount, notes } = req.body;

  if (!userId || !amount)
    throw new ApiError(400, "userId and amount are required");

  const addAmount = new Prisma.Decimal(amount);
  if (addAmount.lte(0)) throw new ApiError(400, "amount must be positive");

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new ApiError(404, "Wallet not found");

    const newBalance = wallet.balance.plus(addAmount);

    const updatedWallet = await tx.wallet.update({
      where: { userId },
      data: { balance: newBalance },
    });

    await tx.ledger.create({
      data: {
        userId,
        amount: addAmount,
        type: "CREDIT",
        balance: newBalance,
        notes: notes || `Balance added by admin ${adminUserId}`,
      },
    });

    return {
      newBalance: newBalance.toString(),
      exposure: updatedWallet.exposure.toString(),
      availableBalance: newBalance.minus(updatedWallet.exposure).toString(),
      amount: addAmount.toNumber(),
    };
  });

  global.socketService?.emitBalanceUpdate(userId, {
    balance: result.newBalance,
    exposure: result.exposure,
    availableBalance: result.availableBalance,
    changedBy: "ADMIN_CREDIT",
    amount: result.amount,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Balance added successfully"));
});

// ─────────────────────────────────────────────────────────
// GET /api/wallet/statistics
// ─────────────────────────────────────────────────────────
export const getWalletStatistics = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const hasDateFilter = startDate || endDate;
    const dateFilter: Prisma.DateTimeFilter = {
      ...(startDate && { gte: new Date(startDate as string) }),
      ...(endDate && { lte: new Date(endDate as string) }),
    };
    const createdAtFilter = hasDateFilter ? { createdAt: dateFilter } : {};

    const [wallet, ledgerStats, marketExposures] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId } }),
      prisma.ledger.groupBy({
        by: ["type"],
        where: { userId, ...createdAtFilter },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.marketExposure.findMany({
        where: { userId },
        include: { market: { select: { name: true } } },
      }),
    ]);

    if (!wallet) throw new ApiError(404, "Wallet not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          currentBalance: wallet.balance.toString(),
          currentExposure: wallet.exposure.toString(),
          availableBalance: wallet.balance.minus(wallet.exposure).toString(),
          transactions: ledgerStats.map((s) => ({
            type: s.type,
            totalAmount: s._sum.amount?.toString() ?? "0",
            count: s._count,
          })),
          marketExposures: marketExposures.map((e) => ({
            marketId: e.marketId,
            marketName: e.market.name,
            exposureAmount: e.exposureAmount.toString(),
          })),
        },
        "Wallet statistics fetched successfully",
      ),
    );
  },
);
