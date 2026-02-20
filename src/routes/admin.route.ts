import {
  createMatch,
  createUser,
  createMarket,
  forceCloseMarket,
  getAllUsers,
  getMarketOrders,
  getMarketTrades,
  updateMarketStatus,
  updateMatchStatus,
  updateUser,
  deleteUser,
  banUser,
  unbanUser,
  getTrades,
  getStats,
  sendNotification,
} from "@/controllers/admin.controller";
import { UserRole } from "@/generated/prisma/enums";
import { verifyToken, requireRole } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// ── Users ────────────────────────────────────────────────
router.get(
  "/users",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT]),
  getAllUsers,
);

router.post(
  "/users",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT]),
  createUser,
);

router.patch(
  "/users/:userId",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  updateUser,
);

router.delete(
  "/users/:userId",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN]),
  deleteUser,
);

router.post(
  "/users/:userId/ban",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  banUser,
);

router.post(
  "/users/:userId/unban",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  unbanUser,
);

// ── Matches ──────────────────────────────────────────────
router.post(
  "/matches",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  createMatch,
);

router.patch(
  "/matches/:matchId/status",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  updateMatchStatus,
);

// ── Market management ────────────────────────────────────
router.post(
  "/markets",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  createMarket,
);

router.patch(
  "/markets/:marketId/status",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  updateMarketStatus,
);

router.post(
  "/markets/:marketId/force-close",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  forceCloseMarket,
);

// ── Monitoring ───────────────────────────────────────────
router.get(
  "/markets/:marketId/orders",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  getMarketOrders,
);

router.get(
  "/markets/:marketId/trades",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  getMarketTrades,
);

router.get(
  "/trades",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  getTrades,
);

router.get(
  "/stats",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  getStats,
);

// ── Notifications ────────────────────────────────────────
router.post(
  "/notifications",
  verifyToken,
  requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]),
  sendNotification,
);

export default router;
