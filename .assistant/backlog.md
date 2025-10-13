# Backlog
- [x] P-001 Harden secret management for OpalMind deployments
      tags: security,ops  priority: high  est: 0.5d
      deps: ADR-0001
      accepts: Replace placeholder bearer token, document rotation strategy, and ensure env templates reference secure secret storage.
- [ ] P-002 Integrate health endpoint with monitoring
      tags: observability,ops  priority: high  est: 1d
      deps: ADR-0002
      accepts: `/tools/get-health-status` polled by chosen platform with warning/failure thresholds defined and runbook linked in docs.
- [x] P-002b Update Matomo token authentication probe
      tags: observability,ops  priority: medium  est: 0.5d
      deps: P-002
      accepts: Diagnostics use `UsersManager.getUserByTokenAuth` with fallback to legacy `API.getLoggedInUser`; token failures surface actionable guidance; tests/docs updated to reflect new method order.
- [x] P-002a Swap Matomo version health probe
      tags: observability,ops  priority: medium  est: 0.5d
      deps: P-002
      accepts: Health check uses `API.getMatomoVersion` with fallback to legacy `API.getVersion` when needed; diagnostics no longer report false failures on Matomo 5; docs/tests updated to reflect the probe change.
- [ ] B-001 Fix traffic channel response parsing
      tags: bug,analytics  priority: high  est: 1d
      deps: ADR-0001
      accepts: Month-period traffic channel and most-popular URL requests succeed when Matomo Cloud returns objects instead of arrays (while on-prem works); schema updated or responses normalized; tests cover the regression scenario.
- [x] P-003 Add Matomo rate-limit awareness to SDK
      tags: reliability,sdk  priority: high  est: 1.5d
      deps: ADR-0001
      accepts: Detect limit responses, throttle retries, and surface actionable guidance to API consumers with test coverage.
- [x] P-004 Make tracking retries idempotent
      tags: reliability,api  priority: medium  est: 1d
      deps: ADR-0003
      accepts: Tracking queue deduplicates retried events/goals and documents caller requirements for idempotency keys.
- [ ] P-005 Persist retry queue and cache state
      tags: infrastructure,reliability  priority: medium  est: 2d
      deps: ADR-0003
      accepts: Queue/cache survive restarts via agreed storage (e.g., Redis) with configuration docs and migration notes.
- [x] P-006 Add funnel analytics helpers
      tags: feature,sdk  priority: medium  est: 1.5d
      deps: ADR-0001
      accepts: Provide funnel analytics helpers surfaced through the API tools, covering data retrieval, normalization, and documentation/tests for usage.
- [ ] P-006a Harden funnel analytics flow outputs
      tags: feature,sdk  priority: medium  est: 1d
      deps: P-006
      accepts: Ensure funnel helpers expose consistent step definitions/metrics across Matomo variants, document known limitations, and add tests exercising multi-step flows and degraded responses.
- [ ] P-010 Support multi-site indexing and configuration
      tags: feature,config,multi-tenant  priority: high  est: 2d
      deps: ADR-0001
      accepts: As a deployment operator, I can configure multiple websites within one Matomo instance by defining environment-variable pairs for each siteId and site name (shared base URL) so the containerized app routes events correctly, with docs covering the env schema and limits.
      notes:
        1. Define a site-name → siteId mapping (JSON/YAML file, lightweight datastore, or hardcoded map for small footprints); refresh it whenever the Matomo roster changes. Advanced option: hydrate the map dynamically via `SitesManager.getAllSitesId`.
        2. Update the Opal tool logic to parse user queries for site names, translate them to siteIds, call Matomo helpers with the resolved ids, and collate the comparative analytics (e.g., dual `GetKeyNumbers` calls for multiple sites).
- [ ] P-007 Publish Opal discovery integration guide
      tags: docs,dx  priority: low  est: 1d
      deps: ADR-0001
      accepts: README/docs include discovery payload reference, onboarding checklist, and sample tool invocations kept in sync with code.
- [ ] P-008 Introduce structured logging pipeline
      tags: ops,observability  priority: low  est: 1d
      deps: ADR-0002
      accepts: Replace console logging with structured logger, route to standard output, and document log levels for production.
- [ ] P-009 Lean build and dependency audit
      tags: maintenance,build  priority: medium  est: 1d
      deps: ADR-0001, ADR-0002, ADR-0003
      accepts: Remove unused code, dependencies, and build artifacts; document any deletions or exemptions to keep the codebase minimal.
- [ ] P-011 Add goal analytics helpers
      tags: feature,sdk  priority: medium  est: 1.5d
      deps: ADR-0001
      accepts: Expose goal analytics helpers via API tools with data normalization, updated docs, and test coverage for goal summaries.
- [ ] P-012 Add cohort retention analytics
      tags: feature,analytics  priority: medium  est: 2d
      deps: ADR-0001
      accepts: Provide cohort and retention analytics helpers surfacing repeat visit cadence, churn metrics, and stickiness insights with docs/tests.
- [ ] P-013 Add campaign acquisition analytics
      tags: feature,analytics  priority: medium  est: 1.5d
      deps: ADR-0001
      accepts: Deliver helpers for campaign/channel breakdowns (UTMs, conversions) available via API tools and documented with scenarios/tests.
- [ ] P-014 Add event flow analytics
      tags: feature,analytics  priority: medium  est: 2d
      deps: ADR-0001
      accepts: Implement entry→exit journey/path reports with drop-off detection, expose through assistants, and cover with docs/tests.
- [ ] P-015 Add site search analytics helpers
      tags: feature,analytics  priority: low  est: 1d
      deps: ADR-0001
      accepts: Surface internal site search terms, zero-result queries, and follow-up actions through the API tools with supporting docs/tests.
