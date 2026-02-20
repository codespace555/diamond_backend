// =============================================
// SOCKET EVENTS - Single source of truth
// Import these on both server and client
// =============================================

export const SOCKET_EVENTS = {
  // ── Connection ──────────────────────────────
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECT_ERROR: "connect_error",

  // ── Client → Server (emit from client) ──────
  JOIN_USER_ROOM: "join_user_room", // join personal room
  LEAVE_USER_ROOM: "leave_user_room",
  JOIN_MATCH_ROOM: "join_match_room", // subscribe to match
  LEAVE_MATCH_ROOM: "leave_match_room",
  JOIN_ADMIN_ROOM: "join_admin_room", // admins dashboard
  LEAVE_ADMIN_ROOM: "leave_admin_room",
  PING: "ping", // heartbeat

  // ── Server → Client (listen on client) ──────

  // Wallet
  BALANCE_UPDATE: "balance_update", // balance / exposure changed
  TRANSFER_SUCCESS: "transfer_success", // received a transfer
  TRANSFER_SENT: "transfer_sent", // sent a transfer

  // Bets
  BET_PLACED: "bet_placed", // your bet was placed
  BET_SETTLED: "bet_settled", // your bet result
  BET_REFUNDED: "bet_refunded", // your bet was refunded

  // Sports / Match
  MATCH_UPDATE: "match_update", // match status change
  ODDS_UPDATE: "odds_update", // live odds changed
  MATCH_STARTED: "match_started",
  MATCH_COMPLETED: "match_completed",
  MATCH_CANCELLED: "match_cancelled",

  // Casino
  CASINO_BET_PLACED: "casino_bet_placed",
  CASINO_WIN: "casino_win",
  CASINO_LOSS: "casino_loss",

  // Admin
  NEW_USER_CREATED: "new_user_created", // admin broadcast
  MATCH_SETTLED: "match_settled", // admin broadcast after settlement
  SYSTEM_ALERT: "system_alert", // global admin alert

  // Errors
  ERROR: "error",
  PONG: "pong",
} as const;

// =============================================
// PAYLOAD TYPES
// =============================================

export interface BalanceUpdatePayload {
  userId?: string;
  balance: string;
  exposure: string;
  availableBalance: string;
  changedBy:
    | "BET_PLACE"
    | "BET_SETTLE"
    | "BET_REFUND"
    | "ORDER_PLACE"
    | "ORDER_CANCEL"
    | "ORDER_SETTLE"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "CASINO_BET"
    | "CASINO_WIN"
    | "ADMIN_CREDIT"
    | "ADMIN_DEBIT";
  amount: number;
  timestamp?: string;
}

export interface BetPlacedPayload {
  betId: string;
  matchId: string;
  matchName: string;
  runnerName: string;
  type: "BACK" | "LAY";
  odds: number;
  stake: number;
  liability: number;
  status: "PENDING";
  timestamp: string;
}

export interface BetSettledPayload {
  betId: string;
  matchId: string;
  matchName: string;
  runnerName: string;
  type: "BACK" | "LAY";
  status: "WON" | "LOST" | "REFUNDED";
  stake: number;
  payout: number;
  profitLoss: number;
  timestamp: string;
}

export interface MatchUpdatePayload {
  matchId: string;
  teamA: string;
  teamB: string;
  sport: string;
  status: "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";
  startTime: string;
  timestamp: string;
}

export interface OddsUpdatePayload {
  matchId: string;
  marketId: string;
  selectionId: string;
  selectionName: string;
  referenceBackPrice: number;
  referenceLayPrice: number;
  timestamp?: string;
}

export interface TransferPayload {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  amount: number;
  newBalance: string;
  timestamp: string;
}

export interface CasinoBetPayload {
  transactionId: string;
  gameId: string;
  gameName: string;
  type: "BET" | "WIN" | "LOSS";
  amount: number;
  balanceBefore: string;
  balanceAfter: string;
  timestamp: string;
}

export interface MatchSettledPayload {
  matchId: string;
  matchName: string;
  winnerRunnerId: string;
  winnerName: string;
  totalBets: number;
  settledAt: string;
}

export interface SystemAlertPayload {
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface OrderBookEntry {
  price: number;
  availableStake: number;
  orderCount: number;
}

export interface OrderBookPayload {
  marketId: string;
  selectionId: string;
  back: OrderBookEntry[];
  lay: OrderBookEntry[];
}

export interface TradePayload {
  tradeId: string;
  marketId: string;
  selectionId: string;
  price: number;
  stake: number;
}
