# Diamond — Sports Betting & Casino Exchange Platform

A monolithic Node.js/Express backend for a sports betting exchange with casino integration, real-time WebSocket events, and a hierarchical user system.

---

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Database**: PostgreSQL via Prisma ORM (with `@prisma/adapter-pg`)
- **Real-time**: Socket.IO
- **Auth**: JWT (cookie + bearer token)
- **Language**: TypeScript

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, PORT, NODE_ENV

# 3. Push schema to database
npx prisma db push

# 4. Generate Prisma client
npx prisma generate

# 5. Start development server
npm run dev
```

### Environment Variables

| Variable       | Required | Description                      |
| -------------- | -------- | -------------------------------- |
| `DATABASE_URL` | Yes      | PostgreSQL connection string     |
| `DIRECT_URL`   | No       | Direct DB URL (for migrations)   |
| `JWT_SECRET`   | Yes      | Secret key for JWT signing       |
| `PORT`         | Yes      | Server port (default: `8080`)    |
| `NODE_ENV`     | Yes      | `development` or `production`    |
| `ODDS_API_KEY` | No       | The Odds API key (for live odds) |
| `FRONTEND_URL` | No       | CORS origin for Socket.IO        |

---

## API Reference

**Base URL**: `http://localhost:{PORT}/api`

All responses follow a standard envelope:

```json
{
  "statusCode": 200,
  "data": { ... },
  "message": "Success message",
  "success": true
}
```

Error responses:

```json
{
  "statusCode": 400,
  "data": null,
  "message": "Error description",
  "success": false
}
```

---

### Health Check

| Method | Endpoint  | Auth | Description   |
| ------ | --------- | ---- | ------------- |
| GET    | `/health` | No   | Server health |

**Response**:

```json
{
  "status": "OK",
  "timestamp": "2026-02-18T06:00:00.000Z",
  "uptime": 12345.67
}
```

---

### Auth (`/api/auth`)

| Method | Endpoint                | Auth | Description               |
| ------ | ----------------------- | ---- | ------------------------- |
| POST   | `/auth/login`           | No   | Login with email/password |
| POST   | `/auth/register`        | No   | Register a new user       |
| GET    | `/auth/me`              | Yes  | Get current user profile  |
| POST   | `/auth/change-password` | Yes  | Change password           |
| POST   | `/auth/logout`          | Yes  | Logout (clears cookie)    |

#### POST `/auth/login`

**Body**:

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

**Response** `200`:

```json
{
  "token": "eyJhb...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John",
    "role": "USER",
    "wallet": { "balance": "1000.00", "exposure": "0.00" }
  }
}
```

#### POST `/auth/register`

**Body**:

```json
{
  "email": "user@example.com",
  "password": "secret123",
  "name": "John Doe"
}
```

**Response** `201`: Same as login response.

#### GET `/auth/me`

**Headers**: `Authorization: Bearer <token>` or cookie `accessToken`

**Response** `200`:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John",
  "role": "USER",
  "wallet": { "balance": "1000.00", "exposure": "50.00" },
  "parent": {
    "id": "uuid",
    "name": "Admin",
    "email": "admin@example.com",
    "role": "ADMIN"
  }
}
```

#### POST `/auth/change-password`

**Body**:

```json
{
  "currentPassword": "oldPass",
  "newPassword": "newPass123"
}
```

**Response** `200`: `"Password changed successfully"`

#### POST `/auth/logout`

**Response** `200`: `"Logout successful"`

---

### Admin (`/api/admin`)

All admin routes require authentication and `SUPER_ADMIN` or `ADMIN` role.

| Method | Endpoint                               | Description                         |
| ------ | -------------------------------------- | ----------------------------------- |
| GET    | `/admin/users`                         | List all users (paginated)          |
| POST   | `/admin/users`                         | Create a sub-user                   |
| POST   | `/admin/matches`                       | Create a match with markets/runners |
| PATCH  | `/admin/matches/:matchId/status`       | Update match status                 |
| GET    | `/admin/markets/:marketId/orders`      | View all orders in a market         |
| GET    | `/admin/markets/:marketId/trades`      | View all trades in a market         |
| PATCH  | `/admin/markets/:marketId/status`      | Suspend/unsuspend/close a market    |
| POST   | `/admin/markets/:marketId/force-close` | Force-close & settle a market       |

#### GET `/admin/users`

**Query Params**:

| Param    | Type   | Default | Description              |
| -------- | ------ | ------- | ------------------------ |
| `page`   | number | 1       | Page number              |
| `limit`  | number | 20      | Items per page (max 100) |
| `role`   | string | —       | Filter by role           |
| `search` | string | —       | Search name or email     |

**Response** `200`:

```json
{
  "users": [
    {
      "id": "uuid",
      "name": "John",
      "email": "john@example.com",
      "role": "USER",
      "parentId": "uuid",
      "createdAt": "2026-02-18T...",
      "wallet": { "balance": "1000.00", "exposure": "50.00" },
      "availableBalance": "950.00"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
}
```

#### POST `/admin/users`

**Body**:

```json
{
  "email": "agent@example.com",
  "password": "password123",
  "name": "Agent Smith",
  "role": "AGENT",
  "parentId": "optional-parent-uuid"
}
```

**Response** `201`: Created user object with wallet.

#### POST `/admin/matches`

**Body**:

```json
{
  "teamA": "Manchester United",
  "teamB": "Liverpool",
  "sport": "soccer_epl",
  "startTime": "2026-03-01T15:00:00Z",
  "externalId": "optional-odds-api-id",
  "markets": [
    {
      "name": "Match Odds",
      "runners": [
        { "name": "Manchester United", "backOdds": 2.5, "layOdds": 2.52 },
        { "name": "Liverpool", "backOdds": 2.8, "layOdds": 2.82 },
        { "name": "Draw", "backOdds": 3.2, "layOdds": 3.22 }
      ]
    }
  ]
}
```

If `markets` is omitted, a default "Match Odds" market with teamA/teamB/Draw runners is created (default odds: 2.00 back / 2.02 lay).

**Response** `201`: Match with nested markets and runners.

#### PATCH `/admin/matches/:matchId/status`

**Body**:

```json
{
  "status": "LIVE"
}
```

Valid statuses: `UPCOMING`, `LIVE`, `COMPLETED`, `CANCELLED`

#### PATCH `/admin/markets/:marketId/status`

**Body**:

```json
{
  "status": "SUSPENDED"
}
```

Valid statuses: `OPEN`, `SUSPENDED`, `CLOSED`

#### POST `/admin/markets/:marketId/force-close`

Force-close a market, cancel all open orders, and settle all trades.

**Body**:

```json
{
  "winnerSelectionIds": ["runner-uuid-1"]
}
```

If `winnerSelectionIds` is empty/omitted, all trades are refunded (abandoned match).

**Response** `200`:

```json
{
  "cancelledOrders": 12,
  "settledTrades": 8
}
```

---

### Sports (`/api/sports`)

| Method | Endpoint                              | Auth | Description                    |
| ------ | ------------------------------------- | ---- | ------------------------------ |
| GET    | `/sports/matches`                     | No   | List all matches (paginated)   |
| GET    | `/sports/matches/:matchId`            | No   | Get match details with markets |
| GET    | `/sports/markets/:marketId/orderbook` | No   | Get aggregated order book      |
| POST   | `/sports/order`                       | Yes  | Place a BACK or LAY order      |
| DELETE | `/sports/order/:orderId`              | Yes  | Cancel an open/partial order   |
| GET    | `/sports/orders`                      | Yes  | List user's orders             |
| GET    | `/sports/orders/:orderId`             | Yes  | Get order detail with trades   |

#### GET `/sports/matches`

**Query Params**:

| Param    | Type   | Default | Description             |
| -------- | ------ | ------- | ----------------------- |
| `sport`  | string | —       | Filter by sport key     |
| `status` | string | —       | Filter by match status  |
| `search` | string | —       | Search team names       |
| `page`   | number | 1       | Page number             |
| `limit`  | number | 20      | Items per page (max 50) |

**Response** `200`:

```json
{
  "matches": [
    {
      "id": "uuid",
      "teamA": "Manchester United",
      "teamB": "Liverpool",
      "sport": "soccer_epl",
      "status": "LIVE",
      "startTime": "2026-03-01T15:00:00.000Z",
      "markets": [
        {
          "id": "uuid",
          "name": "Match Odds",
          "status": "OPEN",
          "runners": [
            {
              "id": "uuid",
              "name": "Manchester United",
              "referenceOdds": [
                {
                  "referenceBackPrice": "2.50",
                  "referenceLayPrice": "2.52",
                  "lastUpdated": "..."
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasMore": true
  }
}
```

#### GET `/sports/markets/:marketId/orderbook`

**Query Params**:

| Param         | Type   | Required | Description         |
| ------------- | ------ | -------- | ------------------- |
| `selectionId` | string | Yes      | Runner/selection ID |

**Response** `200`:

```json
{
  "marketId": "uuid",
  "selectionId": "uuid",
  "referenceOdds": {
    "referenceBackPrice": "2.50",
    "referenceLayPrice": "2.52"
  },
  "back": [{ "price": "2.50", "availableStake": "500.00", "orderCount": 3 }],
  "lay": [{ "price": "2.52", "availableStake": "200.00", "orderCount": 1 }]
}
```

#### POST `/sports/order`

**Body**:

```json
{
  "marketId": "uuid",
  "selectionId": "uuid",
  "side": "BACK",
  "price": 2.5,
  "stake": 100
}
```

- `side`: `BACK` or `LAY`
- `price`: Must be > 1.00
- `stake`: Must be > 0

The matching engine automatically attempts to match the order against opposite-side orders using price-time priority.

**Response** `201`:

```json
{
  "order": {
    "id": "uuid",
    "side": "BACK",
    "price": "2.50",
    "stake": "100.00",
    "matchedStake": "50.00",
    "remainingStake": "50.00",
    "status": "PARTIAL"
  },
  "trades": [{ "tradeId": "uuid", "price": "2.50", "stake": "50.00" }],
  "matchedStake": "50.00",
  "remainingStake": "50.00",
  "status": "PARTIAL"
}
```

#### DELETE `/sports/order/:orderId`

**Response** `200`:

```json
{
  "orderId": "uuid",
  "releasedExposure": "100.00",
  "newExposure": "50.00",
  "availableBalance": "950.00"
}
```

---

### Exchange (`/api/exchange`)

The exchange endpoints provide the same order/market functionality as sports but organized as a dedicated exchange API.

| Method | Endpoint                                     | Auth | Description                     |
| ------ | -------------------------------------------- | ---- | ------------------------------- |
| GET    | `/exchange/matches`                          | No   | List matches                    |
| GET    | `/exchange/matches/:matchId`                 | No   | Get match detail                |
| GET    | `/exchange/markets/:marketId/orderbook`      | No   | Get order book                  |
| GET    | `/exchange/markets/:marketId/reference-odds` | No   | Get reference odds for a market |
| GET    | `/exchange/orders`                           | Yes  | List user's orders              |
| GET    | `/exchange/orders/:orderId`                  | Yes  | Get order detail                |
| POST   | `/exchange/orders`                           | Yes  | Place order                     |
| DELETE | `/exchange/orders/:orderId`                  | Yes  | Cancel order                    |

#### GET `/exchange/markets/:marketId/reference-odds`

**Response** `200`:

```json
{
  "marketId": "uuid",
  "marketName": "Match Odds",
  "marketStatus": "OPEN",
  "referenceOdds": [
    {
      "selectionId": "uuid",
      "selectionName": "Manchester United",
      "backPrice": "2.50",
      "layPrice": "2.52",
      "lastUpdated": "2026-02-18T06:00:00.000Z"
    }
  ]
}
```

---

### Casino (`/api/casino`)

| Method | Endpoint                | Auth | Description                     |
| ------ | ----------------------- | ---- | ------------------------------- |
| GET    | `/casino/games`         | No   | List games (paginated)          |
| GET    | `/casino/games/:gameId` | No   | Get game detail                 |
| GET    | `/casino/categories`    | No   | List game categories            |
| POST   | `/casino/launch`        | Yes  | Get game launch URL             |
| POST   | `/casino/bet`           | Yes  | Place a casino bet              |
| POST   | `/casino/win`           | Yes  | Process a casino win            |
| GET    | `/casino/transactions`  | Yes  | List user's casino transactions |
| GET    | `/casino/statistics`    | Yes  | Get casino statistics           |

#### GET `/casino/games`

**Query Params**:

| Param      | Type   | Default | Description         |
| ---------- | ------ | ------- | ------------------- |
| `category` | string | —       | Filter by category  |
| `search`   | string | —       | Search name or slug |
| `page`     | number | 1       | Page number         |
| `limit`    | number | 20      | Items per page      |

#### POST `/casino/bet`

**Body**:

```json
{
  "gameId": "uuid",
  "amount": 50
}
```

**Response** `201`:

```json
{
  "transaction": {
    "id": "uuid",
    "type": "BET",
    "amount": "50.00",
    "balanceBefore": "1000.00",
    "balanceAfter": "950.00"
  },
  "newBalance": "950.00",
  "exposure": "0.00",
  "availableBalance": "950.00"
}
```

#### POST `/casino/win`

**Body**:

```json
{
  "gameId": "uuid",
  "amount": 150
}
```

**Response** `200`: Same structure as bet response with `type: "WIN"`.

---

### Wallet (`/api/wallet`)

All wallet routes require authentication.

| Method | Endpoint                   | Auth  | Description                      |
| ------ | -------------------------- | ----- | -------------------------------- |
| GET    | `/wallet`                  | Yes   | Get wallet balance & exposure    |
| GET    | `/wallet/ledger`           | Yes   | Get transaction history          |
| GET    | `/wallet/statistics`       | Yes   | Get wallet statistics            |
| POST   | `/wallet/transfer`         | Yes   | Transfer to a direct child user  |
| POST   | `/wallet/add-balance`      | Admin | Add balance to any user's wallet |
| POST   | `/wallet/lock-exposure`    | Admin | Manually lock exposure           |
| POST   | `/wallet/release-exposure` | Admin | Manually release exposure        |

#### GET `/wallet`

**Response** `200`:

```json
{
  "id": "uuid",
  "userId": "uuid",
  "balance": "1000.00",
  "exposure": "50.00",
  "availableBalance": "950.00",
  "user": {
    "id": "uuid",
    "name": "John",
    "email": "john@example.com",
    "role": "USER"
  }
}
```

#### GET `/wallet/ledger`

**Query Params**:

| Param       | Type   | Default | Description              |
| ----------- | ------ | ------- | ------------------------ |
| `page`      | number | 1       | Page number              |
| `limit`     | number | 50      | Items per page (max 200) |
| `type`      | string | —       | Filter by ledger type    |
| `startDate` | string | —       | ISO date filter start    |
| `endDate`   | string | —       | ISO date filter end      |

Ledger types: `CREDIT`, `DEBIT`, `TRANSFER_IN`, `TRANSFER_OUT`, `BET_PLACE`, `BET_SETTLE`, `BET_REFUND`, `ORDER_PLACE`, `ORDER_CANCEL`, `ORDER_SETTLE`, `EXPOSURE_LOCK`, `EXPOSURE_RELEASE`

#### POST `/wallet/transfer`

**Body**:

```json
{
  "toUserId": "uuid",
  "amount": 100,
  "notes": "Optional notes"
}
```

Transfers are only allowed to **direct child users** in the hierarchy.

**Response** `200`:

```json
{
  "fromBalance": "900.00",
  "toBalance": "1100.00",
  "amount": 100
}
```

#### POST `/wallet/add-balance` (Admin)

**Body**:

```json
{
  "userId": "uuid",
  "amount": 500,
  "notes": "Promotional credit"
}
```

---

## WebSocket Events

Connect to Socket.IO at the server root. Supports both `websocket` and `polling` transports.

### Authentication

Pass a JWT token or userId during handshake:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:8080", {
  auth: { token: "eyJhb..." },
  // or: auth: { userId: "uuid" }
});
```

### Client → Server Events

| Event              | Payload           | Description                   |
| ------------------ | ----------------- | ----------------------------- |
| `join_user_room`   | `userId: string`  | Subscribe to personal updates |
| `leave_user_room`  | `userId: string`  | Unsubscribe personal updates  |
| `join_match_room`  | `matchId: string` | Subscribe to match updates    |
| `leave_match_room` | `matchId: string` | Unsubscribe match updates     |
| `join_admin_room`  | —                 | Join admin dashboard room     |
| `leave_admin_room` | —                 | Leave admin dashboard room    |
| `ping`             | —                 | Heartbeat                     |

### Server → Client Events

| Event               | Room         | Description                              |
| ------------------- | ------------ | ---------------------------------------- |
| `balance_update`    | `user:{id}`  | Wallet balance/exposure changed          |
| `transfer_sent`     | `user:{id}`  | You sent a transfer                      |
| `transfer_success`  | `user:{id}`  | You received a transfer                  |
| `bet_placed`        | `user:{id}`  | Your bet was placed                      |
| `bet_settled`       | `user:{id}`  | Your bet was settled (WON/LOST/REFUNDED) |
| `bet_refunded`      | `user:{id}`  | Your bet was refunded                    |
| `match_update`      | `match:{id}` | Match status changed                     |
| `odds_update`       | `match:{id}` | Live odds changed                        |
| `match_started`     | `match:{id}` | Match went LIVE                          |
| `match_completed`   | `match:{id}` | Match finished                           |
| `match_cancelled`   | `match:{id}` | Match cancelled                          |
| `casino_bet_placed` | `user:{id}`  | Casino bet placed                        |
| `casino_win`        | `user:{id}`  | Casino win processed                     |
| `casino_loss`       | `user:{id}`  | Casino loss processed                    |
| `new_user_created`  | `admin`      | Admin: new user registered               |
| `match_settled`     | `admin`      | Admin: match settlement complete         |
| `system_alert`      | `admin`      | Admin: system alert                      |
| `pong`              | direct       | Heartbeat response                       |
| `error`             | direct       | Error notification                       |

---

## Data Models

### User Hierarchy

Users have a parent-child hierarchy: `SUPER_ADMIN` → `ADMIN` → `AGENT` → `USER`.

Transfers are only allowed from parent to direct child.

### Exchange Order Flow

1. User places a BACK or LAY order with a price and stake.
2. The **matching engine** immediately tries to match against opposite-side orders using **price-time priority**.
3. Matched portions create **Trade** records.
4. Unmatched remainder stays in the order book as `OPEN` or `PARTIAL`.
5. Exposure is locked in the user's wallet for the duration of unmatched orders.
6. On market settlement, trades are settled and exposure is released.

### Exposure Calculation

- **BACK order**: exposure = stake (max loss is the full stake)
- **LAY order**: exposure = (price - 1) × stake (max loss is proportional to odds)

---

## Project Structure

```
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app.ts                 # Express app setup
│   ├── server.ts              # HTTP server + Socket.IO init
│   ├── configs/               # Environment & database config
│   ├── controllers/           # Route handlers
│   │   ├── admin.controller   # User mgmt, match/market admin
│   │   ├── auth.controller    # Login, register, change password
│   │   ├── casino.controller  # Casino games, bets, wins
│   │   ├── sport.controller   # Matches, orders, order book
│   │   └── wallet.controller  # Wallet, ledger, transfers
│   ├── middlewares/
│   │   ├── auth.middleware     # JWT verification & role check
│   │   └── error.middleware    # Global error handler
│   ├── routes/                # Express route definitions
│   ├── services/
│   │   ├── matching-engine    # Price-time priority order matching
│   │   ├── odds-polling       # External odds API polling
│   │   ├── settlement         # Auto-settlement via score API
│   │   └── socket             # Socket.IO event management
│   ├── types/                 # TypeScript type declarations
│   └── utils/                 # ApiError, ApiResponse, asyncHandler
└── package.json
```

---

## Scripts

```bash
npm run dev      # Start dev server with hot reload (tsx watch)
npm run build    # Build for production (tsdown)
npm start        # Run production build
```
