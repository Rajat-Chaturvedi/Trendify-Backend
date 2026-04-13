# Requirements Document

## Introduction

This document defines the requirements for the Trendify backend API, CMS integration, and production-readiness work. The backend replaces the existing JSONPlaceholder mock with a real Node.js + Express API backed by a PostgreSQL database and a Strapi CMS for content management. The system also adds real authentication, push notification delivery, user profile management, and all infrastructure needed to run the complete app in production.

The backend must honour the existing API contract consumed by the React Native frontend without requiring frontend changes, while adding new endpoints for auth, profiles, bookmarks, and notifications.

## Glossary

- **API_Server**: The Node.js + Express HTTP server that serves all client requests
- **Auth_Service**: The module responsible for issuing, validating, and revoking JWT tokens
- **CMS**: The Strapi instance used by editors to create and manage TrendItem content
- **Database**: The PostgreSQL instance that persists all application data
- **Push_Service**: The module responsible for delivering push notifications via Expo Push Notification service
- **User**: A registered end-user of the Trendify mobile application
- **Editor**: A content team member who manages TrendItems through the CMS
- **TrendItem**: A piece of trending content with id, title, description, source, publishedAt, imageUrl, url, category, and optional regionCode
- **TrendItemPage**: A paginated response containing a list of TrendItems, an optional nextCursor, and a totalCount
- **Category**: One of: technology, sports, finance, entertainment, health, science
- **AccessToken**: A short-lived JWT used to authenticate API requests
- **RefreshToken**: A long-lived opaque token used to obtain new AccessTokens
- **Bookmark**: A saved association between a User and a TrendItem
- **UserPreferences**: A User's selected categories and region code stored server-side
- **Rate_Limiter**: The middleware that enforces per-client request quotas
- **Health_Endpoint**: The endpoint that reports API_Server and dependency liveness
- **Locale**: A BCP 47 language tag (e.g., `en`, `en-US`, `fr`, `de`) identifying the language and optional region for content
- **I18n_Service**: The module responsible for resolving locale from requests and formatting locale-aware responses

---

## Requirements

### Requirement 1: Trend Items API

**User Story:** As a mobile client, I want to fetch paginated trending items filtered by category and region, so that I can display a relevant feed to the user.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/trends` with no query parameters, THE API_Server SHALL return a TrendItemPage with the 20 most recently published TrendItems.
2. WHEN a GET request includes a `categories` query parameter, THE API_Server SHALL return only TrendItems whose category matches one of the provided values.
3. WHEN a GET request includes a `regionCode` query parameter, THE API_Server SHALL return TrendItems matching that region code, falling back to items with no regionCode when fewer than `pageSize` regional items exist.
4. WHEN a GET request includes a `cursor` query parameter, THE API_Server SHALL return the next page of results starting after the item identified by that cursor.
5. WHEN a GET request includes a `pageSize` query parameter between 1 and 100, THE API_Server SHALL return at most that many items per page.
6. IF a `pageSize` value outside the range 1–100 is provided, THEN THE API_Server SHALL return HTTP 400 with a descriptive error message.
7. WHEN a GET request is made to `/api/v1/trends/:id`, THE API_Server SHALL return the single TrendItem matching that id.
8. IF no TrendItem exists for the requested id, THEN THE API_Server SHALL return HTTP 404 with a descriptive error message.
9. THE API_Server SHALL respond to trend list requests within 300ms at the 95th percentile under normal load.

---

### Requirement 2: Authentication — Registration and Login

**User Story:** As a new user, I want to register and log in with email and password, so that I can access personalised features.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/auth/register` with a valid email and password, THE Auth_Service SHALL create a new User record and return an AccessToken and RefreshToken.
2. IF the email provided during registration is already associated with an existing User, THEN THE Auth_Service SHALL return HTTP 409 with the message "Email already registered".
3. IF the password provided during registration is fewer than 8 characters, THEN THE Auth_Service SHALL return HTTP 400 with a descriptive validation error.
4. WHEN a POST request is made to `/api/v1/auth/login` with valid credentials, THE Auth_Service SHALL return a new AccessToken and RefreshToken.
5. IF the credentials provided during login do not match any User record, THEN THE Auth_Service SHALL return HTTP 401 with the message "Invalid credentials".
6. THE Auth_Service SHALL store passwords as bcrypt hashes with a minimum cost factor of 12.
7. THE Auth_Service SHALL issue AccessTokens with an expiry of 15 minutes.
8. THE Auth_Service SHALL issue RefreshTokens with an expiry of 30 days.

---

### Requirement 3: Authentication — Token Refresh and Logout

**User Story:** As an authenticated user, I want my session to stay alive without re-entering my password, so that I have a seamless experience.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/auth/refresh` with a valid RefreshToken, THE Auth_Service SHALL return a new AccessToken and a rotated RefreshToken.
2. IF the RefreshToken provided to `/api/v1/auth/refresh` has expired or been revoked, THEN THE Auth_Service SHALL return HTTP 401 with the message "Invalid or expired refresh token".
3. WHEN a POST request is made to `/api/v1/auth/logout` with a valid AccessToken, THE Auth_Service SHALL revoke the associated RefreshToken so it cannot be reused.
4. THE Auth_Service SHALL invalidate all RefreshTokens for a User when that User changes their password.

---

### Requirement 4: Protected Route Middleware

**User Story:** As the system, I want all user-specific endpoints to require a valid AccessToken, so that unauthorised access is prevented.

#### Acceptance Criteria

1. WHEN a request to a protected endpoint includes a valid Bearer AccessToken in the Authorization header, THE API_Server SHALL process the request.
2. IF a request to a protected endpoint is missing the Authorization header, THEN THE API_Server SHALL return HTTP 401 with the message "Authentication required".
3. IF a request to a protected endpoint includes an expired or malformed AccessToken, THEN THE API_Server SHALL return HTTP 401 with the message "Invalid or expired token".

---

### Requirement 5: User Profile Management

**User Story:** As an authenticated user, I want to view and update my profile and preferences, so that my feed is personalised.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/users/me` with a valid AccessToken, THE API_Server SHALL return the UserProfile for the authenticated User.
2. WHEN a PATCH request is made to `/api/v1/users/me` with a valid AccessToken and a displayName field, THE API_Server SHALL update the User's displayName and return the updated UserProfile.
3. WHEN a PUT request is made to `/api/v1/users/me/preferences` with a valid AccessToken and a valid UserPreferences payload, THE API_Server SHALL persist the preferences and return the updated UserPreferences.
4. IF the UserPreferences payload contains a category value not in the defined Category enum, THEN THE API_Server SHALL return HTTP 400 with a descriptive validation error.
5. WHEN a GET request is made to `/api/v1/trends` with a valid AccessToken and no explicit filter parameters, THE API_Server SHALL apply the authenticated User's stored UserPreferences as default filters.

---

### Requirement 6: Bookmarks

**User Story:** As an authenticated user, I want to save and retrieve bookmarked trend items, so that I can read them later offline.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/bookmarks/:trendItemId` with a valid AccessToken, THE API_Server SHALL create a Bookmark associating the authenticated User with the specified TrendItem and return HTTP 201.
2. IF a Bookmark already exists for the authenticated User and the specified TrendItem, THEN THE API_Server SHALL return HTTP 409 with the message "Already bookmarked".
3. WHEN a DELETE request is made to `/api/v1/bookmarks/:trendItemId` with a valid AccessToken, THE API_Server SHALL remove the Bookmark and return HTTP 204.
4. IF no Bookmark exists for the authenticated User and the specified TrendItem on a DELETE request, THEN THE API_Server SHALL return HTTP 404 with a descriptive error message.
5. WHEN a GET request is made to `/api/v1/bookmarks` with a valid AccessToken, THE API_Server SHALL return a paginated list of TrendItems bookmarked by the authenticated User, ordered by bookmark creation date descending.

---

### Requirement 7: Push Notification Delivery

**User Story:** As an authenticated user, I want to receive push notifications for new trending items in my preferred categories, so that I stay up to date.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/v1/users/me/push-token` with a valid AccessToken and an Expo push token, THE API_Server SHALL store the token associated with the authenticated User.
2. WHEN a new TrendItem is published in the CMS, THE Push_Service SHALL send a push notification to all Users whose UserPreferences include the TrendItem's category and who have a stored push token.
3. IF the Expo Push Notification service returns a non-retriable error for a push token, THEN THE Push_Service SHALL remove that push token from the Database.
4. THE Push_Service SHALL batch push notifications in groups of at most 100 tokens per Expo API request.
5. IF the Expo Push Notification service returns a retriable error, THEN THE Push_Service SHALL retry delivery with exponential backoff up to 3 attempts before logging the failure.

---

### Requirement 8: CMS Content Management

**User Story:** As an Editor, I want to create, update, and publish TrendItems through a web interface, so that I can manage trending content without writing code.

#### Acceptance Criteria

1. THE CMS SHALL provide a web interface for Editors to create TrendItems with all fields defined in the TrendItem type.
2. WHEN an Editor publishes a TrendItem in the CMS, THE CMS SHALL make the item available via the API_Server within 30 seconds.
3. WHEN an Editor unpublishes a TrendItem in the CMS, THE API_Server SHALL exclude that item from all trend list and detail responses within 30 seconds.
4. THE CMS SHALL enforce that the `category` field accepts only values from the defined Category enum.
5. THE CMS SHALL enforce that `title`, `description`, `source`, `publishedAt`, `url`, and `category` are required fields on every TrendItem.
6. WHERE image upload is configured, THE CMS SHALL accept image uploads and store the resulting URL in the `imageUrl` field of the TrendItem.

---

### Requirement 9: CMS–API Synchronisation

**User Story:** As the system, I want CMS content changes to propagate to the API reliably, so that the mobile app always reflects current content.

#### Acceptance Criteria

1. WHEN a TrendItem is created or updated in the CMS, THE CMS SHALL emit a webhook event to the API_Server.
2. WHEN the API_Server receives a valid CMS webhook event, THE API_Server SHALL update the Database record for the affected TrendItem within 5 seconds.
3. IF the API_Server fails to process a webhook event, THEN THE API_Server SHALL log the failure with the full event payload and return HTTP 500 to the CMS so the CMS retries delivery.
4. THE API_Server SHALL validate incoming webhook requests using a shared secret to reject unauthorised webhook calls with HTTP 401.

---

### Requirement 10: Input Validation and Error Handling

**User Story:** As a client developer, I want consistent, descriptive error responses, so that I can handle failures gracefully in the frontend.

#### Acceptance Criteria

1. THE API_Server SHALL validate all incoming request bodies against defined Zod schemas before processing.
2. IF request body validation fails, THEN THE API_Server SHALL return HTTP 400 with a JSON body containing a `message` field and a `errors` array describing each validation failure.
3. WHEN an unhandled exception occurs during request processing, THE API_Server SHALL return HTTP 500 with the message "Internal server error" and SHALL NOT expose stack traces or internal details to the client.
4. THE API_Server SHALL return all error responses in the format `{ "message": string, "errors"?: array }`.

---

### Requirement 11: Rate Limiting

**User Story:** As the system operator, I want to limit abusive request rates, so that the API remains available to all clients.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL allow at most 100 requests per minute per IP address on unauthenticated endpoints.
2. THE Rate_Limiter SHALL allow at most 300 requests per minute per authenticated User on protected endpoints.
3. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL return HTTP 429 with a `Retry-After` header indicating when the client may retry.
4. THE Rate_Limiter SHALL include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on all responses.

---

### Requirement 12: Security Hardening

**User Story:** As the system operator, I want the API to follow security best practices, so that user data and infrastructure are protected.

#### Acceptance Criteria

1. THE API_Server SHALL set security-relevant HTTP headers using the `helmet` middleware, including `Strict-Transport-Security`, `X-Content-Type-Options`, and `X-Frame-Options`.
2. THE API_Server SHALL enforce CORS by allowing requests only from the configured list of permitted origins.
3. THE API_Server SHALL accept HTTPS connections only in production; HTTP requests SHALL be redirected to HTTPS.
4. THE Auth_Service SHALL sign JWTs using RS256 with a minimum 2048-bit RSA key pair.
5. THE Database SHALL store no plaintext passwords or AccessTokens.
6. THE API_Server SHALL sanitise all user-supplied string inputs to prevent SQL injection and XSS payloads from being persisted.

---

### Requirement 13: Observability and Logging

**User Story:** As the system operator, I want structured logs and metrics, so that I can monitor the system and diagnose issues in production.

#### Acceptance Criteria

1. THE API_Server SHALL emit structured JSON logs for every HTTP request, including method, path, status code, response time in milliseconds, and a correlation ID.
2. THE API_Server SHALL emit structured JSON logs for every unhandled error, including the error message, stack trace, and correlation ID.
3. THE API_Server SHALL expose a `/metrics` endpoint in Prometheus exposition format, including request count, request duration histogram, and active connection gauge.
4. THE API_Server SHALL propagate a `X-Correlation-ID` header from incoming requests, generating one if absent, and include it in all log entries and outbound responses.

---

### Requirement 14: Health Checks

**User Story:** As the deployment platform, I want liveness and readiness endpoints, so that unhealthy instances can be restarted or removed from the load balancer.

#### Acceptance Criteria

1. WHEN a GET request is made to `/health/live`, THE Health_Endpoint SHALL return HTTP 200 with `{ "status": "ok" }` if the API_Server process is running.
2. WHEN a GET request is made to `/health/ready`, THE Health_Endpoint SHALL return HTTP 200 with `{ "status": "ok" }` only if the API_Server can reach the Database and any required external services.
3. IF the Database is unreachable when `/health/ready` is called, THEN THE Health_Endpoint SHALL return HTTP 503 with `{ "status": "unavailable", "reason": "database" }`.

---

### Requirement 15: Database Schema and Migrations

**User Story:** As a developer, I want a versioned database schema with migrations, so that schema changes are reproducible and reversible across environments.

#### Acceptance Criteria

1. THE Database SHALL contain tables (or collections) for: Users, RefreshTokens, TrendItems, Bookmarks, UserPreferences, and PushTokens.
2. THE API_Server SHALL apply pending migrations automatically on startup before accepting requests.
3. WHEN a migration is applied, THE API_Server SHALL log the migration name and timestamp.
4. IF a migration fails, THEN THE API_Server SHALL halt startup and log the failure with the full error.
5. THE Database schema SHALL enforce referential integrity between Bookmarks and Users, and between Bookmarks and TrendItems.

---

### Requirement 16: Environment Configuration

**User Story:** As a developer, I want all secrets and environment-specific values to be supplied via environment variables, so that the codebase contains no hardcoded credentials.

#### Acceptance Criteria

1. THE API_Server SHALL read all configuration values (database URL, JWT keys, CMS webhook secret, Expo push credentials, allowed origins) from environment variables at startup.
2. IF a required environment variable is missing at startup, THEN THE API_Server SHALL halt with a descriptive error message listing the missing variables.
3. THE API_Server SHALL provide a documented `.env.example` file listing all required and optional environment variables with descriptions.

---

### Requirement 17: Deployment and Infrastructure

**User Story:** As the system operator, I want the backend to be containerised and deployable via CI/CD, so that releases are consistent and automated.

#### Acceptance Criteria

1. THE API_Server SHALL be packaged as a Docker image using a multi-stage Dockerfile that produces a minimal production image.
2. THE API_Server Docker image SHALL run as a non-root user.
3. THE system SHALL include a `docker-compose.yml` file that starts the API_Server, Database, and CMS together for local development.
4. THE system SHALL include a CI pipeline definition that runs lint, type-check, and tests on every pull request.
5. WHEN the CI pipeline passes on the main branch, THE system SHALL build and push the Docker image to the configured container registry.

---

### Requirement 18: Testing Standards

**User Story:** As a developer, I want a comprehensive test suite, so that regressions are caught before reaching production.

#### Acceptance Criteria

1. THE API_Server SHALL have unit tests covering all Auth_Service functions, achieving at least 80% line coverage on the auth module.
2. THE API_Server SHALL have integration tests for every API endpoint that exercise the full request–response cycle against a test Database.
3. WHEN the test suite is run, THE API_Server SHALL complete all tests within 120 seconds.
4. THE API_Server SHALL include a round-trip property test verifying that a TrendItem serialised to JSON and deserialised back produces an equivalent TrendItem.
5. THE API_Server SHALL include property tests verifying that cursor-based pagination returns non-overlapping, complete result sets for any valid combination of filter parameters.

---

### Requirement 19: Multilingual Support and Locale-Based Request/Response Handling

**User Story:** As a mobile client, I want to request content in my preferred language and have the API respond in that locale, so that users see TrendItems in their native language.

#### Acceptance Criteria

1. THE TrendItem type SHALL include a `locale` field containing a BCP 47 language tag identifying the language of the item's `title` and `description` fields.
2. THE FetchTrendParams type SHALL include an optional `locale` field that clients may supply to request content in a specific Locale.
3. WHEN a GET request to `/api/v1/trends` includes an `Accept-Language` header, THE I18n_Service SHALL resolve the preferred Locale from that header and apply it as the content locale for the response.
4. WHEN a GET request to `/api/v1/trends` includes a `locale` query parameter, THE I18n_Service SHALL use that value as the content locale, taking precedence over the `Accept-Language` header.
5. WHEN an authenticated GET request to `/api/v1/trends` is made with no explicit `locale` query parameter and no `Accept-Language` header, THE I18n_Service SHALL use the `locale` field stored in the authenticated User's UserPreferences as the content locale.
6. IF a TrendItem does not have content available in the requested Locale, THEN THE API_Server SHALL return the `en` locale version of that TrendItem and SHALL include a `Content-Language: en` response header indicating the fallback.
7. THE CMS SHALL allow Editors to create and manage TrendItem content in multiple Locales, with each Locale variant storing independent `title` and `description` values.
8. WHEN an Editor publishes a new Locale variant of an existing TrendItem in the CMS, THE CMS SHALL make that variant available via the API_Server within 30 seconds.
9. THE UserPreferences type SHALL include a `locale` field containing a BCP 47 language tag representing the User's preferred content Locale.
10. WHEN a PUT request is made to `/api/v1/users/me/preferences` with a `locale` field, THE API_Server SHALL validate that the value is a well-formed BCP 47 language tag and persist it to the User's UserPreferences.
11. IF the `locale` value provided in a UserPreferences update is not a well-formed BCP 47 language tag, THEN THE API_Server SHALL return HTTP 400 with a descriptive validation error.
12. THE I18n_Service SHALL format all API error messages using the resolved request Locale where translations are available, falling back to `en` when a translation is not available.
13. THE API_Server SHALL include a `Content-Language` response header on all TrendItem responses indicating the Locale of the returned content.
14. THE API_Server SHALL include a round-trip property test verifying that a TrendItem with multilingual content serialised to JSON and deserialised back produces an equivalent TrendItem for each supported Locale.
