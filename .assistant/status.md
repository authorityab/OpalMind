# Status

## Focus
Integrate the existing MatoKit project into the refreshed `.assistant/` workflow while prioritizing observability follow-ups and queue persistence after recent reliability upgrades.

## Now / Next / Later
See `.assistant/plan.md` for details.
- Now: P-002 Integrate health endpoint with monitoring.
- Next: P-005 Persist retry queue/cache; P-006 Extend analytics coverage.
- Later: P-007 Publish Opal discovery guide; P-008 Introduce structured logging pipeline; P-009 Lean build and dependency audit.

## Risks
- Monitoring platform undecided, leaving P-002 blocked until owners align on tooling.
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
- Documented secure bearer token requirement in deployment docs and troubleshooting playbook.
- Marked P-001, P-003, and P-004 complete after enforcing secrets, adding rate-limit handling, and introducing idempotent tracking.
- Updated history/backlog/plan to reflect the latest reliability milestones.

## Open Questions
- Q1: Which monitoring platform (Grafana, DataDog, other) will poll `/tools/get-health-status` so we can tailor payload parsing and alert thresholds?
- Q2: What persistence layer should back the retry queue and shared cache once we scale beyond single-instance memory?
- Q3: Do we need multi-tenant isolation for Matomo credentials or will deployments stay single-tenant per client?
