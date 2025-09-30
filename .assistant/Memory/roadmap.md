# Roadmap

## Milestones

### M0 – Scaffolding (Days 1-2)
- Monorepo toolchain (TypeScript, ESLint, Prettier, Vitest).
- SDK skeleton with fetch wrapper and URL builder.
- Fastify API skeleton with health check.
- Opal Tools SDK wired up with a hello-world tool.

### M1 – Read MVP (Days 3-5)
- Implement reporting helpers (`getKeyNumbers`, `getMostPopularUrls`, `getTopReferrers`).
- Register tools with Opal manifest exposed via `/discovery`.
- Tests and sample scripts hitting a test Matomo instance.

### M2 – Write MVP (Days 6-8)
- Implement tracking helpers (`trackPageview`, `trackEvent`, `trackGoal`) with queue + retry.
- Expose tracking endpoints via tool API.

### M3 – Quality & Docs (Days 9-10)
- Add caching, pagination parameters, and archiving warnings.
- Documentation (README, quick start) and CI green.
- Opal end-to-end validation in the registry.

## Dependencies & Notes
- Matomo base URL confirmed: https://matomo.surputte.se (token provided via `.env`).
- Default site ID: 1 (configured as fallback).
- Confirm hosting preference for the API service.
- Ensure secrets management strategy before integrating CI.
