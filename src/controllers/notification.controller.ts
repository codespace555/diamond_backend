import { Request, Response } from "express";
import { prisma } from "@/configs";
import { ApiError, ApiResponse, asyncHandler } from "@/utils";

// ─────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────
export const getNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          notifications,
          "Notifications fetched successfully",
        ),
      );
  },
);

// ─────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// ─────────────────────────────────────────────────────────
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  await prisma.notification.updateMany({
    where: { id: req.params.id as string, userId: req.user.id },
    data: { read: true },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, { success: true }, "Notification marked as read"),
    );
});

// ─────────────────────────────────────────────────────────
// POST /api/notifications/mark-all-read
// ─────────────────────────────────────────────────────────
export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Authentication required");

  await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { success: true },
        "All notifications marked as read",
      ),
    );
});
