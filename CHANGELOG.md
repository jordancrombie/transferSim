# Changelog

All notable changes to TransferSim will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-01-07

### Added

- **Merchant Dashboard: Today's Stats**
  - `GET /api/v1/micro-merchants/me/dashboard` now includes `today` object
  - `today.totalReceived` - Revenue received today (UTC)
  - `today.totalTransactions` - Transaction count today
  - `today.totalFees` - Fees collected today
  - Uses UTC start of day for consistent timezone handling

## [0.5.0] - 2026-01-06

### Added

- **Micro Merchant Transfer Integration**
  - Transfers automatically detect if recipient is a registered Micro Merchant
  - Merchant payments tagged with `recipientType: MICRO_MERCHANT`
  - Fee calculation applied to merchant payments (< $200: $0.25, >= $200: $0.50)
  - Merchant stats updated after transfer completion (totalReceived, totalTransactions, totalFees)

### Changed

- **Token Resolution: Merchant-Friendly Response Format**
  - `recipientType` now returns `"merchant"` or `"individual"` (instead of `MICRO_MERCHANT`/`INDIVIDUAL`)
  - Added `merchantName` and `merchantCategory` at top level for mwsim UI
  - Kept nested `merchant` object for backward compatibility

## [0.4.3] - 2026-01-06

### Added

- **Token Resolution: recipientAliasType**
  - `GET /api/v1/tokens/:tokenId` now returns `recipientAliasType` field
  - Values: `EMAIL`, `PHONE`, `USERNAME`, or `RANDOM_KEY`
  - mwsim can pass this directly to `POST /api/v1/transfers`

## [0.4.2] - 2026-01-06

### Fixed

- **Token Resolution Missing recipientAlias**
  - `GET /api/v1/tokens/:tokenId` now returns `recipientAlias` field
  - Enables mwsim to complete QR code transfers by calling `POST /api/v1/transfers`
  - Falls back to primary alias, then any active alias if token has no specific aliasId
  - Also added `recipientBsimId` for cross-bank transfer routing

## [0.4.1] - 2026-01-06

### Fixed

- **Apple App Site Association (AASA) Format**
  - Changed `appID` to `appIDs` (array format per Apple spec)
  - Fixed bundle ID from `com.banksim.mwsim` to `com.banksim.wsim`
  - Updated `assetlinks.json` with correct Android package name

## [0.4.0] - 2026-01-06

### Added

- **QR Code Universal Links Support**
  - QR codes now contain Universal Link URLs (`https://transfer.banksim.ca/pay/{tokenId}`)
  - Enables scanning with any camera app (iPhone Camera, Google Lens)
  - Apple App Site Association (AASA) file served at `/.well-known/apple-app-site-association`
  - Android App Links (`assetlinks.json`) served at `/.well-known/assetlinks.json`
  - Legacy JSON format preserved in `qrPayloadLegacy` for backward compatibility

- **Configuration**
  - `UNIVERSAL_LINK_BASE_URL` - Base URL for Universal Links (defaults to production/dev based on NODE_ENV)

### Changed

- `/api/v1/tokens/receive` response now includes:
  - `qrPayload`: Universal Link URL (e.g., `https://transfer.banksim.ca/pay/tok_xxx`)
  - `qrPayloadLegacy`: JSON format for backward compatibility during transition

## [0.3.1] - 2026-01-06

### Fixed

- **ESLint Configuration**
  - Added missing `typescript-eslint` package for flat config format
  - Fixed lint errors in `auth.ts`, `aliases.ts`, and test files
  - CI pipeline lint step now passes

- **Test Suite**
  - Added missing `supertest` dependency for API integration tests
  - Fixed `transfers.test.ts` to use `createApp()` instead of non-existent `app` export
  - Fixed Orchestrator creation to use flat permission fields (not nested object)
  - Added required `apiKeyHash` field to test orchestrator creation

### Changed

- Buildkite CI/CD pipelines added (managed outside repo)

## [0.3.0] - 2026-01-04

### Added

- **Push Notification Webhooks**
  - Webhook service for sending transfer completion events to WSIM
  - HMAC-SHA256 signature authentication (`X-Webhook-Signature` header)
  - Exponential backoff retry (1s, 2s, 4s, 8s, 16s, max 5 retries)
  - Fire-and-forget pattern (doesn't block transfer completion)
  - Enhanced payload format per AD5 with `recipientBsimId` for user lookup

- **Transfer Completion Notifications**
  - Same-bank transfers trigger webhook on completion
  - Cross-bank transfers trigger webhook on completion
  - Payload includes sender display name, aliases, and bank names
  - Idempotency key for deduplication

- **Configuration**
  - `WSIM_WEBHOOK_URL` - WSIM notification endpoint
  - `WSIM_WEBHOOK_SECRET` - Shared secret for HMAC signing

- **Test Coverage**
  - 12 unit tests for webhook service (95% statement coverage)
  - Tests for payload building, HMAC signing, retry logic, edge cases

### Changed

- Jest config updated to handle ESM-style `.js` imports in TypeScript

## [0.1.0] - 2024-12-28

### Added

- **Core P2P Transfer Engine**
  - Transfer initiation, routing, and completion between BSIM instances
  - Support for same-bank and cross-bank transfers
  - Transfer status tracking (PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED)
  - Idempotency support for safe transfer retries

- **Alias Registry**
  - Email, phone, username, and random key alias types
  - Alias verification workflow
  - Primary alias designation
  - Alias lookup for recipient resolution

- **Multi-Bank Router**
  - BSIM connection management
  - Cross-bank transfer coordination
  - Debit/credit orchestration with BSIM instances

- **Orchestrator Management**
  - Orchestrator registration and API key management
  - Permission-based access control (enroll, transfer, view)
  - Rate limiting per orchestrator

- **QR/NFC Token Support**
  - Receive token generation for QR codes
  - Send token generation
  - Token resolution for device-to-device transfers

- **API Endpoints**
  - `/api/v1/aliases` - Alias management
  - `/api/v1/transfers` - P2P transfer operations
  - `/api/v1/tokens` - QR/NFC token operations
  - `/api/v1/enrollments` - User enrollment management
  - `/api/v1/admin/*` - Administrative operations

- **Security**
  - API key authentication for orchestrators
  - User context extraction (development mode)
  - Admin API key protection for sensitive endpoints

- **Infrastructure**
  - PostgreSQL database with Prisma ORM
  - Docker Compose for local development
  - Health check endpoint
  - Production deployment on AWS ECS

### Production Deployment

- Deployed to AWS ECS with shared RDS database
- mwsim mobile wallet orchestrator registered
- Health checks passing

## [0.2.1] - 2025-01-04

### Fixed

- **Alias Lookup Missing displayName**
  - GET `/api/v1/aliases/lookup` now returns `displayName` field
  - Fetches display name from BSIM via verifyUser API

- **Received Transfers Missing Sender Info**
  - GET `/api/v1/transfers` now includes sender info for received transfers:
    - `senderAlias` - Sender's primary alias
    - `senderDisplayName` - Sender's display name from BSIM
    - `senderBankName` - Sender's bank name

- **Transfer Direction Filter Ignored**
  - GET `/api/v1/transfers` now accepts both `type` and `direction` query parameters
  - `direction=sent` and `direction=received` now work correctly (mwsim compatibility)

## [0.2.0] - 2025-01-03

### Added

- **Multi-Bank Routing Support**
  - New `senderBsimId` field in transfer requests for explicit bank selection
  - Enables users enrolled with multiple banks to specify which bank to debit
  - Falls back to Bearer token `bsimId` when not provided (backward compatible)
  - Warning logged when `senderBsimId` differs from auth context

- **Account ID Field Name Flexibility**
  - Accept `senderAccountId` (canonical), `fromAccountId` (legacy), or `sourceAccountId` (mwsim)
  - Priority order when multiple provided: `senderAccountId` > `fromAccountId` > `sourceAccountId`
  - Maintains backward compatibility with existing integrations

- **Micro-Merchant Support for QR/NFC Tokens**
  - `MicroMerchant` model for small business payment tracking
  - Merchant categories (RETAIL, FOOD_AND_BEVERAGE, SERVICES, etc.)
  - Fee configuration per merchant (percentage and/or flat fee)
  - Token generation with merchant context for visual differentiation
  - Denormalized stats for dashboard performance

- **Test Suite**
  - Comprehensive tests for multi-bank routing
  - Tests for account ID field name compatibility
  - Tests for transfer list filtering by BSIM

### Changed

- Transfer request validation now uses Zod `.refine()` for account ID flexibility
- Bearer token format documented: `<bsim_fiUserRef>:<bsimId>` (uses BSIM userId, not WSIM)

## [Unreleased]

### Planned

- JWT validation for production authentication
- Redis-based job queue for async processing
- Enhanced rate limiting
- Transfer history pagination
- Hybrid enrollment flow with BSIM consent screens
