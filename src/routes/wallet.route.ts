import {
  addBalance,
  getLedger,
  getWallet,
  getWalletStatistics,
  lockExposure,
  releaseExposure,
  transferCoins,
} from "@/controllers/wallet.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

// Get wallet
router.get("/", verifyToken, getWallet);

// Get ledger
router.get("/ledger", verifyToken, getLedger);

router.post("/lock-exposure", verifyToken, lockExposure);

router.post("/release-exposure",verifyToken,releaseExposure);

// Transfer coins
router.post("/transfer", verifyToken, transferCoins);

// Add balance (Admin only)
router.post("/add-balance", verifyToken, addBalance);

// Get wallet statistics
router.get("/statistics", verifyToken, getWalletStatistics);


export default router;
