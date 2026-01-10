# TransferSim API Documentation

This directory contains machine-readable API specifications for TransferSim.

## Files

| File | Format | Purpose |
|------|--------|---------|
| `openapi.yaml` | OpenAPI 3.1 | REST API endpoints (synchronous HTTP) |
| `asyncapi.yaml` | AsyncAPI 3.0 | Webhook events (asynchronous, push-based) |
| `webhook-spec.md` | Markdown | Human-readable webhook integration guide |

## OpenAPI vs AsyncAPI

### OpenAPI (`openapi.yaml`)

Use this for **request/response APIs** - endpoints where mwsim (or other clients) makes HTTP requests and waits for a response.

**Examples:**
- `POST /api/v1/transfers` - Initiate a transfer
- `GET /api/v1/tokens/:tokenId` - Resolve a QR code token
- `GET /api/v1/micro-merchants/me/dashboard` - Get merchant stats

**When to reference:**
- Building a client that calls TransferSim APIs
- Understanding request/response schemas
- Generating client SDKs

### AsyncAPI (`asyncapi.yaml`)

Use this for **event-driven APIs** - webhooks that TransferSim pushes to external systems (like WSIM) when something happens.

**Examples:**
- `transfer.completed` - Sent when a P2P transfer completes

**When to reference:**
- Implementing a webhook receiver
- Understanding event payload structure
- Setting up push notification handling

## Quick Start

### Viewing the Specs

You can view these specs with:

- **Swagger UI** (OpenAPI): https://editor.swagger.io - paste `openapi.yaml` contents
- **AsyncAPI Studio** (AsyncAPI): https://studio.asyncapi.com - paste `asyncapi.yaml` contents
- **VS Code**: Install "OpenAPI (Swagger) Editor" or "AsyncAPI Preview" extensions

### Generating Client Code

```bash
# Generate TypeScript client from OpenAPI
npx @openapitools/openapi-generator-cli generate \
  -i docs/openapi.yaml \
  -g typescript-fetch \
  -o generated/client

# Generate types from AsyncAPI
npx @asyncapi/generator docs/asyncapi.yaml @asyncapi/typescript-template
```

## Keeping Specs Updated

**Important:** Update these specs whenever you change the API!

| Change Type | Update |
|-------------|--------|
| Add/remove REST endpoint | `openapi.yaml` |
| Change request/response schema | `openapi.yaml` |
| Modify webhook payload | `asyncapi.yaml` |
| Add new webhook event | `asyncapi.yaml` |

After updates:
1. Bump `info.version` in the spec file
2. Add entry to `CHANGELOG.md`
3. Commit both together

## Related Resources

- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [CHANGELOG.md](../CHANGELOG.md) - Version history
