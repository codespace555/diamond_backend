import { Router } from "express";
import authRoute from "./auth.route";
import adminRoute from "./admin.route";
import sportRoute from "./sport.route";
import casinoRoute from "./casino.route";
import walletRoute from "./wallet.route";
import exchangeRoute from "./exchange.route";
import notificationRoute from "./notification.route";
import oddsRoute from "./odds.route";

const router = Router();

router.use("/auth", authRoute);
router.use("/admin", adminRoute);
router.use("/sports", sportRoute);
router.use("/casino", casinoRoute);
router.use("/wallet", walletRoute);
router.use("/exchange", exchangeRoute);
router.use("/notifications", notificationRoute);
router.use("/odds", oddsRoute);

export default router;
