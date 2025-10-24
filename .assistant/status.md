# Status

## Focus
Land B-007 so Matomo tools auto-resolve siteId defaults and stage queue observability improvements.

## Now / Next / Later
- Now: B-007 Auto-resolve Matomo siteId defaults.
- Next: P-018 Bounded caches, P-019 Health queue metrics, P-005 queue persistence, P-006a funnel hardening, P-011–P-015 analytics expansion.
- Later: P-007 Publish Opal discovery guide; P-008 Introduce structured logging pipeline; P-009 Lean build and dependency audit; P-020 Align authentication documentation; B-005 Improve tracking diagnostics; B-006 Support decimal parsing.

## Risks
- Default site resolution remains manual until B-007 ships, risking inconsistent reporting defaults.
- Tracking queue observability lacks real metrics until P-019 lands, leaving SRE without actionable queue depth/age signals.
- Persistence backend for cache/queue still undecided, which impacts P-005 scope and deployment expectations.
- Monitoring platform alignment remains open; alert hooks stay manual until an owner commits.

## Artifacts
- Vision & mission: `.assistant/canvas/vision.md`
- Design notes & open questions: `.assistant/canvas/notes.md`, `.assistant/canvas/questions.md`
- Goals & stakeholders: `.assistant/canvas/goals.md`, `.assistant/canvas/stakeholders.md`
- Updated backlog & plan: `.assistant/backlog.md`, `.assistant/plan.md`
- History of milestones: `.assistant/history.md`
- ADR stubs: `.assistant/adr/ADR-0001.md`–`.assistant/adr/ADR-0003.md`

## Changelog
- Hardened Matomo diagnostics to require UsersManager token permissions, surfaced guidance when legacy methods are missing, refreshed README/runbook docs, and added SDK regression coverage (B-018).
- Honoured Matomo back-pressure in the tracking queue with Retry-After aware backoff, queue metrics, and SDK regression coverage.
- Surfaced tracking queue depth/age in health checks with configurable warn/fail thresholds, SDK/API tests, and updated operator docs.
- Hardened Express boundary with custom security headers, CORS allowlists, rate limiting, payload size guards, and Zod validation for `/tools/*` and `/track/*`, including regression coverage and documentation updates.
- Normalized bearer authentication with constant-time, case-insensitive checks and RFC6750 challenges, plus regression coverage for header variations.
- Configurable cache health thresholds with enriched health payload details and SDK/API env overrides, documenting operator tuning guidance.
- Added `/healthz` and `/readyz` endpoints with coverage/docs so liveness and readiness are monitored independently.
- Replaced ToolsService logging with redacted structured entries and added regression coverage to prove no request/response payload leakage.
- Added AbortController-driven timeouts and exponential backoff to the Matomo HTTP client with new SDK coverage and configuration knobs.
- Wired `/health` endpoint to real Matomo diagnostics, surfacing degraded/unhealthy states via HTTP status and adding regression coverage.
- Enforced Matomo configuration guards, removed placeholder defaults, expanded monitoring docs/runbook, and completed P-002.
- Enforced bearer auth on `/track/*` routes and extended regression coverage/documentation, closing B-003.
- Redacted Matomo `token_auth` from HTTP error endpoints and added SDK/API regression coverage to close the exposure gap.
- Rebranded the codebase, packages, and deployment assets from Opalytics to OpalMind.
- Documented secure bearer token requirement in deployment docs and troubleshooting playbook.
- Marked P-001, P-003, and P-004 complete after enforcing secrets, adding rate-limit handling, and introducing idempotent tracking.
- Updated history/backlog/plan to reflect the latest reliability milestones.
- Completed P-006 by shipping funnel analytics helpers in the SDK and new `/tools/get-funnel-analytics` API endpoint with docs/tests.
- Patched funnel step normalization to read nested Matomo `definition.steps` containers and added regression coverage for missing flow metrics.
- Hardened goal conversion normalization to flatten nested Matomo buckets, merge duplicate goals, reject metadata-only records, and allow label-based lookups alongside Matomo special IDs.
- Completed P-002a by switching health diagnostics to `API.getMatomoVersion` with legacy fallback, adding regression coverage, and updating monitoring docs.
- Completed P-002b by validating tokens through `UsersManager.getUserByTokenAuth` with a fallback to `API.getLoggedInUser`, updating docs/tests to match.
- Logged follow-up backlog item P-006a to finish funnel analytics hardening and mirrored it in the active plan.

## Open Questions
- Q1: Which monitoring platform (Grafana, DataDog, other) will poll `/tools/get-health-status` so we can tailor payload parsing and alert thresholds?
- Q2: What persistence layer should back the retry queue and shared cache once we scale beyond single-instance memory?
- Q3: Do we need multi-tenant isolation for Matomo credentials or will deployments stay single-tenant per client?
