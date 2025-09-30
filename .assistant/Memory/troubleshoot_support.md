# Troubleshooting & Support Playbook

## Quick Access
- **Container logs (today):** `docker logs --since "$(date -I)" matokit-api` or `docker compose logs -f --since "$(date -I)" matokit-api`; in Portainer, open the container → Logs → set “Since” to today.
- **Live logs inside container:** attach with `/bin/sh`, then `tail -f /proc/1/fd/1` (stdout) and `tail -f /proc/1/fd/2` (stderr); keep the tail running while reproducing the issue.
- **Local dev server:** `npm run dev --workspace @matokit/api` (Express + Opal service with ts-node loader). For fewer logs in prod, plan to move to structured logging (`INF-004`).

## Current Troubleshooting Steps
- Verify Matomo connectivity manually with curl: `curl "$MATOMO_BASE_URL/index.php?module=API&method=API.getVersion&token_auth=$MATOMO_TOKEN"`.
- Check tool auth: ensure requests include `Authorization: Bearer $OPAL_BEARER_TOKEN` and that the service is exposing port 3000.
- For NaN key metrics, ensure the latest SDK build is deployed—`npm run build --workspaces` must run before image build so `packages/sdk/dist` contains the NaN guards.
- Use cache stats from `ReportsService` (if `cache.onEvent` is wired) to confirm responses are fresh when validating fixes.
- SDK error handling now surfaces `MatomoApiError` subclasses with guidance (auth, permission, rate limit, network). Opal logs will include the friendly message and next steps.
- August 2025 query surfaced `ZodError: Expected object, received <scalar/array>` for `getKeyNumbers`; tracked as `BUG-002`/`BUG-003` and fixed by unwrapping Matomo scalars/arrays into key-number objects (SDK tests cover both single and series helpers).

## Roadmap: SDK-010 Reliability Enhancements

### SDK-010A – Matomo Error Diagnostics *(completed)*
- Implemented `runDiagnostics({ siteId? })` helper that checks base URL reachability, token validity, and site permissions.
- `/tools/diagnose-matomo` Opal endpoint returns structured check results (status, details, guidance) for front-line troubleshooting.

### SDK-010B – Enhanced API Error Handling
- Normalize errors in `MatomoHttpClient`: surface typed classes for auth, permission, rate-limit, server, and parse errors.
- Propagate structured errors to the API so Opal responses include friendly summaries and remediation hints.

### SDK-010C – Service Health Monitoring
- Expose `/status` tool reporting Matomo reachability, cache stats, tracking queue length, and last success timestamps.
- Optionally add periodic reachability checks and emit events when health flips.

### SDK-010D – Contextual Error Guidance
- Maintain an error catalog mapping Matomo codes/messages to remediation tips and documentation links.
- Attach guidance to thrown errors so tools can coach users on the fix.

### SDK-010E – Rate Limit Awareness
- Detect 429s and `X-Matomo-Rate-Limit-*` headers; back off automatically when limits are near.
- Surface remaining quota and throttle status in tool responses.

### SDK-010F – Idempotent Request Support
- Add idempotency keys to tracking queue entries, ensuring retries do not double-submit events.
- Persist attempt metadata and expose dedupe hooks for future durable storage.

## Open Backlog Links
- `INF-004` tracks the move from console logging to structured logging (Pino/Winston).
- `SDK-015` will deliver funnel analytics support once SDK-010 reliability work is underway.
- `SDK-016` captures internal site-search keyword reporting via `Actions.getSiteSearchKeywords`.
- `SDK-017` will add page transitions reporting based on `Transitions.getTransitionsForPage`.
