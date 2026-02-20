import {
  getNotifications,
  markRead,
  markAllRead,
} from "@/controllers/notification.controller";
import { verifyToken } from "@/middlewares/auth.middleware";
import { Router } from "express";

const router = Router();

router.use(verifyToken);

// Get notifications
router.get("/", getNotifications);

// Mark single notification as read
router.patch("/:id/read", markRead);

// Mark all notifications as read
router.post("/mark-all-read", markAllRead);

export default router;
