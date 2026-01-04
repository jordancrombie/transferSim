# Changelog

All notable changes to TransferSim will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
