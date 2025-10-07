# Goals

## Short-term (1–2 sprints)
- Lock down secret management for bearer tokens and Matomo credentials across environments.
- Wire `/tools/get-health-status` into the chosen monitoring stack with alert thresholds and runbook.
- Close remaining SDK-010 reliability tasks (rate limits, idempotent retries) with regression coverage.

## Mid-term (1–2 months)
- Introduce persistent storage for the tracking retry queue and shared caches to support horizontal scaling.
- Expand analytics coverage (events, funnels, segments) and keep Opal tool definitions in sync.
- Publish discovery and integration docs so teams can self-serve Opalytics adoption.

## Long-term (quarter+)
- Stream health/cache metrics into the central observability platform with dashboards and alerts.
- Add proactive insights (trend analysis, anomaly detection, comparative reporting) for richer assistant responses.
- Explore multi-tenant and role-based access controls if multiple clients share an instance.
