import {
  cancelOrder,
  getAllMatches,
  getMatchById,
  getOrderBook,
  getOrderById,
  getUserOrders,
  placeOrder,
} from "@/controllers/sport.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// Get matches
router.get("/matches", getAllMatches);

// Get match details
router.get("/matches/:matchId", getMatchById);

router.get("/markets/:marketId/orderbook", getOrderBook);

// Place bet
router.post("/order", verifyToken, placeOrder);

router.delete("/order/:orderId", verifyToken, cancelOrder);

router.get("/orders", verifyToken, getUserOrders);

router.get("/orders/:orderId", verifyToken, getOrderById);

export default router;
