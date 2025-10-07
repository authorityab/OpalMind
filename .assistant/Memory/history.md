# Project History & Decisions

## Overview
- Matokit v2 makes Matomo analytics usable for LLM-powered assistants by pairing a typed SDK with an Opal-compatible Express tool service.
- Development follows an incremental roadmap (scaffolding → read helpers → write helpers → quality/docs) captured in `.assistant/Memory` for async collaboration.
- Every feature extends the SDK first, then surfaces through API tools with matching tests and documentation, keeping the monorepo cohesive.

## Workflow Snapshot
- TypeScript workspaces (`packages/sdk`, `packages/api`) share linting, testing, and build tooling defined at the repo root.
- New capabilities follow a repeatable loop: design helper → implement in SDK → expose via API → add tests → document usage.
- Tracking and reporting layers use Zod schemas to validate Matomo payloads, reducing runtime surprises for downstream tools.
- Memory files (`backlog.md`, `plan.md`, `task_log.md`, `roadmap.md`) form the single source of truth for priorities, decisions, and completed work.

## Milestones & Timeline
- **M0 – Scaffolding (Days 1-2)**: Bootstrapped the monorepo, initialized memory docs, confirmed Matomo base URL defaults, and wired environment handling.
- **M1 – Read MVP (Days 3-5)**: Built the reporting SDK (`matomoGet`, key numbers, popular URLs, referrers), registered tools, and added sample docs plus integration tests.
- **M2 – Write MVP (Days 6-8)**: Implemented tracking endpoints (`trackPageview`, `trackEvent`, `trackGoal`) with an in-memory retry queue to guarantee delivery.
- **M3 – Quality & Docs (Days 9-10)**: Hardened CI (lint/type/test/build), published Docker workflow + compose/Portainer assets, expanded metrics (events, entry pages, campaigns), added caching, and documented historical comparisons.

## Key Decisions & Outcomes
- **Matomo Defaults**: Locked the fallback base URL to `https://matomo.surputte.se`, stored tokens in `.env`, and standardized `MATOMO_DEFAULT_SITE_ID=1` for reliability.
- **SDK Design**: Centralized HTTP handling via `matomoGet`, mandating Zod parsing for every response to catch schema drift early.
- **Tool Exposure**: Embraced Opal Tools SDK for `/discovery` generation, ensuring new helpers are surfaced with minimal boilerplate.
- **Tracking Reliability**: Added an in-memory retry queue to keep `pv_id` continuity and avoid data loss on transient errors.
- **Delivery Pipeline**: CI builds cover lint, typecheck, tests, and bundle; Docker images publish to `ghcr.io/authorityab/opalytics-api`, and compose defaults to the published tag.
- **Runtime Defaults**: Shifted service port to `3000` for container parity and updated docs, stack files, and env templates accordingly.

## Completed Work Highlights
### SDK & Reporting
- Added `runDiagnostics` helper and `/tools/diagnose-matomo` endpoint to surface Matomo connectivity, token, and site-access checks (SDK-010A).
- Implemented core helpers (`getKeyNumbers`, `getMostPopularUrls`, `getTopReferrers`, `getEvents`, `getEntryPages`, `getCampaigns`).
- Added historical comparisons via `getKeyNumbersSeries` powering the `GetKeyNumbersHistorical` tool.
- Introduced in-memory caching of reports with configurable TTL to reduce Matomo load.
- Expanded data coverage with ecommerce revenue summaries, event category aggregations, and device type breakdown helpers.
- Built ecommerce revenue totals helper with optional per-period series to simplify KPI rollups.
- Added traffic channel breakdown helper and API tool for high-level source analysis with filtering.
- Delivered goal conversions helper and tool with goal-type filtering and explicit ecommerce/manual labeling.

### API & Tooling
- Surfaced typed Matomo error handling so Opal receives guidance-rich failures (SDK-010B).
- Express service exposes all tools with bearer auth and Opal discovery metadata.
- Integration tests mock Matomo responses to validate request construction and error handling.
- Sample responses and curl snippets live under `packages/api/docs/` for quick onboarding.

### Tracking Layer
- Added `trackPageview`, `trackEvent`, and `trackGoal` endpoints with shared retry logic and schema validation.
- Ensured queue maintains `pv_id` continuity and retries transient failures before surfacing errors.

### Infrastructure & DevOps
- Verified containerization stack in Portainer; current Dockerfile, compose, and stack assets deploy cleanly.
- Dockerfile and `docker-compose.yml` align local/production setups; Portainer stack files support remote deployment.
- GitHub Actions workflows cover CI and container publish, ensuring images stay in sync with `main`.
- Compose now pulls the published image by default, allowing thin clients to deploy without local builds.
- Instrumented reporting cache with hit/miss stats and event hooks to feed external monitoring.

### Documentation & Process
- README documents structure, scripts, environment variables, tool endpoints, and deployment steps.
- `.assistant/Memory` tracks backlog, roadmap, plans, and this history for future collaborators.
- Historical comparison docs and tests clarify how to consume the new time-series helper.

## Pending & Parking Lot
- **Backlog**: SDK-010A+ (Matomo diagnostics & robustness initiatives), SDK-011 (historical key metrics analysis), SDK-012A+ (UX enhancements), SDK-013A+ (analytics intelligence), SDK-014A+ (integrations & reporting).
- **Parking Lot**: Evaluate a Docusaurus site to host richer guides once core functionality stabilizes.
- **Discoverability**: Link this history doc from `backlog.md` and surface it in future docs (e.g., a Docusaurus site) so teammates can find it quickly.
- **Next Reviews**: Confirm whether containerization tasks can be marked complete now that assets and pipelines exist, and capture future decisions in `task_log.md` as milestones land.

## References
- Roadmap: `.assistant/Memory/roadmap.md`
- Backlog: `.assistant/Memory/backlog.md`
- Task Log: `.assistant/Memory/task_log.md`
- Current Plan: `.assistant/Memory/plan.md`
