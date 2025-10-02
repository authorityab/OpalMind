# Design Notes

## Architecture
- Monorepo with `packages/sdk` (typed Matomo client) and `packages/api` (Express tool service) sharing TypeScript tooling from the root workspace.
- API exposes Opal-compatible `/tools/*` endpoints plus `/discovery`, enforcing bearer-token auth and translating SDK errors into guidance-rich responses.
- SDK centralizes Matomo HTTP access (`matomoGet`, tracking helpers), layers in Zod validation, and surfaces caching + retry queues shared across tools.
- In-memory cache tracks hit/miss metrics; retry queue handles Tracking API writes with pv_id continuity after transient failures.
- Docker/compose/Portainer assets deploy the API with environment-driven configuration and ready-to-pull container images from GHCR.

## Operational Guardrails
- All secrets (`token_auth`, bearer token) supplied via environment variables; never logged.
- Health monitoring endpoint aggregates Matomo connectivity, cache performance, and queue status to feed observability tooling.
- CI pipeline (lint/type/test/build) plus Docker image publishing keep deployments reproducible.

## Future Considerations
- Evaluate durable storage (Redis/Postgres) when retry queue persistence becomes mandatory.
- Expand telemetry exports so cache and queue stats feed centralized monitoring stacks.
- Document Opal discovery contract and examples to reduce onboarding friction for new tool consumers.
