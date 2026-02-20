import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { myEnvironment, prisma } from "@/configs";
import { ApiError, asyncHandler } from "@/utils";
import { UserRole } from "@/generated/prisma/enums";

interface TokenPayload extends JwtPayload {
  id: string;
}

export const verifyToken = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token =
      req.cookies?.accessToken || req.headers.authorization?.split(" ")[1];

    if (!token) {
      throw new ApiError(401, "Access token required");
    }

    let decoded: TokenPayload;

    try {
      decoded = jwt.verify(
        token,
        myEnvironment.JWT_SECRET as string,
      ) as TokenPayload;
    } catch (error) {
      throw new ApiError(401, "Invalid or expired token");
    }

    if (!decoded?.id) {
      throw new ApiError(401, "Invalid token payload");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        isBanned: true,
      },
    });

    if (!user) {
      throw new ApiError(401, "User not found");
    }

    if (user.isBanned) {
      throw new ApiError(403, "Account suspended. Contact support.");
    }

    // Now TypeScript knows req.user exists
    req.user = user;

    next();
  },
);

export const requireRole = (roles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new ApiError(401, "Authentication required");
    }

    if (!roles.includes(req.user.role as UserRole)) {
      throw new ApiError(403, "Insufficient permissions");
    }

    next();
  };
};
