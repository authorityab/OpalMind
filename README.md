![OpalMind logo](img/logo.png)

# Matomo LLM Tooling

This project provides a lightweight SDK and Express-based tool service that makes Matomo analytics accessible to LLMs through Opal-compatible endpoints. It includes typed reporting helpers, HTTP wrappers, and ready-to-call tool definitions for key analytics workflows.

> Transparency note: The entire OpalMind codebase has been created through vibe-coding sessions, embracing iterative exploration over formal specifications.

## Table of Contents
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Tool Endpoints](#tool-endpoints)
- [Development Workflow](#development-workflow)
- [Cache Monitoring](#cache-monitoring)
- [Health Monitoring & Observability](#health-monitoring--observability)
- [Redis Persistence](#redis-persistence)
- [Testing](#testing)
- [Docker Deployment](#docker-deployment)
- [Production Runbook](#production-runbook)
- [Next Steps](#next-steps)

## Features
- Typed Matomo SDK with convenience methods for key metrics, most popular URLs, and top referrers.
- Expanded reporting helpers covering ecommerce revenue, event categories, campaigns, entry pages, and device breakdowns.
- **Service health monitoring** with comprehensive checks for Matomo API connectivity, cache performance, and dependency status.
- In-memory reporting cache with observable hit/miss metrics and optional event hooks.
- **Redis persistence** for tracking queue and reports cache - ensures data survives restarts (see [Redis Persistence Guide](docs/redis-persistence.md)).
- Opal Tools SDK integration exposing `/tools/*` endpoints plus discovery metadata.
- Bearer-token authenticated Express service ready for Opal integration.
- Vitest-based unit and integration tests for SDK and API layers.
- In-memory retry queue for Matomo Tracking API calls (`trackPageview`, `trackEvent`, `trackGoal`).

## Project Structure
```
.
├─ packages/
│  ├─ sdk/        # TypeScript Matomo SDK (reporting helpers, HTTP client)
│  └─ api/        # Express service exposing Opal-compatible tools
├─ .assistant/    # Planning, backlog, and task log documents
├─ README.md
└─ package.json   # Workspace scripts and tooling deps
```

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   Copy the `.env` template or adjust the provided defaults for local development:
   ```ini
   MATOMO_BASE_URL=https://matomo.example.com
   MATOMO_TOKEN=your-matomo-token
   MATOMO_DEFAULT_SITE_ID=1
   OPAL_BEARER_TOKEN=<generate-with-openssl-rand-hex-32>
   PORT=4000
   ```

3. **Build packages**
   ```bash
   npm run build --workspaces
   ```

4. **Run the API service**
   ```bash
   node packages/api/dist/server.js
   ```
   The service listens on `PORT` (default `4000`).

## Environment Variables
| Variable | Description |
|----------|-------------|
| `MATOMO_BASE_URL` | **Required.** Base URL to your Matomo instance (absolute `https://` or `http://` URL; other schemes are rejected). |
| `MATOMO_TOKEN` | **Required.** Matomo `token_auth` with the UsersManager plugin enabled and at least view access to the target sites (needed for diagnostics). Replace the scaffold placeholder with a real token. |
| `MATOMO_DEFAULT_SITE_ID` | Optional default `idSite` applied when tool requests omit `siteId`. |
| `OPAL_BEARER_TOKEN` | Bearer token required on `/tools/*` endpoints (generate securely, e.g., `openssl rand -hex 32`). |
| `PORT` | Listener port for the API service (default `4000`). |
| `OPAL_TRUST_PROXY` | Optional trust proxy setting passed to Express (comma-separated CIDRs/hosts, numeric hop count, or `true`/`false`). Defaults to `loopback,linklocal,uniquelocal`. |

> The API refuses to start unless `MATOMO_BASE_URL`, `MATOMO_TOKEN`, and `OPAL_BEARER_TOKEN` are populated with non-placeholder values.

## Available Scripts
From the repo root:
- `npm run build --workspaces` — build SDK and API packages.
- `npm run test --workspace @opalmind/sdk -- --run` — run SDK unit tests.
- `npm run test --workspace @opalmind/api -- --run` — run API integration tests.
- `npm run dev --workspace @opalmind/api` — start the API in watch mode (ts-node).
- Error simulations: `npm run test --workspace @opalmind/sdk -- --run` exercises the Matomo error classifiers (`MatomoApiError`), ensuring guidance text stays in sync.

## Tool Endpoints
All endpoints require `Authorization: Bearer <OPAL_BEARER_TOKEN>`.

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `GetKeyNumbers` | `POST /tools/get-key-numbers` | Returns visits, pageviews, and summary metrics for a period/date. |
| `GetKeyNumbersHistorical` | `POST /tools/get-key-numbers-historical` | Returns per-period key metrics for historical comparisons. |
| `GetMostPopularUrls` | `POST /tools/get-most-popular-urls` | Lists the most visited URLs for a period/date. |
| `GetTopReferrers` | `POST /tools/get-top-referrers` | Lists top referrer sources for a period/date. |
| `DiagnoseMatomo` | `POST /tools/diagnose-matomo` | Runs base URL, token, and site permission diagnostics for the configured Matomo instance. |
| `GetHealthStatus` | `POST /tools/get-health-status` | Returns comprehensive health status for Matomo API, cache performance, and service dependencies. |
| `GetEntryPages` | `POST /tools/get-entry-pages` | Shows entry-page performance with bounce and exit metrics. |
| `GetCampaigns` | `POST /tools/get-campaigns` | Aggregates referrer campaign activity and conversions. |
| `GetEcommerceOverview` | `POST /tools/get-ecommerce-overview` | Summarizes ecommerce revenue and conversion totals. |
| `GetEcommerceRevenue` | `POST /tools/get-ecommerce-revenue` | Returns total ecommerce revenue with optional per-period breakdown. |
| `GetTrafficChannels` | `POST /tools/get-traffic-channels` | Provides a high-level breakdown of traffic sources (direct, search, referrals, social, campaigns). |
| `GetGoalConversions` | `POST /tools/get-goal-conversions` | Lists goal conversion metrics with filters for specific goals or types. |
| `GetFunnelAnalytics` | `POST /tools/get-funnel-analytics` | Returns overall funnel performance alongside per-step conversions and drop-offs. |
| `GetEvents` | `POST /tools/get-events` | Returns aggregated Matomo event metrics with optional filters. |
| `GetEventCategories` | `POST /tools/get-event-categories` | Aggregates events grouped by category for quick comparisons. |
| `GetDeviceTypes` | `POST /tools/get-device-types` | Breaks down visits by high-level device type (desktop, mobile, tablet). |
| `TrackPageview` | `POST /track/pageview` | Records server-side pageviews with optional `pv_id` continuity. |
| `TrackEvent` | `POST /track/event` | Sends Matomo custom events (category/action/name/value). |
| `TrackGoal` | `POST /track/goal` | Captures goal conversions with optional revenue. |
| `*` | Responses surface guidance via `MatomoApiError` when Matomo rejects a request (auth, permissions, rate limits, etc.). |

> Revenue-bearing fields (campaigns, traffic channels, ecommerce summaries/totals, goal conversions) now return structured objects in the form `{ "value": number, "currency": "<ISO code>" }`, using the site currency resolved from Matomo. When Matomo does not expose a currency, the `currency` property is `null` and the numeric value remains available under `value`.

> `avg_time_on_site` within `GetKeyNumbers` is emitted as `{ "value": number, "unit": "seconds" }`, keeping the raw seconds from Matomo explicit for downstream formatting.

Matomo errors automatically redact `token_auth` query parameters before they reach logs or API responses; expect to see `token_auth=REDACTED` when inspecting diagnostics.

All `/tools/*` and `/track/*` routes require the same bearer token—calls without `Authorization: Bearer <OPAL_BEARER_TOKEN>` are rejected with `401 Unauthorized`. The comparison is case-sensitive, so rotate and distribute the token exactly as provisioned.

Sample responses and curl snippets are documented in `packages/api/docs/sample-responses.md`.

## Development Workflow
1. Update `.env` for your local environment.
2. Run builds/tests locally before pushing or deploying.
3. Tool discovery is provided automatically by the Opal Tools SDK (e.g., `GET /discovery`).
4. Tool handlers map directly to SDK methods—extend the SDK first, then expose new tools.

## Comparative Reporting Deltas
Upcoming UI requirements call for “current vs previous period” deltas (▲/▼) beside every reported metric. When implementing this feature:

1. **Dual fetches** – For each reporting helper (e.g., `GetMostPopularUrls`, `GetTrafficChannels`, `GetKeyNumbers`, `GetEcommerceOverview`, `GetEcommerceRevenue`, `GetGoalConversions`), request both the selected period and the immediately preceding period of identical duration.
2. **Align periods** – Derive the previous period from Matomo’s `period`/`date` inputs (e.g., `2025-09-01,2025-09-30` → `2025-08-02,2025-08-31` for `month`; `last7` → prior seven days). Preserve timezone alignment.
3. **Calculate change** – For each metric, compute `((current - previous) / previous) * 100`. Handle zero baselines explicitly (return `null`, `N/A`, or an infinity marker when the previous value is `0`).
4. **Direction indicators** – Present ▲ for positive deltas, ▼ for negative, and `—` (or similar) for zero change. Format values with one decimal place and a trailing `%`.
5. **Payload shape** – Extend tool responses to include both absolute values and delta metadata so downstream agents can render summaries and presentation assets without recomputing.

## Cache Monitoring
- The `ReportsService` keeps an in-memory cache per report helper. Configure cache behaviour via the Matomo client:
  - `cache.ttlMs` overrides the default 60s TTL.
  - `cache.onEvent` receives `{ type, feature, key, expiresAt }` notifications for hits, misses, sets, and stale evictions—pipe these into your metrics system.
- Call `client.getCacheStats()` to retrieve cumulative hit/miss/set counts and current entry totals per feature.

## HTTP Client Safeguards
- All Matomo HTTP calls now enforce an AbortController timeout (10s default) and exponential backoff with jitter for transient failures.
- Customize the behaviour via `createMatomoClient({ baseUrl, tokenAuth, http: { timeoutMs: 5000, retry: { maxAttempts: 4, baseDelayMs: 500, jitterMs: 250 } } })`.
- Network timeouts and repeated 5xx responses raise `MatomoNetworkError` with redacted endpoints so operators can trace issues without leaking credentials.

## Tracking Back-pressure
- Tracking requests honour Matomo `429`/`5xx` responses, read `Retry-After` headers, and pause the queue with exponential backoff (jitter optional).
- Inspect queue health via `client.getTrackingQueueStats()` to surface pending items, retry counts, last backoff delay, and cooldown deadlines.
- Tune behaviour with `tracking.backoff` (e.g., `createMatomoClient({ tracking: { backoff: { baseDelayMs: 250, maxDelayMs: 8000, jitterMs: 250 } } })`).
- Queue health degrades at 10 pending items or 60s backlog age and fails at 25 pending or 120s backlog by default. Override with `MATOMO_QUEUE_WARN_PENDING`, `MATOMO_QUEUE_FAIL_PENDING`, `MATOMO_QUEUE_WARN_AGE_MS`, and `MATOMO_QUEUE_FAIL_AGE_MS`.

## API Boundary Hardening
- Express applies security headers, duplicate-parameter stripping, and configurable CORS. Allow cross-origin calls by setting `OPAL_CORS_ALLOW_ALL=1` or provide a comma-separated `OPAL_CORS_ALLOWLIST`.
- Request bodies default to a 256 KB limit and can be tuned via `OPAL_REQUEST_BODY_LIMIT` (accepts byte counts like `512kb`). Oversized payloads return `413` with a redacted message.
- Rate limiting protects `/tools/*` and `/track/*` independently. Configure global limits with `OPAL_RATE_LIMIT_WINDOW_MS` and `OPAL_RATE_LIMIT_MAX`; tracking-specific bursts use `OPAL_TRACK_RATE_LIMIT_MAX`. Responses now surface `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers to aid client backoff, and the limiter honors `X-Forwarded-For` based on `OPAL_TRUST_PROXY`.
- All tool invocations pass through Zod validation before reaching handlers. Tracking endpoints enforce required fields (`url`, `category`, `action`, `goalId`) and coerce numeric inputs, returning structured `400` responses when validation fails.
- Bearer authentication enforces case-sensitive matches using constant-time comparisons and surfaces RFC6750-compliant challenges (`WWW-Authenticate` with `invalid_request`/`invalid_token`).
- Invalid or missing bearer tokens share a defensive rate-limit bucket, so repeated failures from the same address return `429` instead of bypassing throttling.
- Cache health thresholds are configurable via `MATOMO_CACHE_WARN_HIT_RATE`, `MATOMO_CACHE_FAIL_HIT_RATE`, and `MATOMO_CACHE_SAMPLE_SIZE`, and the health payload includes hit/miss counters for observability.

## Health Monitoring & Observability
The service provides comprehensive health monitoring for production deployments:

### Health Status Endpoint
Use the following endpoints to monitor service health:

- `GET /healthz` – liveness; returns 200 when the process is up (no Matomo calls).
- `GET /readyz` – readiness; mirrors `/health` and fails fast when Matomo or cache dependencies are unhealthy.
- `GET /tools/get-health-status` – full diagnostic payload with authentication.

```bash
curl -H "Authorization: Bearer your-token" \
  "http://localhost:3000/tools/get-health-status"
```

**Response:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2025-09-30T15:30:00.000Z",
  "checks": [
    {
      "name": "matomo-api",
      "status": "pass",
      "componentType": "service",
      "observedValue": 145,
      "observedUnit": "ms",
      "output": "API responded in 145ms"
    },
    {
      "name": "reports-cache",
      "status": "pass",
      "componentType": "cache", 
      "observedValue": 85.5,
      "observedUnit": "%",
      "output": "Hit rate: 85.5% (342/400 requests)"
    },
    {
      "name": "tracking-queue",
      "status": "pass",
      "componentType": "queue",
      "observedValue": 0,
      "observedUnit": "pending",
      "output": "pending=0, inflight=0, backlogAgeMs=0",
      "details": {
        "pending": 0,
        "inflight": 0,
        "totalProcessed": 128,
        "totalRetried": 9,
        "backlogAgeMs": 0,
        "cooldownUntil": null,
        "lastRetryStatus": null
      }
    }
  ]
}
```

### Health Check Components
- **Matomo API Connectivity**: Response time and reachability
- **Reports Cache Performance**: Hit rates with warning thresholds (warn <20%, fail <5%)
- **Tracking Queue Status**: Queue depth, retry cadence, and cooldown delays (defaults: warn ≥10 pending or 60s backlog age; fail ≥25 pending or 120s backlog age)
- **Site Access** *(optional)*: Site-specific permission verification

### Integration
- **Load Balancers**: Use for upstream health checks
- **Monitoring Systems**: Parse JSON for alerting (Grafana, Prometheus, etc.)
- **CI/CD**: Verify deployment health post-deployment

The unauthenticated `GET /health` endpoint mirrors this payload (without requiring a bearer token) and returns HTTP 503 when the overall status is `unhealthy`, making it suitable for container health probes. See `packages/api/docs/health-monitoring.md` for detailed documentation.

## Redis Persistence

OpalMind supports persisting the tracking retry queue and reports cache to Redis, ensuring that in-flight work and cached data survive service restarts. This is critical for production deployments where uptime and data durability matter.

### Quick Start

1. **Add Redis to docker-compose.yml**:
   ```yaml
   services:
     redis:
       image: redis:7-alpine
       volumes:
         - redis-data:/data
       command: redis-server --appendonly yes
   
   volumes:
     redis-data:
   ```

2. **Configure environment variables**:
   ```bash
   REDIS_HOST=redis
   REDIS_PORT=6379
   ```

3. **Restart the service** - Redis persistence will be automatically enabled

### Benefits

- **Restart Resilience**: Pending tracking requests and cached reports survive restarts
- **Horizontal Scaling**: Multiple API instances can share Redis for coordinated caching
- **Storage Visibility**: Operators can inspect Redis to understand storage requirements
- **Automatic Cleanup**: Redis TTLs ensure stale entries are automatically removed

### Documentation

- **[Redis Persistence Guide](docs/redis-persistence.md)** - Complete configuration and deployment guide
- **[Redis Integration Example](docs/redis-integration-example.md)** - Code examples and troubleshooting

### Storage Requirements

- **Tracking Queue**: < 1 MB for typical workloads (0-25 pending entries)
- **Reports Cache**: 10-50 MB depending on traffic and TTL settings
- **Recommended**: 512 MB Redis instance for production

## Testing
- SDK tests rely on mocked `fetch` and validate request construction and response parsing.
- API tests mock the Matomo client and simulate Express requests via `node-mocks-http`, covering happy paths and error branches.
- Run individual workspace tests using the commands listed in [Available Scripts](#available-scripts).

## Docker Deployment
- Pull the published container: `docker compose pull` (override `OPALMIND_IMAGE` to pin a specific tag if needed, defaults to `ghcr.io/authorityab/opalmind-api:latest`). The `Docker Image` GitHub Action automatically builds and pushes fresh images on every `main` push.
- Launch locally: `docker compose up -d` (reads `.env` for Matomo/Opal secrets and exposes port `3000`).
- Repo-based deploys (e.g., Portainer stacks) can rely on `stack.env` in the repo; override values through Portainer’s UI or commit a `.env` for environment-specific secrets. Make sure `docker-compose.yml` can see any additional env files you provide.
- The API refuses to start if `OPAL_BEARER_TOKEN` is unset or still equal to the scaffold value—generate a unique token per environment and inject it via your secret manager.

## Production Runbook
- Review and follow the operational checklist in [`docs/production-runbook.md`](docs/production-runbook.md) before promoting changes. It includes required secrets, test commands, health verification steps, and rollback guidance for both Docker Compose and Portainer-driven deployments.

## Next Steps
- Generate a bearer token (e.g., `openssl rand -hex 32`), store it in your secret manager, and document the rotation procedure for each environment.
- **Set up monitoring**: Integrate the health status endpoint with your monitoring stack for production alerting.
- **Enable Redis persistence**: Follow the [Redis Persistence Guide](docs/redis-persistence.md) to ensure queue and cache durability.
- Expand the SDK with additional reporting helpers (events, segments) and mirror them in the tool service.
- Document discovery payloads and Opal-specific configuration in more detail as integration progresses.
- Tune caching defaults based on traffic patterns and monitor Matomo load.
- Ship cache stats and health metrics to your preferred observability stack (Grafana/Prometheus/etc.) once production traffic is available.
