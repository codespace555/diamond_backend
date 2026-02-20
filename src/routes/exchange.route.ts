import {
  placeOrder,
  cancelOrder,
  getUserOrders,
  getOrderById,
  getOrderBook,
  getAllMatches,
  getMatchById,
  getReferenceOdds,
} from "@/controllers/sport.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// ── Public routes ────────────────────────────────────────
// Browse matches and markets (no auth required)
router.get("/matches", getAllMatches);
router.get("/matches/:matchId", getMatchById);

// Order book & reference odds for a market
router.get("/markets/:marketId/orderbook", getOrderBook);
router.get("/markets/:marketId/reference-odds", getReferenceOdds);

// ── Authenticated routes ─────────────────────────────────
// User's orders (list must come before :orderId param route)
router.get("/orders", verifyToken, getUserOrders);
router.get("/orders/:orderId", verifyToken, getOrderById);

// Place & cancel orders
router.post("/orders", verifyToken, placeOrder);
router.delete("/orders/:orderId", verifyToken, cancelOrder);

export default router;
