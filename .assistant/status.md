# Status

## Focus
Advance Matomo operational resilience by auto-resolving default site IDs and honoring Matomo back-pressure while surfacing actionable queue metrics.

## Now / Next / Later
- Now: B-007 Auto siteId defaults, P-016 Matomo back-pressure handling.
- Next: P-018 Bounded caches, P-019 Health queue metrics, P-005 queue persistence, P-006a funnel hardening, P-011–P-015 analytics expansion.
- Later: P-007 Publish Opal discovery guide; P-008 Introduce structured logging pipeline; P-009 Lean build and dependency audit.

## Risks
- Default site resolution remains manual until B-007 lands, risking inconsistent reporting defaults.
- Monitoring platform alignment still pending; SRE must adopt the recommended health alerts to ensure coverage.
- Persistence backend for cache/queue still undecided; impacts P-005 scope and deployment expectations.
- Rate-limit handling now exists, but alerting hooks remain manual until monitoring plan lands.

## Artifacts
- Vision & mission: `.assistant/canvas/vision.md`
- Design notes & open questions: `.assistant/canvas/notes.md`, `.assistant/canvas/questions.md`
- Goals & stakeholders: `.assistant/canvas/goals.md`, `.assistant/canvas/stakeholders.md`
- Updated backlog & plan: `.assistant/backlog.md`, `.assistant/plan.md`
- History of milestones: `.assistant/history.md`
- ADR stubs: `.assistant/adr/ADR-0001.md`–`.assistant/adr/ADR-0003.md`

## Changelog
- Honoured Matomo back-pressure in the tracking queue with Retry-After aware backoff, queue metrics, and SDK regression coverage.
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
