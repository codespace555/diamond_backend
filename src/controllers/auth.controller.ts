import { Request, Response } from "express";
import { myEnvironment, prisma } from "@/configs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ApiError, ApiResponse, asyncHandler } from "@/utils";

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password)
    throw new ApiError(400, "Email and password are required");

  const user = await prisma.user.findUnique({
    where: { email },
    include: { wallet: true },
  });

  if (!user) throw new ApiError(401, "Invalid credentials");

  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) throw new ApiError(401, "Invalid credentials");

  const token = jwt.sign(
    { id: user.id },
    myEnvironment.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  res.cookie("accessToken", token, {
    httpOnly: true,
    secure: myEnvironment.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: myEnvironment.NODE_ENV === "production" ? "none" : "lax",
  });

  const { password: _, ...userWithoutPassword } = user;

  return res.status(200).json(
    new ApiResponse(200, { token, user: userWithoutPassword }, "Login successful")
  );
});

export const getCurrentUser = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        wallet: true,
        parent: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    if (!user) throw new ApiError(404, "User not found");

    const { password, ...userWithoutPassword } = user;

    return res
      .status(200)
      .json(new ApiResponse(200, userWithoutPassword, "User fetched successfully"));
  }
);

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name)
    throw new ApiError(400, "Email, password, and name are required");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(400, "Email already exists");

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: "USER",
        wallet: { create: { balance: 0, exposure: 0 } },
      },
      include: { wallet: true },
    });

    await tx.ledger.create({
      data: {
        userId: newUser.id,
        amount: 0,
        type: "CREDIT",
        balance: 0,
        notes: "Account created",
      },
    });

    return newUser;
  });

  const token = jwt.sign(
    { id: user.id },
    myEnvironment.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  res.cookie("accessToken", token, {
    httpOnly: true,
    secure: myEnvironment.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: myEnvironment.NODE_ENV === "production" ? "none" : "lax",
  });

  const { password: _, ...userWithoutPassword } = user;

  return res.status(201).json(
    new ApiResponse(201, { token, user: userWithoutPassword }, "User registered successfully")
  );
});

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError(401, "Authentication required");

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      throw new ApiError(400, "Current password and new password are required");

    if (newPassword.length < 6)
      throw new ApiError(400, "New password must be at least 6 characters");

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, password: true },
    });

    if (!user) throw new ApiError(404, "User not found");

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) throw new ApiError(401, "Current password is incorrect");

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword)
      throw new ApiError(400, "New password must be different from current password");

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Password changed successfully"));
  }
);

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: myEnvironment.NODE_ENV === "production",
    sameSite: myEnvironment.NODE_ENV === "production" ? "none" : "lax",
  });

  return res.status(200).json(new ApiResponse(200, null, "Logout successful"));
});