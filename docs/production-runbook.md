# OpalMind Production Runbook

## Overview
This runbook documents the operational steps required to deploy and maintain the OpalMind Matomo service in production. It covers pre-flight validation, rollout and rollback commands, health verification, and ongoing observability tasks.

## Pre-Deployment Checklist
1. **Secrets**
   - `MATOMO_BASE_URL` — absolute `https://` or `http://` URL pointing to your Matomo instance.
   - `MATOMO_TOKEN` — Matomo `token_auth` with view access to the target site(s) and permission to call `UsersManager.getUserByTokenAuth` (ensure the UsersManager plugin stays enabled).
   - `OPAL_BEARER_TOKEN` — 32+ byte random token (generate with `openssl rand -hex 32`).
   - Optional: `MATOMO_DEFAULT_SITE_ID`, cache/queue thresholds, `OPAL_TRUST_PROXY`.
2. **Config validation**
   - Ensure `.env`, `stack.env`, or secret manager entries are populated with non-placeholder values.
   - Confirm `OPAL_TRUST_PROXY` reflects the number of trusted hops (e.g., `true`, `1`, or a comma-separated list of CIDRs) when the service runs behind load balancers.
3. **Tests** (run from repo root)
   ```bash
   npm ci
   npm run build --workspaces
   npm run test --workspace @opalmind/sdk -- --run --reporter=basic
   npm run test --workspace @opalmind/api -- --run
   ```
4. **Container image**
   - Verify `ghcr.io/authorityab/opalmind-api:<tag>` exists (CI publishes on `main`).
   - Decide whether to pin `OPALMIND_IMAGE` in Compose/Portainer for rollout.

## Deployment
### Docker Compose (local/CI)
```bash
docker compose pull
docker compose up -d
```
- Ensure `docker-compose.yml` can read the environment file containing Matomo/Opal secrets.
- To force a restart with new configuration: `docker compose up -d --force-recreate`.

### Portainer / Swarm
1. Upload or edit the stack referencing `deploy/portainer-stack.yml`.
2. Populate stack environment variables (or mount a secret file) matching the checklist above.
3. Deploy/Update the stack. Portainer will pull `OPALMIND_IMAGE` (override via stack variable if pinning).

## Post-Deployment Verification
1. **Container health**
   ```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
   ```
2. **Authenticated health payload**
   ```bash
   curl -H "Authorization: Bearer $OPAL_BEARER_TOKEN" \
     http://localhost:3000/tools/get-health-status | jq
   ```
   - Confirm `status` is `healthy` or `degraded` (investigate `unhealthy`).
   - Inspect `checks[]` for `matomo-api` and `reports-cache` metrics.
3. **Readiness probe**
   ```bash
   curl -i http://localhost:3000/health
   ```
   - Expects `200 OK` when overall status is healthy; `503` otherwise (with secrets redacted).
4. **Rate limit headers** — issue two quick requests to `/tools/get-key-numbers` and confirm `Retry-After`/`X-RateLimit-*` headers increment as expected.

## Observability & Alerting
- Ship logs emitted by `@opalmind/logger` (JSON) to your log aggregation platform; tokens are auto-redacted.
- Monitor `reports-cache` hit rate; adjust cache TTL or thresholds via env vars if sustained below warning/failure thresholds.

## Rollback
1. Revert to previous image tag:
   ```bash
   export OPALMIND_IMAGE=ghcr.io/authorityab/opalmind-api:<previous-tag>
   docker compose up -d
   ```
   or update the Portainer stack variable and redeploy.
2. Validate health endpoints as in the verification section.
3. If rollback fails, scale service to zero and investigate Matomo connectivity or token issues before reattempting.

## Token Rotation
1. Generate new bearer token: `openssl rand -hex 32`.
2. Update secret store / env file and redeploy service (hot reload is not supported).
3. Distribute new token to trusted clients; revoke old token immediately.

## Incident Response
- Collect recent logs with `docker compose logs --tail=200 opalmind-api` (secrets redacted automatically).
- Use `tools/diagnose-matomo` and `tools/get-health-status` to confirm Matomo connectivity before escalating to Matomo admins.
- Review rate limit headers; adjust request pacing or Matomo archiving schedules if 429 responses persist.
