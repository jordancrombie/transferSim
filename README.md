# TransferSim

A peer-to-peer (P2P) transfer network enabling real-time money transfers between users across multiple BSIM (Bank Simulator) instances. Think Zelle or Interac e-Transfer for the BSIM ecosystem.

## Status

**Production:** Deployed and operational on AWS ECS
**Version:** 0.1.0

## Overview

TransferSim acts as the central coordinator for P2P transfers, managing:

- **Alias Registry** - Email, phone, username, and random key aliases
- **Transfer Engine** - Cross-bank transfer initiation, routing, and completion
- **Orchestrator Management** - Mobile apps (mwsim) and web apps that initiate transfers
- **QR/NFC Tokens** - Device-to-device transfer tokens

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           P2P Transfer Network                               │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         TransferSim                                      │ │
│  │                                                                         │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │ │
│  │  │  Alias Registry │  │ Transfer Engine │  │  Orchestrator Manager   │ │ │
│  │  │                 │  │                 │  │                         │ │ │
│  │  │ - Email         │  │ - Initiate      │  │ - Enrollment            │ │ │
│  │  │ - Phone         │  │ - Route         │  │ - Authentication        │ │ │
│  │  │ - Username      │  │ - Complete      │  │ - Permissions           │ │ │
│  │  │ - Random Key    │  │ - Webhooks      │  │ - Rate Limits           │ │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │ │
│  │                              │                                          │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│  │  │                    Multi-Bank Router                             │   │ │
│  │  │                                                                  │   │ │
│  │  │  BSIM-1 ◄──────► TransferSim ◄──────► BSIM-2                    │   │ │
│  │  │  (Bank A)                              (Bank B)                  │   │ │
│  │  └─────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                      ▲                                       │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 │                     │                     │
                 ▼                     ▼                     ▼
         ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
         │   mwsim     │       │  Other App  │       │   Web App   │
         │  (Mobile)   │       │  (Mobile)   │       │  (Browser)  │
         └─────────────┘       └─────────────┘       └─────────────┘
                           Orchestrators
```

## Features

### Alias-Based Transfers

Send money using familiar identifiers instead of account numbers:

| Alias Type | Format | Example |
|------------|--------|---------|
| Email | RFC 5322 | user@example.com |
| Phone | E.164 | +14165551234 |
| Username | @handle | @johndoe |
| Random Key | 8-char | A1B2C3D4 |

### Cross-Bank Transfers

Transfer money between users at different BSIM instances seamlessly:

1. Sender initiates transfer to alias
2. TransferSim resolves alias to recipient's bank
3. Debits sender's account at their bank
4. Credits recipient's account at their bank
5. Notifies both parties of completion

### QR Code / NFC Support

Device-to-device transfers via:
- Receiver generates QR code with receive token
- Sender scans QR and confirms transfer
- No need to type aliases or account numbers

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Cache/Queue:** Redis
- **Testing:** Jest

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional, for containerized setup)

## Quick Start

```bash
# Clone the repository
git clone git@github.com:jordancrombie/transferSim.git
cd transferSim

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

## API Endpoints

### Aliases
```
POST   /api/v1/aliases                    # Register new alias
GET    /api/v1/aliases                    # List user's aliases
GET    /api/v1/aliases/lookup             # Look up alias
DELETE /api/v1/aliases/:aliasId           # Remove alias
POST   /api/v1/aliases/:aliasId/verify    # Verify alias
PUT    /api/v1/aliases/:aliasId/primary   # Set primary alias
```

### Transfers
```
POST   /api/v1/transfers                  # Initiate P2P transfer
GET    /api/v1/transfers                  # List transfers
GET    /api/v1/transfers/:transferId      # Get transfer status
POST   /api/v1/transfers/:transferId/cancel # Cancel transfer
```

#### POST /api/v1/transfers - Multi-Bank Support

For users enrolled with multiple banks, you can explicitly specify which bank to debit from using the `senderBsimId` field:

```json
{
  "recipientAlias": "@johndoe",
  "amount": 50.00,
  "fromAccountId": "acct_123456",
  "senderBsimId": "bsim-dev",  // Optional: specify which bank to debit from
  "description": "Payment"
}
```

**Request Fields:**
- `recipientAlias` (string, required): Alias to send money to
- `recipientAliasType` (enum, optional): EMAIL | PHONE | USERNAME | RANDOM_KEY
- `amount` (number, required): Transfer amount (positive)
- `currency` (string, optional): Currency code (default: CAD)
- `fromAccountId` (string, required): Sender's account ID to debit
- `senderBsimId` (string, optional): BSIM ID for multi-bank routing
- `description` (string, optional): Transfer description (max 200 chars)

**Multi-Bank Routing:**
- If `senderBsimId` is provided, it will be used to route the debit to that specific bank
- If omitted, falls back to the BSIM ID from the Bearer token (backward compatible)
- Required for users who have accounts at multiple banks

### Tokens (QR/NFC)
```
POST   /api/v1/tokens/receive             # Generate receive token
POST   /api/v1/tokens/send                # Generate send token
GET    /api/v1/tokens/:tokenId            # Resolve token
```

### Orchestrator Enrollment
```
POST   /api/v1/enrollments                # Enroll user
GET    /api/v1/enrollments                # List enrollments
DELETE /api/v1/enrollments/:enrollmentId  # Remove enrollment
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_HOST` | Redis host | localhost |
| `REDIS_PORT` | Redis port | 6379 |
| `PORT` | API server port | 3010 |
| `NODE_ENV` | Environment | development |
| `DEFAULT_TRANSFER_LIMIT` | Max per-transfer amount | 10000 |
| `DEFAULT_DAILY_LIMIT` | Max daily transfer total | 50000 |

## Related Projects

- [BSIM](https://github.com/jordancrombie/bsim) - Bank Simulator
- [WSIM](https://github.com/jordancrombie/wsim) - Digital Wallet Simulator
- [NSIM](https://github.com/jordancrombie/nsim) - Payment Network Simulator
- [mwsim](https://github.com/jordancrombie/mwsim) - Mobile Wallet App

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## Docker

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f transfersim

# Stop services
docker-compose down
```

## License

MIT
