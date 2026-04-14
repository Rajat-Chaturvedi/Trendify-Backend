# Implementation Plan: Trendify Backend CMS

## Overview

Incremental implementation of the Node.js + Express + TypeScript API server, PostgreSQL + Prisma data layer, Strapi v5 CMS, Redis caching/rate-limiting, JWT RS256 auth, Expo push notifications, multilingual support, and full CI/CD infrastructure. Each task builds on the previous and ends with all components wired together.

## Tasks

- [x] 1. Project scaffold and environment configuration
  - Initialise monorepo under `trendify-backend/` with `apps/api` and `apps/cms` workspaces
  - Create `apps/api/tsconfig.json` with `strict: true` and path aliases
  - Add `apps/api/src/config/env.ts` — Zod-validated env schema that halts startup with a descriptive error listing missing variables
  - Create `.env.example` documenting all required and optional variables with descriptions
  - _Requirements: 16.1, 16.2, 16.3_

- [x] 2. Database schema and migrations
  - [x] 2.1 Write Prisma schema with all models: User, RefreshToken, TrendItem, Bookmark, UserPreferences, PushToken, and Category enum
    - Enforce referential integrity (Cascade deletes) between Bookmarks↔Users and Bookmarks↔TrendItems
    - Add indexes on `category`, `regionCode`, `locale`, `publishedAt DESC`, `userId+createdAt DESC`
    - _Requirements: 15.1, 15.5_
  - [x] 2.2 Generate and commit initial migration; wire `prisma migrate deploy` into server startup before port binding
    - Log migration name and timestamp on apply; halt and log full error on failure
    - _Requirements: 15.2, 15.3, 15.4_

- [x] 3. Express app factory and middleware pipeline
  - [x] 3.1 Create `apps/api/src/app.ts` — Express app factory registering middleware in order: helmet, cors (ALLOWED_ORIGINS), correlationId, requestLogger, rateLimiter placeholder, errorHandler
    - Set HSTS, X-Content-Type-Options, X-Frame-Options via helmet
    - _Requirements: 12.1, 12.2, 13.1, 13.4_
  - [x] 3.2 Implement `correlation.middleware.ts` — attach/propagate `X-Correlation-ID`; generate UUID if absent; include in all log entries and outbound responses
    - _Requirements: 13.4_
  - [x] 3.3 Write property test for correlation ID propagation
    - **Property 30: Correlation ID propagation**
    - **Validates: Requirements 13.4**
  - [x] 3.4 Implement structured JSON logger (`utils/logger.ts`) using pino/Winston; log method, path, status, response time ms, correlation ID on every request and every unhandled error
    - _Requirements: 13.1, 13.2_
  - [x] 3.5 Implement Prometheus metrics (`utils/metrics.ts`) — request count, request duration histogram, active connection gauge; expose `/metrics` endpoint
    - _Requirements: 13.3_
  - [x] 3.6 Create `apps/api/src/server.ts` — HTTP server entry point; apply pending migrations, then bind port
    - _Requirements: 15.2_

- [x] 4. Checkpoint — Ensure app boots, middleware pipeline is wired, and `/metrics` responds
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Authentication service and routes
  - [x] 5.1 Implement `auth.service.ts` — register, login, refresh, logout, verifyAccessToken, revokeAllTokens
    - Hash passwords with bcrypt cost factor ≥ 12
    - Issue AccessTokens (RS256, exp = iat + 15 min) and RefreshTokens (exp = createdAt + 30 days)
    - Rotate RefreshToken on refresh; revoke old token; revokeAllTokens on password change
    - _Requirements: 2.1–2.8, 3.1–3.4_
  - [x] 5.2 Write property test for registration creates hashed password
    - **Property 6: Registration creates a user with hashed password**
    - **Validates: Requirements 2.1, 2.6**
  - [x] 5.3 Write property test for short password rejection
    - **Property 7: Short password rejection**
    - **Validates: Requirements 2.3**
  - [x] 5.4 Write property test for token expiry invariants
    - **Property 9: Token expiry invariants**
    - **Validates: Requirements 2.7, 2.8**
  - [x] 5.5 Write property test for refresh token rotation
    - **Property 10: Refresh token rotation**
    - **Validates: Requirements 3.1, 3.2**
  - [x] 5.6 Implement `auth.router.ts` — POST /register, /login, /refresh, /logout with Zod-validated request bodies
    - Return 409 "Email already registered", 400 on short password, 401 "Invalid credentials", 401 "Invalid or expired refresh token"
    - _Requirements: 2.1–2.5, 3.1–3.3_
  - [x] 5.7 Write integration tests for auth router
    - Test register, login, refresh, logout, duplicate email, short password, invalid credentials
    - _Requirements: 2.1–2.8, 3.1–3.4_

- [x] 6. Auth middleware and protected routes
  - [x] 6.1 Implement `auth.middleware.ts` — verify RS256 Bearer token; attach `req.user`; return 401 "Authentication required" if missing, 401 "Invalid or expired token" if invalid/expired
    - _Requirements: 4.1, 4.2, 4.3, 12.4_
  - [x] 6.2 Write property test for protected route authentication enforcement
    - **Property 13: Protected route authentication enforcement**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 7. Input validation middleware and error handler
  - [x] 7.1 Implement `validate.middleware.ts` — run Zod schema against req.body/req.query; return 400 with `{ message, errors[] }` on failure
    - _Requirements: 10.1, 10.2_
  - [x] 7.2 Implement global `errorHandler` middleware — map ZodError, PrismaClientKnownRequestError, custom AppError subclasses to HTTP responses; log 5xx with correlation ID and stack trace server-side; never expose stack traces to client
    - _Requirements: 10.3, 10.4_
  - [x] 7.3 Write property test for validation error response shape
    - **Property 26: Validation error response shape**
    - **Validates: Requirements 10.2**
  - [x] 7.4 Write property test for unhandled exception response safety
    - **Property 27: Unhandled exception response safety**
    - **Validates: Requirements 10.3**

- [x] 8. Rate limiter middleware
  - [x] 8.1 Implement `rateLimiter.middleware.ts` — Redis-backed sliding window; 100 req/min per IP on unauthenticated endpoints, 300 req/min per user on protected endpoints; return 429 with `Retry-After` header on breach; include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on all responses
    - _Requirements: 11.1–11.4_
  - [x] 8.2 Write property test for rate limit enforcement
    - **Property 28: Rate limit enforcement**
    - **Validates: Requirements 11.1, 11.2, 11.3**
  - [x] 8.3 Write property test for rate limit headers invariant
    - **Property 29: Rate limit headers invariant**
    - **Validates: Requirements 11.4**

- [x] 9. Checkpoint — Ensure auth, validation, rate limiting, and error handling tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. I18n service and middleware
  - [x] 10.1 Implement `i18n.service.ts` — resolveLocale (locale param → Accept-Language → user prefs → "en"), isValidBcp47, formatError with locale-aware messages falling back to "en"
    - _Requirements: 19.3, 19.4, 19.5, 19.12_
  - [x] 10.2 Implement `i18n.middleware.ts` — call resolveLocale and attach `req.locale` for downstream handlers
    - _Requirements: 19.3, 19.4, 19.5_
  - [x] 10.3 Write property test for locale resolution priority
    - **Property 31: Locale resolution priority**
    - **Validates: Requirements 19.3, 19.4, 19.5**
  - [x] 10.4 Write property test for BCP 47 locale validation
    - **Property 34: BCP 47 locale validation**
    - **Validates: Requirements 19.10, 19.11**

- [x] 11. Trend service and trends router
  - [x] 11.1 Implement `trend.service.ts` — listTrends with cursor-based keyset pagination, category filter, regionCode filter with null-region fallback, locale filter; getTrendById with locale fallback to "en"; upsertFromWebhook
    - Encode cursors as base64 JSON `{ publishedAt, id }`; decode and apply `WHERE (published_at, id) < (cursor.publishedAt, cursor.id)`
    - Return `Content-Language` header matching resolved locale; fall back to "en" variant and set `Content-Language: en` when locale variant absent
    - Apply authenticated user's stored UserPreferences as default filters when no explicit params provided
    - _Requirements: 1.1–1.9, 5.5, 19.1–19.6, 19.13_
  - [x] 11.2 Write property test for category filter correctness
    - **Property 1: Category filter correctness**
    - **Validates: Requirements 1.2**
  - [x] 11.3 Write property test for region filter with fallback correctness
    - **Property 2: Region filter with fallback correctness**
    - **Validates: Requirements 1.3**
  - [x] 11.4 Write property test for cursor pagination completeness and non-overlap
    - **Property 3: Cursor pagination — completeness and non-overlap**
    - **Validates: Requirements 1.4, 18.5**
  - [x] 11.5 Write property test for pageSize enforcement
    - **Property 4: pageSize enforcement**
    - **Validates: Requirements 1.5, 1.6**
  - [x] 11.6 Write property test for TrendItem lookup round-trip
    - **Property 5: TrendItem lookup round-trip**
    - **Validates: Requirements 1.7**
  - [x] 11.7 Write property test for locale fallback to English
    - **Property 32: Locale fallback to English**
    - **Validates: Requirements 19.6**
  - [x] 11.8 Write property test for Content-Language header invariant
    - **Property 33: Content-Language header invariant**
    - **Validates: Requirements 19.13**
  - [x] 11.9 Implement `trends.router.ts` — GET /api/v1/trends, GET /api/v1/trends/:id; wire Zod query/param validation; attach `Content-Language` header on all responses
    - Return 400 on invalid pageSize, 404 on missing item
    - _Requirements: 1.1–1.9, 19.13_
  - [x] 11.10 Write integration tests for trends router
    - Test all filter combinations, pagination, locale resolution, 404, Content-Language header
    - _Requirements: 1.1–1.9, 19.3–19.6, 19.13_

- [x] 12. Redis caching layer
  - [x] 12.1 Add cache-aside logic to `trend.service.ts` — check `trends:list:{hash(params)}` (TTL 60 s) and `trends:item:{id}:{locale}` (TTL 300 s) before querying Postgres; write to Redis on miss; invalidate on webhook upsert for matching category/strapiId
    - _Requirements: 1.9_

- [x] 13. User profile and preferences routes
  - [x] 13.1 Implement `users.router.ts` — GET/PATCH /api/v1/users/me, GET/PUT /api/v1/users/me/preferences, POST /api/v1/users/me/push-token
    - Validate BCP 47 locale on preferences update; return 400 with descriptive error if invalid
    - Invalidate `user:prefs:{userId}` Redis cache on PUT preferences
    - _Requirements: 5.1–5.5, 7.1, 19.9–19.11_
  - [x] 13.2 Write property test for user profile round-trip
    - **Property 14: User profile round-trip**
    - **Validates: Requirements 5.1, 5.2**
  - [x] 13.3 Write property test for preferences round-trip
    - **Property 15: Preferences round-trip**
    - **Validates: Requirements 5.3**
  - [x] 13.4 Write property test for invalid category in preferences rejected
    - **Property 16: Invalid category in preferences rejected**
    - **Validates: Requirements 5.4**
  - [x] 13.5 Write property test for stored preferences applied as default filters
    - **Property 17: Stored preferences applied as default filters**
    - **Validates: Requirements 5.5**
  - [x] 13.6 Write integration tests for users router
    - Test profile CRUD, preferences CRUD, push token registration, BCP 47 validation
    - _Requirements: 5.1–5.5, 7.1, 19.9–19.11_

- [x] 14. Bookmarks service and router
  - [x] 14.1 Implement `bookmark.service.ts` — addBookmark, removeBookmark, listBookmarks (cursor-paginated, ordered by createdAt DESC)
    - Return 409 "Already bookmarked" on duplicate; 404 on missing bookmark for DELETE
    - _Requirements: 6.1–6.5_
  - [x] 14.2 Write property test for bookmark round-trip
    - **Property 18: Bookmark round-trip**
    - **Validates: Requirements 6.1, 6.3**
  - [x] 14.3 Write property test for bookmarks ordered by creation date descending
    - **Property 19: Bookmarks ordered by creation date descending**
    - **Validates: Requirements 6.5**
  - [x] 14.4 Implement `bookmarks.router.ts` — GET /api/v1/bookmarks, POST /api/v1/bookmarks/:trendItemId, DELETE /api/v1/bookmarks/:trendItemId
    - _Requirements: 6.1–6.5_
  - [x] 14.5 Write integration tests for bookmarks router
    - Test add, remove, list, duplicate, missing item
    - _Requirements: 6.1–6.5_

- [x] 15. Checkpoint — Ensure trends, users, and bookmarks tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Push notification service
  - [x] 16.1 Implement `push.service.ts` — registerToken, notifyNewTrendItem
    - Query users whose UserPreferences include the item's category and who have a stored push token
    - Batch tokens in groups of ≤ 100 per Expo API request
    - Retry retriable errors with exponential backoff up to 3 total attempts; log failure after exhaustion
    - Remove push token from DB on non-retriable Expo error
    - _Requirements: 7.1–7.5_
  - [x] 16.2 Write property test for push notification fan-out correctness
    - **Property 21: Push notification fan-out correctness**
    - **Validates: Requirements 7.2**
  - [x] 16.3 Write property test for push batch size invariant
    - **Property 22: Push batch size invariant**
    - **Validates: Requirements 7.4**
  - [x] 16.4 Write property test for push retry limit
    - **Property 23: Push retry limit**
    - **Validates: Requirements 7.5**
  - [x] 16.5 Write unit tests for push token storage round-trip
    - **Property 20: Push token storage round-trip**
    - **Validates: Requirements 7.1**

- [x] 17. Strapi CMS setup and TrendItem content type
  - [x] 17.1 Scaffold `apps/cms` as a Strapi v5 project; install and configure the i18n plugin in `config/plugins.ts`
    - _Requirements: 8.1, 19.7_
  - [x] 17.2 Create `apps/cms/src/api/trend-item/content-types/trend-item/schema.json` with all TrendItem fields, `draftAndPublish: true`, i18n enabled on `title` and `description`, category enum enforced, required fields enforced
    - _Requirements: 8.1, 8.4, 8.5, 8.6, 19.7_
  - [x] 17.3 Configure Strapi webhook emitter to POST to `WEBHOOK_URL` with HMAC-SHA256 `X-Strapi-Signature` header on entry publish/unpublish events
    - _Requirements: 9.1_

- [x] 18. Webhook handler
  - [x] 18.1 Implement `webhooks.router.ts` — POST /webhooks/strapi; verify HMAC-SHA256 signature against shared secret; reject with 401 on mismatch; call `trend.service.upsertFromWebhook`; return 500 (with full payload logged) on processing failure so Strapi retries
    - _Requirements: 9.1–9.4_
  - [x] 18.2 Write property test for webhook HMAC validation
    - **Property 24: Webhook HMAC validation**
    - **Validates: Requirements 9.4**
  - [x] 18.3 Write property test for webhook upsert correctness
    - **Property 25: Webhook upsert correctness**
    - **Validates: Requirements 9.2**
  - [x] 18.4 Write integration tests for webhooks router
    - Test valid payload upsert, HMAC rejection, processing failure and retry signal
    - _Requirements: 9.1–9.4_

- [x] 19. Health check endpoints
  - [x] 19.1 Implement `health.service.ts` — liveness (always 200 `{ status: "ok" }`), readiness (ping DB; return 503 `{ status: "unavailable", reason: "database" }` if unreachable)
    - _Requirements: 14.1–14.3_
  - [x] 19.2 Register `/health/live` and `/health/ready` routes in app factory
    - _Requirements: 14.1–14.3_
  - [x] 19.3 Write integration tests for health router
    - Test liveness, readiness, DB-down scenario
    - _Requirements: 14.1–14.3_

- [x] 20. Multilingual TrendItem JSON round-trip property test
  - [x] 20.1 Write property test for multilingual TrendItem JSON round-trip
    - **Property 35: Multilingual TrendItem JSON round-trip**
    - **Validates: Requirements 18.4, 19.14**

- [x] 21. Security hardening
  - [x] 21.1 Add HTTPS redirect middleware for production; enforce `NODE_ENV=production` guard
    - _Requirements: 12.3_
  - [x] 21.2 Add input sanitisation utility and apply to all user-supplied string fields before persistence (prevent SQL injection and XSS payloads)
    - _Requirements: 12.6_
  - [x] 21.3 Confirm no plaintext passwords or AccessTokens are stored in the DB (enforced by schema — passwordHash only, no accessToken column)
    - _Requirements: 12.5_

- [x] 22. Checkpoint — Ensure all service, router, and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Docker and docker-compose
  - [x] 23.1 Write multi-stage `apps/api/Dockerfile` — build stage compiles TypeScript; production stage copies compiled output, runs as non-root user
    - _Requirements: 17.1, 17.2_
  - [x] 23.2 Write `apps/cms/Dockerfile` for Strapi v5
    - _Requirements: 17.1_
  - [x] 23.3 Write `docker-compose.yml` starting API server, PostgreSQL, Redis, and CMS together for local development
    - _Requirements: 17.3_
  - [x] 23.4 Write `docker-compose.test.yml` with isolated PostgreSQL instance for integration tests
    - _Requirements: 18.2_

- [x] 24. GitHub Actions CI/CD pipeline
  - [x] 24.1 Write `.github/workflows/ci.yml` — jobs: lint (`eslint --max-warnings 0`), type-check (`tsc --noEmit`), unit tests, integration tests, property tests; all must complete within 120 seconds
    - _Requirements: 17.4, 18.3_
  - [x] 24.2 Add build-and-push job that runs on `main` branch after tests pass — multi-stage Docker build and push to configured container registry
    - _Requirements: 17.5_

- [x] 25. Final checkpoint — Ensure all tests pass and CI pipeline is green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with `{ numRuns: 100 }` and are tagged `// Feature: trendify-backend-cms, Property {N}: {property_text}`
- Checkpoints ensure incremental validation at logical boundaries
- The design document contains the full Prisma schema, Strapi content type JSON, and all 35 correctness properties
