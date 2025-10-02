# Status

## Focus
Integrate the existing MatoKit project into the refreshed `.assistant/` workflow while prioritizing secret management and observability follow-ups from the reliability roadmap.

## Now / Next / Later
See `.assistant/plan.md` for details.
- Now: P-001 Harden secret management; P-002 Integrate health endpoint with monitoring.
- Next: P-003 Add Matomo rate-limit awareness; P-004 Make tracking retries idempotent.
- Later: P-005 Persist retry queue/cache; P-006 Extend analytics coverage; P-007 Publish Opal discovery guide; P-008 Introduce structured logging pipeline.

## Risks
- Monitoring platform undecided, leaving P-002 blocked until owners align on tooling.
- Retry queue persistence choice unresolved; impacts P-005 scope and deployment expectations.
- Current in-memory cache/queue approach limits horizontal scaling and may require rapid adjustments once traffic grows.

## Artifacts
- Vision & mission: `.assistant/canvas/vision.md`
- Design notes & open questions: `.assistant/canvas/notes.md`, `.assistant/canvas/questions.md`
- Goals & stakeholders: `.assistant/canvas/goals.md`, `.assistant/canvas/stakeholders.md`
- Updated backlog & plan: `.assistant/backlog.md`, `.assistant/plan.md`
- History of milestones: `.assistant/history.md`
- ADR stubs: `.assistant/adr/ADR-0001.md`–`.assistant/adr/ADR-0003.md`

## Changelog
- Rebuilt canvas files to capture vision, architecture, goals, and open questions.
- Normalized backlog, plan, history, and status to reflect current priorities and risks.
- Drafted ADRs summarizing API framework, caching, and retry-queue decisions.

## Open Questions
- Q1: Which monitoring platform (Grafana, DataDog, other) will poll `/tools/get-health-status` so we can tailor payload parsing and alert thresholds?
- Q2: What persistence layer should back the retry queue and shared cache once we scale beyond single-instance memory?
- Q3: Do we need multi-tenant isolation for Matomo credentials or will deployments stay single-tenant per client?
