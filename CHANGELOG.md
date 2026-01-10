# Changelog

All notable changes to TransferSim will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Phase 2: Merchant Logos

### Added

- **MicroMerchant Schema** (T-10)
  - Added `logoImageUrl` - CDN URL for merchant logo
  - Added `logoImageKey` - S3 key for deletion/replacement
  - Added `initialsColor` - Background color for initials fallback
  - Migration: `20260110120000_add_logo_fields_to_micro_merchant`

### Pending

- T-11: S3 bucket creation (`banksim-profiles-tsim-dev`)
- T-12: CloudFront behavior for `/merchants/*`
- T-13: Image upload service (Sharp-based)
- T-14: Logo upload/delete endpoints

## [0.8.1] - 2026-01-10

### Added

- **Sender Details in Merchant Transactions API**
  - `GET /api/v1/micro-merchants/me/transactions` now returns sender bank info:
    - `senderBsimId` - Sender's bank identifier
    - `senderBankName` - Sender's bank display name (e.g., "TD Bank", "RBC")
    - `senderAccountLast4` - Last 4 digits of sender's account (for transaction reconciliation)
    - `senderProfileImageUrl` - Sender's profile image (from v0.8.0)
  - Dashboard `recentTransactions` also includes these fields
  - Enables merchants to distinguish transactions for reconciliation

## [0.8.0] - 2026-01-09

### Added

- **Profile Image URLs in Transfer History API**
  - Transfer records now store `senderProfileImageUrl` and `recipientProfileImageUrl`
  - Profile images captured at transfer completion (both sender and recipient)
  - `GET /api/v1/transfers` response includes profile image URLs for history display
  - Enables mwsim to display avatars in transaction history instead of initials only
  - Uses stored URLs (Option A approach) for fast queries without runtime lookups

- **Database Migration**
  - New fields added to Transfer model: `senderProfileImageUrl`, `recipientProfileImageUrl`
  - Migration: `20260109200000_add_profile_image_urls_to_transfer`

## [0.7.0] - 2026-01-09

### Added

- **Sender Profile Image in Webhooks**
  - `transfer.completed` webhook now includes `senderProfileImageUrl` field
  - TransferSim fetches profile image URL from WSIM via internal API
  - Enables mwsim to display sender avatars in push notifications
  - New `WsimClient` service for WSIM internal API calls

- **Configuration**
  - `WSIM_INTERNAL_API_URL` - WSIM internal API endpoint for profile lookups
  - `WSIM_INTERNAL_API_KEY` - Shared secret for internal API authentication

## [0.6.2] - 2026-01-07

### Added

- **Token Resolution: Recipient Details**
  - `GET /api/v1/tokens/:tokenId` now returns `recipientDisplayName` (from BSIM)
  - `GET /api/v1/tokens/:tokenId` now returns `recipientBankName` (from BSIM connection)
  - Enables mwsim to show recipient info on payment confirmation screen

- **Merchant Dashboard: Client Timezone Support**
  - `GET /api/v1/micro-merchants/me/dashboard` now accepts `tzOffset` query parameter
  - Pass JavaScript's `getTimezoneOffset()` value (minutes) for accurate "today" stats
  - Fixes issue where "today" stats used UTC instead of merchant's local timezone

## [0.6.1] - 2026-01-07

### Added

- **Debug Logging for Troubleshooting**
  - Webhook service now logs full payload JSON before sending to WSIM
  - Transfer route logs incoming request body and user context
  - Transfer notification helper logs params, merchant lookup, and recipientType mapping
  - Token routes log creation requests, responses, and resolution details
  - All logs prefixed with `[Webhook]`, `[Transfer]`, or `[Token]` for easy filtering

## [0.6.0] - 2026-01-07

### Added

- **Webhook Specification Documentation**
  - New `docs/webhook-spec.md` with complete `transfer.completed` webhook documentation
  - Field reference with types, nullable status, and example values
  - HMAC-SHA256 signature verification code examples
  - Retry policy documentation
  - Integration notes for WSIM and mwsim teams
  - Example payloads for individual and merchant payments

## [0.5.2] - 2026-01-07

### Added

- **Webhook: Merchant Payment Context**
  - `transfer.completed` webhook now includes `recipientType` field (`"individual"` or `"merchant"`)
  - `merchantName` field included when recipient is a Micro Merchant
  - Enables mwsim to auto-refresh merchant dashboard on payment received
  - Supports real-time dashboard updates via foreground push notification handling

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
