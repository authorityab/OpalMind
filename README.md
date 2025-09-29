# Matomo LLM Tooling

This project provides a lightweight SDK and Express-based tool service that makes Matomo analytics accessible to LLMs through Opal-compatible endpoints. It includes typed reporting helpers, HTTP wrappers, and ready-to-call tool definitions for key analytics workflows.

## Table of Contents
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Tool Endpoints](#tool-endpoints)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Next Steps](#next-steps)

## Features
- Typed Matomo SDK with convenience methods for key metrics, most popular URLs, and top referrers.
- Expanded reporting helpers covering ecommerce revenue, event categories, campaigns, entry pages, and device breakdowns.
- In-memory reporting cache with observable hit/miss metrics and optional event hooks.
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
   OPAL_BEARER_TOKEN=change-me
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
| `MATOMO_BASE_URL` | Base URL to your Matomo instance (should include host, optional path). |
| `MATOMO_TOKEN` | Matomo `token_auth` used for Reporting API calls. |
| `MATOMO_DEFAULT_SITE_ID` | Default `idSite` used when tool requests omit `siteId`. |
| `OPAL_BEARER_TOKEN` | Bearer token required on `/tools/*` endpoints. |
| `PORT` | Listener port for the API service (default `4000`). |

## Available Scripts
From the repo root:
- `npm run build --workspaces` — build SDK and API packages.
- `npm run test --workspace @matokit/sdk -- --run` — run SDK unit tests.
- `npm run test --workspace @matokit/api -- --run` — run API integration tests.
- `npm run dev --workspace @matokit/api` — start the API in watch mode (ts-node).

## Tool Endpoints
All endpoints require `Authorization: Bearer <OPAL_BEARER_TOKEN>`.

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `GetKeyNumbers` | `POST /tools/get-key-numbers` | Returns visits, pageviews, and summary metrics for a period/date. |
| `GetKeyNumbersHistorical` | `POST /tools/get-key-numbers-historical` | Returns per-period key metrics for historical comparisons. |
| `GetMostPopularUrls` | `POST /tools/get-most-popular-urls` | Lists the most visited URLs for a period/date. |
| `GetTopReferrers` | `POST /tools/get-top-referrers` | Lists top referrer sources for a period/date. |
| `GetEntryPages` | `POST /tools/get-entry-pages` | Shows entry-page performance with bounce and exit metrics. |
| `GetCampaigns` | `POST /tools/get-campaigns` | Aggregates referrer campaign activity and conversions. |
| `GetEcommerceOverview` | `POST /tools/get-ecommerce-overview` | Summarizes ecommerce revenue and conversion totals. |
| `GetEcommerceRevenue` | `POST /tools/get-ecommerce-revenue` | Returns total ecommerce revenue with optional per-period breakdown. |
| `GetTrafficChannels` | `POST /tools/get-traffic-channels` | Provides a high-level breakdown of traffic sources (direct, search, referrals, social, campaigns). |
| `GetGoalConversions` | `POST /tools/get-goal-conversions` | Lists goal conversion metrics with filters for specific goals or types. |
| `GetEvents` | `POST /tools/get-events` | Returns aggregated Matomo event metrics with optional filters. |
| `GetEventCategories` | `POST /tools/get-event-categories` | Aggregates events grouped by category for quick comparisons. |
| `GetDeviceTypes` | `POST /tools/get-device-types` | Breaks down visits by high-level device type (desktop, mobile, tablet). |
| `TrackPageview` | `POST /track/pageview` | Records server-side pageviews with optional `pv_id` continuity. |
| `TrackEvent` | `POST /track/event` | Sends Matomo custom events (category/action/name/value). |
| `TrackGoal` | `POST /track/goal` | Captures goal conversions with optional revenue. |

Sample responses and curl snippets are documented in `packages/api/docs/sample-responses.md`.

## Development Workflow
1. Update `.env` for your local environment.
2. Run builds/tests locally before pushing or deploying.
3. Tool discovery is provided automatically by the Opal Tools SDK (e.g., `GET /discovery`).
4. Tool handlers map directly to SDK methods—extend the SDK first, then expose new tools.

## Cache Monitoring
- The `ReportsService` keeps an in-memory cache per report helper. Configure cache behaviour via the Matomo client:
  - `cache.ttlMs` overrides the default 60s TTL.
  - `cache.onEvent` receives `{ type, feature, key, expiresAt }` notifications for hits, misses, sets, and stale evictions—pipe these into your metrics system.
- Call `client.getCacheStats()` to retrieve cumulative hit/miss/set counts and current entry totals per feature.

## Testing
- SDK tests rely on mocked `fetch` and validate request construction and response parsing.
- API tests mock the Matomo client and simulate Express requests via `node-mocks-http`, covering happy paths and error branches.
- Run individual workspace tests using the commands listed in [Available Scripts](#available-scripts).

## Docker Deployment
- Pull the published container: `docker compose pull` (override `MATOKIT_IMAGE` to pin a specific tag if needed, defaults to `ghcr.io/puttrix/matokit-api:latest`). The `Docker Image` GitHub Action automatically builds and pushes fresh images on every `main` push.
- Launch locally: `docker compose up -d` (reads `.env` for Matomo/Opal secrets and exposes port `3000`).
- For Portainer, copy `deploy/matokit.env.example` to `matokit.env`, fill in secrets, and point the stack at `deploy/portainer-stack.yml`—ensure the stack references your published registry tag.

## Next Steps
- Replace the default bearer token with a secure secret before deploying.
- Expand the SDK with additional reporting helpers (events, segments) and mirror them in the tool service.
- Persist tracking queue and add durability/caching as traffic increases.
- Document discovery payloads and Opal-specific configuration in more detail as integration progresses.
- Tune caching defaults based on traffic patterns and monitor Matomo load.
- Ship cache stats to your preferred observability stack (Grafana/Prometheus/etc.) once production traffic is available.
