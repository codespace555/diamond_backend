import {
  getSports,
  getOdds,
  getScores,
  getUpcomingOdds,
} from "@/controllers/odds.controller";
import { UserRole } from "@/generated/prisma/enums";
import { verifyToken, requireRole } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

router.use(verifyToken, requireRole([UserRole.SUPER_ADMIN, UserRole.ADMIN]));

// Get available sports
router.get("/sports", getSports);

// Get odds for a sport
router.get("/sports/:sport/odds", getOdds);

// Get scores for a sport
router.get("/sports/:sport/scores", getScores);

// Get upcoming odds
router.get("/upcoming", getUpcomingOdds);

export default router;
