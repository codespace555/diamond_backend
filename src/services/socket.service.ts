import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { prisma } from "@/configs";
import { myEnvironment } from "@/configs/env.config";
import jwt from "jsonwebtoken";
import {
  SOCKET_EVENTS,
  BalanceUpdatePayload,
  BetPlacedPayload,
  BetSettledPayload,
  MatchUpdatePayload,
  OddsUpdatePayload,
  TransferPayload,
  CasinoBetPayload,
  MatchSettledPayload,
  SystemAlertPayload,
} from "@/types/events";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

interface ConnectedUser {
  socketId: string;
  userId: string;
  userRole: string;
  joinedAt: Date;
  rooms: Set<string>;
}

// ─────────────────────────────────────────────
// SOCKET SERVICE
// ─────────────────────────────────────────────

export class SocketService {
  private io: Server;

  // socketId → ConnectedUser
  private connectedUsers = new Map<string, ConnectedUser>();

  // userId → Set<socketId>  (handles multiple tabs)
  private userSockets = new Map<string, Set<string>>();

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: myEnvironment.FRONTEND_URL,
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ["websocket", "polling"],
    });

    this.setupMiddleware();
    this.setupConnectionHandler();

    console.log("🔌 Socket.IO initialized");
  }

  // ─────────────────────────────────────────
  // AUTH MIDDLEWARE
  // ─────────────────────────────────────────

  private setupMiddleware() {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          (socket.handshake.headers?.authorization as string)?.replace(
            "Bearer ",
            "",
          );

        const userId =
          (socket.handshake.auth?.userId as string) ||
          (socket.handshake.query?.userId as string);

        if (token) {
          const decoded = jwt.verify(
            token,
            myEnvironment.JWT_SECRET || "secret",
          ) as any;
          const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true },
          });
          if (user) {
            socket.userId = user.id;
            socket.userRole = user.role;
          }
        } else if (userId) {
          // Demo mode — trust plain userId
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true },
          });
          if (user) {
            socket.userId = user.id;
            socket.userRole = user.role;
          }
        }

        next(); // Always allow connection even without auth
      } catch (err) {
        console.warn("⚠️  Socket auth warning:", (err as Error).message);
        next(); // Don't block on auth error in demo
      }
    });
  }

  // ─────────────────────────────────────────
  // CONNECTION HANDLER
  // ─────────────────────────────────────────

  private setupConnectionHandler() {
    this.io.on("connection", (socket: AuthenticatedSocket) => {
      console.log(
        `✅ Socket connected | id: ${socket.id} | userId: ${socket.userId ?? "guest"}`,
      );

      // Auto-join personal room if auth succeeded
      if (socket.userId) {
        this.joinUserRoom(socket, socket.userId);
      }

      // ── JOIN_USER_ROOM ─────────────────────────────────────────
      socket.on(SOCKET_EVENTS.JOIN_USER_ROOM, (userId: string) => {
        if (!userId || typeof userId !== "string") {
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: "INVALID_USER_ID",
            message: "User ID must be a non-empty string",
          });
          return;
        }
        this.joinUserRoom(socket, userId);
      });

      // ── LEAVE_USER_ROOM ────────────────────────────────────────
      socket.on(SOCKET_EVENTS.LEAVE_USER_ROOM, (userId: string) => {
        const room = `user:${userId}`;
        socket.leave(room);
        console.log(`👋 Socket ${socket.id} left ${room}`);
      });

      // ── JOIN_MATCH_ROOM ────────────────────────────────────────
      socket.on(SOCKET_EVENTS.JOIN_MATCH_ROOM, async (matchId: string) => {
        if (!matchId || typeof matchId !== "string") {
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: "INVALID_MATCH_ID",
            message: "Match ID must be a non-empty string",
          });
          return;
        }

        try {
          const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: {
              id: true,
              teamA: true,
              teamB: true,
              sport: true,
              status: true,
              startTime: true,
            },
          });

          if (!match) {
            socket.emit(SOCKET_EVENTS.ERROR, {
              code: "MATCH_NOT_FOUND",
              message: `Match ${matchId} not found`,
            });
            return;
          }

          const room = `match:${matchId}`;
          socket.join(room);

          // Track room
          const connected = this.connectedUsers.get(socket.id);
          if (connected) connected.rooms.add(room);

          console.log(`⚽ Socket ${socket.id} joined match room ${room}`);

          // Immediately push current match state to the new subscriber
          socket.emit(SOCKET_EVENTS.MATCH_UPDATE, {
            matchId: match.id,
            teamA: match.teamA,
            teamB: match.teamB,
            sport: match.sport,
            status: match.status,
            startTime: match.startTime.toISOString(),
            timestamp: new Date().toISOString(),
          } as MatchUpdatePayload);
        } catch (err) {
          console.error("JOIN_MATCH_ROOM error:", err);
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: "SERVER_ERROR",
            message: "Failed to join match room",
          });
        }
      });

      // ── LEAVE_MATCH_ROOM ───────────────────────────────────────
      socket.on(SOCKET_EVENTS.LEAVE_MATCH_ROOM, (matchId: string) => {
        const room = `match:${matchId}`;
        socket.leave(room);
        console.log(`👋 Socket ${socket.id} left match room ${room}`);
      });

      // ── JOIN_ADMIN_ROOM ────────────────────────────────────────
      socket.on(SOCKET_EVENTS.JOIN_ADMIN_ROOM, async () => {
        if (!socket.userId) {
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: "UNAUTHORIZED",
            message: "Authentication required for admin room",
          });
          return;
        }

        try {
          const user = await prisma.user.findUnique({
            where: { id: socket.userId },
            select: { role: true },
          });

          if (!user || !["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
            socket.emit(SOCKET_EVENTS.ERROR, {
              code: "FORBIDDEN",
              message: "Admin role required",
            });
            return;
          }

          socket.join("admin");
          console.log(`👑 Admin ${socket.userId} joined admin room`);

          // Send live stats to the new admin
          socket.emit("admin_stats", {
            connectedUsers: this.connectedUsers.size,
            onlineUserIds: this.getOnlineUserIds(),
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error("JOIN_ADMIN_ROOM error:", err);
        }
      });

      // ── LEAVE_ADMIN_ROOM ───────────────────────────────────────
      socket.on(SOCKET_EVENTS.LEAVE_ADMIN_ROOM, () => {
        socket.leave("admin");
        console.log(`👑 Admin ${socket.userId} left admin room`);
      });

      // ── PING ──────────────────────────────────────────────────
      socket.on(SOCKET_EVENTS.PING, () => {
        socket.emit(SOCKET_EVENTS.PONG, {
          timestamp: new Date().toISOString(),
        });
      });

      // ── DISCONNECT ────────────────────────────────────────────
      socket.on(SOCKET_EVENTS.DISCONNECT, (reason: string) => {
        console.log(
          `❌ Socket disconnected | id: ${socket.id} | reason: ${reason}`,
        );
        this.handleDisconnect(socket);
      });
    });
  }

  // ─────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────

  private joinUserRoom(socket: AuthenticatedSocket, userId: string) {
    const room = `user:${userId}`;
    socket.join(room);

    const entry: ConnectedUser = {
      socketId: socket.id,
      userId,
      userRole: socket.userRole ?? "USER",
      joinedAt: new Date(),
      rooms: new Set([room]),
    };
    this.connectedUsers.set(socket.id, entry);

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket.id);

    const tabCount = this.userSockets.get(userId)!.size;
    console.log(`🏠 ${userId} in room ${room} (${tabCount} tab(s))`);
  }

  private handleDisconnect(socket: AuthenticatedSocket) {
    const entry = this.connectedUsers.get(socket.id);
    if (entry) {
      const set = this.userSockets.get(entry.userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) this.userSockets.delete(entry.userId);
      }
      this.connectedUsers.delete(socket.id);
    }
  }

  // ─────────────────────────────────────────
  // PUBLIC EMIT — called from controllers
  // ─────────────────────────────────────────

  // ── WALLET ──────────────────────────────────

  emitBalanceUpdate(
    userId: string,
    data: {
      balance: string;
      exposure: string;
      availableBalance: string;
      changedBy: BalanceUpdatePayload["changedBy"];
      amount: number;
    },
  ) {
    const payload: BalanceUpdatePayload = {
      userId,
      timestamp: new Date().toISOString(),
      ...data,
    };
    this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.BALANCE_UPDATE, payload);
  }

  emitTransferSent(fromUserId: string, payload: TransferPayload) {
    this.io.to(`user:${fromUserId}`).emit(SOCKET_EVENTS.TRANSFER_SENT, payload);
  }

  emitTransferReceived(toUserId: string, payload: TransferPayload) {
    this.io
      .to(`user:${toUserId}`)
      .emit(SOCKET_EVENTS.TRANSFER_SUCCESS, payload);
  }

  // ── BETS ────────────────────────────────────

  emitBetPlaced(userId: string, data: Omit<BetPlacedPayload, "timestamp">) {
    const payload: BetPlacedPayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.BET_PLACED, payload);
  }

  emitBetSettled(userId: string, data: Omit<BetSettledPayload, "timestamp">) {
    const payload: BetSettledPayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.BET_SETTLED, payload);
  }

  emitBetRefunded(userId: string, betId: string, amount: number) {
    this.io.to(`user:${userId}`).emit(SOCKET_EVENTS.BET_REFUNDED, {
      betId,
      amount,
      timestamp: new Date().toISOString(),
    });
  }

  // ── MATCH ───────────────────────────────────

  emitMatchUpdate(
    matchId: string,
    data: Omit<MatchUpdatePayload, "timestamp">,
  ) {
    const payload: MatchUpdatePayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.io.to(`match:${matchId}`).emit(SOCKET_EVENTS.MATCH_UPDATE, payload);
  }

  emitOddsUpdate(matchId: string, data: Omit<OddsUpdatePayload, "timestamp">) {
    const payload: OddsUpdatePayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.io.to(`match:${matchId}`).emit(SOCKET_EVENTS.ODDS_UPDATE, payload);
  }

  emitMatchStarted(
    matchId: string,
    matchData: {
      teamA: string;
      teamB: string;
      sport: string;
      startTime: string;
    },
  ) {
    const payload: MatchUpdatePayload = {
      matchId,
      ...matchData,
      status: "LIVE",
      timestamp: new Date().toISOString(),
    };
    this.io.to(`match:${matchId}`).emit(SOCKET_EVENTS.MATCH_STARTED, payload);
    this.io.to("admin").emit(SOCKET_EVENTS.MATCH_STARTED, payload);
  }

  emitMatchCompleted(matchId: string, data: MatchSettledPayload) {
    const payload = { ...data, settledAt: new Date().toISOString() };
    this.io.to(`match:${matchId}`).emit(SOCKET_EVENTS.MATCH_COMPLETED, payload);
    this.io.to("admin").emit(SOCKET_EVENTS.MATCH_SETTLED, payload);
  }

  emitMatchCancelled(matchId: string, reason?: string) {
    this.io.to(`match:${matchId}`).emit(SOCKET_EVENTS.MATCH_CANCELLED, {
      matchId,
      reason: reason ?? "Match cancelled",
      timestamp: new Date().toISOString(),
    });
  }

  // ── CASINO ──────────────────────────────────

  emitCasinoTransaction(
    userId: string,
    data: Omit<CasinoBetPayload, "timestamp">,
  ) {
    const payload: CasinoBetPayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    const event =
      data.type === "WIN"
        ? SOCKET_EVENTS.CASINO_WIN
        : data.type === "LOSS"
          ? SOCKET_EVENTS.CASINO_LOSS
          : SOCKET_EVENTS.CASINO_BET_PLACED;
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  // ── ADMIN ───────────────────────────────────

  emitNewUserCreated(user: {
    id: string;
    name: string;
    role: string;
    createdAt: string;
  }) {
    this.io.to("admin").emit(SOCKET_EVENTS.NEW_USER_CREATED, {
      ...user,
      timestamp: new Date().toISOString(),
    });
  }

  emitSystemAlert(data: Omit<SystemAlertPayload, "timestamp">) {
    const payload: SystemAlertPayload = {
      ...data,
      timestamp: new Date().toISOString(),
    };
    this.io.to("admin").emit(SOCKET_EVENTS.SYSTEM_ALERT, payload);
  }

  // ── GLOBAL ──────────────────────────────────

  emitGlobal(event: string, data: any) {
    this.io.emit(event, { ...data, timestamp: new Date().toISOString() });
  }

  // ── STATS ───────────────────────────────────

  getConnectedCount() {
    return this.connectedUsers.size;
  }
  isUserOnline(userId: string) {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }
  getOnlineUserIds() {
    return Array.from(this.userSockets.keys());
  }
  getIO() {
    return this.io;
  }
}
