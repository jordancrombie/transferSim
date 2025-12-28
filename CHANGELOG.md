# Changelog

All notable changes to TransferSim will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned

- JWT validation for production authentication
- Redis-based job queue for async processing
- Webhook notifications for transfer events
- Enhanced rate limiting
- Transfer history pagination
- Hybrid enrollment flow with BSIM consent screens
