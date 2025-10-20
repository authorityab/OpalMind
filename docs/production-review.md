# Full Production Code Review — OpalMind

## 1. Executive Summary
- Docker health probe always reports green because `/health` never touches Matomo or the cache, masking outages and breaking automated restarts. 【F:packages/api/src/server.ts†L648-L650】【F:Dockerfile†L32-L36】
- Matomo SDK performs unbounded `fetch` calls without timeouts, allowing any slow Matomo request to wedge the Node event loop and exhaust the worker pool. 【F:packages/sdk/src/httpClient.ts†L167-L205】
- The upstream `ToolsService` logs every request/response body (including visitor IDs, auth context, and potential secrets) straight to stdout, violating the “no secrets in logs” requirement. 【F:node_modules/@optimizely-opal/opal-tools-sdk/src/service.ts†L37-L74】【2e04ed†L1-L69】
- Health API fabricates a “tracking-queue” check and never inspects the actual retry queue, so operators get false confidence about ingestion lag. 【F:packages/sdk/src/index.ts†L934-L943】
- Express boundary now enforces security headers, CORS allowlists, request body limits, rate limiting, and Zod validation for `/tools/*` and `/track/*`, reducing exposure to malformed payloads and brute-force attempts. 【F:packages/api/src/server.ts†L200-L323】【F:packages/api/src/validation.ts†L1-L188】
- Repository lacks production runbook, Matomo troubleshooting guidance, and instructions for GHCR deployment despite containerized workflow expectations.
- TypeScript compiler still allows implicit anys/loose optionals, and ESLint does not enforce security-sensitive rules (no-console, header validation) used in production paths. 【F:packages/api/src/server.ts†L648-L650】
- Cache health thresholding uses arbitrary percentages and no alerts/metrics export, limiting observability when cache churn increases. 【F:packages/sdk/src/index.ts†L912-L933】
- Bearer token comparison is case-sensitive string equality without constant time or error taxonomy, yielding confusing 401s on harmless header differences. 【F:packages/api/src/server.ts†L72-L85】
- Tests cover happy-path tool routing only; there are no contract tests for `/track/*` failure cases, Matomo timeout handling, or `/health` degradation, leaving the main regressions unguarded. 【F:packages/api/test/server.test.ts†L1-L320】

## 2. Findings by Severity

### Critical

#### 2.1 `/health` endpoint bypasses real health checks
- **File & lines:** `packages/api/src/server.ts` L648-L650; `Dockerfile` L32-L36. 【F:packages/api/src/server.ts†L648-L650】【F:Dockerfile†L32-L36】
- **Why it matters:** Docker’s health probe and any load balancer will see a permanent 200 even when Matomo is offline or the SDK cache is failing, preventing automated restarts and draining bad pods into production traffic.
- **Proof:** Hitting `/health` only returns `{ ok: true }`; Matomo outages are invisible because no checks execute. Dockerfile relies on this endpoint for container health. 【F:packages/api/src/server.ts†L648-L650】【F:Dockerfile†L32-L36】
- **Fix:** Call `matomoClient.getHealthStatus`, propagate degraded/unhealthy status, and surface JSON while redacting internals.
```diff
diff --git a/packages/api/src/server.ts b/packages/api/src/server.ts
@@
-  app.get('/health', (_req: Request, res: Response) => {
-    res.json({ ok: true });
-  });
+  app.get('/health', async (_req: Request, res: Response) => {
+    try {
+      const health = await matomoClient.getHealthStatus();
+      const status = health.status === 'healthy' ? 200 : 503;
+      res.status(status).json({ ok: health.status === 'healthy', health });
+    } catch {
+      res.status(503).json({ ok: false, error: 'Matomo unreachable' });
+    }
+  });
```

#### 2.2 Matomo HTTP client lacks timeouts
- **File & lines:** `packages/sdk/src/httpClient.ts` L167-L205. 【F:packages/sdk/src/httpClient.ts†L167-L205】
- **Why it matters:** `fetch` defaults to no timeout, so any slow or hanging Matomo request ties up the async loop, eventually exhausting worker threads and causing cascading 5xx responses across all tools.
- **Proof:** `MatomoHttpClient.get` simply `await fetch(endpoint)` without AbortController, timeout, or retry budget. 【F:packages/sdk/src/httpClient.ts†L167-L205】
- **Fix:** Add configurable timeout+retries with AbortController and propagate `MatomoNetworkError` on timeout for retry/backoff logic.
```diff
diff --git a/packages/sdk/src/httpClient.ts b/packages/sdk/src/httpClient.ts
@@
-    try {
-      res = await fetch(endpoint);
+    const controller = new AbortController();
+    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
+    try {
+      res = await fetch(endpoint, { signal: controller.signal });
     } catch (error) {
       throw new MatomoNetworkError('Failed to reach Matomo instance.', {
         endpoint: redactedEndpoint,
         cause: error,
       });
-    }
+    } finally {
+      clearTimeout(timeout);
+    }
```

#### 2.3 Tool service logs sensitive payloads
- **File & lines:** `node_modules/@optimizely-opal/opal-tools-sdk/src/service.ts` L37-L74. 【F:node_modules/@optimizely-opal/opal-tools-sdk/src/service.ts†L37-L74】
- **Why it matters:** Every request/response body (including visitor IDs, Matomo auth, and query parameters) is dumped to stdout. These logs land in Docker, CloudWatch, etc., violating the “secrets must never appear in logs” requirement and leaking PII.
- **Proof:** Vitest output shows raw request bodies and tool responses logged verbatim. 【2e04ed†L1-L69】
- **Fix:** Replace the upstream logger with a local wrapper that redacts tokens and disables verbose console logging in production.
```diff
diff --git a/packages/api/src/server.ts b/packages/api/src/server.ts
@@
-  const toolsService = new ToolsService(app);
+  const toolsService = new ToolsService(app, {
+    logger: {
+      info: () => {},
+      warn: console.warn,
+      error: console.error,
+    },
+    redact: value => (typeof value === 'string' && value.includes('token_auth') ? 'REDACTED' : value),
+  });
```

### High

#### 2.4 Tracking queue health is fabricated
- **File & lines:** `packages/sdk/src/index.ts` L934-L943. 【F:packages/sdk/src/index.ts†L934-L943】
- **Why it matters:** Health reports always list `tracking-queue` as “pass” with zero pending items, even if the retry queue is saturated, preventing SREs from detecting ingestion stalls.
- **Proof:** `checks.push({ name: 'tracking-queue', status: 'pass', observedValue: 0, ... })` hardcodes success. 【F:packages/sdk/src/index.ts†L934-L943】
- **Fix:** Expose `TrackingService` queue depth stats and use them in health response.
```diff
diff --git a/packages/sdk/src/index.ts b/packages/sdk/src/index.ts
@@
-    checks.push({
-      name: 'tracking-queue',
-      status: 'pass',
-      componentType: 'queue',
-      observedValue: 0,
-      observedUnit: 'pending',
-      time: timestamp,
-      output: 'Queue processing normally',
-    });
+    const queueStats = this.tracking?.getQueueStats();
+    const pending = queueStats?.pending ?? 0;
+    checks.push({
+      name: 'tracking-queue',
+      status: pending > 10 ? 'warn' : 'pass',
+      componentType: 'queue',
+      observedValue: pending,
+      observedUnit: 'pending',
+      time: timestamp,
+      output: `Pending retries: ${pending}`,
+    });
```

#### 2.5 Missing HTTP hardening & schema validation
- **File & lines:** `packages/api/src/server.ts` L72-L158. 【F:packages/api/src/server.ts†L72-L158】
- **Why it matters:** Express routes accept arbitrary JSON without Zod validation, helmet headers, rate limiting, or granular auth errors; malformed payloads can crash handlers or bypass intended constraints.
- **Proof:** Endpoints use manual coercion helpers and never apply validation middleware; ToolsService executes handler directly. 【F:packages/api/src/server.ts†L72-L158】【F:node_modules/@optimizely-opal/opal-tools-sdk/src/service.ts†L37-L74】
- **Fix:** Add global middleware (helmet, cors, rate limiter) and wrap tool handlers with Zod schemas before invoking the SDK.
```diff
+  app.use(helmet({ contentSecurityPolicy: false }));
+  app.use(cors({ origin: false }));
+  app.use(rateLimiterMiddleware);
```

### Medium

#### 2.6 Cache health thresholds arbitrary & silent
- **File & lines:** `packages/sdk/src/index.ts` L912-L933. 【F:packages/sdk/src/index.ts†L912-L933】
- **Why it matters:** Hit-rate thresholds (`<20%` warn, `<5%` fail) ignore traffic volume and never emit metrics/logs, so operators cannot tune cache or alert on churn.
- **Fix:** Emit structured metrics (e.g., Prometheus counters) and allow configurable thresholds via env.

#### 2.7 Bearer token check fragile
- **File & lines:** `packages/api/src/server.ts` L72-L85. 【F:packages/api/src/server.ts†L72-L85】
- **Why it matters:** Direct equality comparison rejects legitimate requests with casing/whitespace differences and doesn’t distinguish between missing vs bad tokens, reducing operability.
- **Fix:** Normalize header, log structured auth failures, and return `WWW-Authenticate` with error details.

#### 2.8 Health queue output lacks readiness split
- **File & lines:** `packages/api/src/server.ts` L648-L650; `packages/sdk/src/index.ts` L883-L988. 【F:packages/api/src/server.ts†L648-L650】【F:packages/sdk/src/index.ts†L883-L988】
- **Why it matters:** Only one health endpoint exists; there’s no separation between readiness (Matomo/caches) and liveness (process up), complicating Kubernetes deployment.
- **Fix:** Keep `/healthz` for liveness and expose `/readyz` requiring Matomo success.

### Low

#### 2.9 Logging & lint rules allow console in prod
- **File & lines:** `packages/api/src/server.ts` L663-L676; `packages/sdk/src/index.ts` L549-L550. 【F:packages/api/src/server.ts†L663-L676】【F:packages/sdk/src/index.ts†L549-L550】
- **Why it matters:** Console logging persists in runtime code; ESLint disables `no-console`, risking accidental secret leaks.
- **Fix:** Configure logger utility with redaction and enforce lint rule except through logger.

#### 2.10 TypeScript config too permissive
- **File & lines:** `tsconfig.base.json` (implicit). Allows `skipLibCheck`, lacks `exactOptionalPropertyTypes`.
- **Fix:** Harden compiler options and fix resulting issues.

## 3. Security Review
- **Bearer handling:** Single shared bearer token enforced via strict equality; recommend case-insensitive comparison, structured auth logging, and eventual per-client tokens. 【F:packages/api/src/server.ts†L72-L85】
- **Secret loading:** Service aborts on default tokens (`change-me`, `set-me`) satisfying guard. 【F:packages/api/src/server.ts†L38-L61】
- **Token redaction:** SDK redacts `token_auth` when logging endpoints, but upstream ToolsService still logs raw request payloads—patch via injected logger (diff in §2.3). 【F:packages/sdk/src/httpClient.ts†L185-L204】【F:node_modules/@optimizely-opal/opal-tools-sdk/src/service.ts†L37-L74】
- **Input validation:** No Zod schemas; implement per-endpoint validators.
- **SSRF/DoS:** Matomo base URL normalized, but fetch lacks timeout (Critical §2.2). Add retry/backoff.
- **HTTP hardening:** Add helmet, cors, request size limits, and trust proxy config.
- **Dependencies:** Check npm audit; upgrade `@optimizely-opal/opal-tools-sdk` or vendor sanitized fork.

### Suggested security diff
```diff
+import helmet from 'helmet';
+import cors from 'cors';
+import rateLimit from 'express-rate-limit';
+
+app.disable('x-powered-by');
+app.use(helmet({ contentSecurityPolicy: false }));
+app.use(cors({ origin: false }));
+app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
```
Add Vitest covering 401/403/429 flows and timeout handling.

## 4. Reliability & Observability
- Healthcheck currently inaccurate (Critical §2.1). Add readiness endpoint, propagate SDK health data, and instrument logs with Matomo latency gauge. 【F:packages/api/src/server.ts†L648-L650】【F:packages/sdk/src/index.ts†L883-L988】
- SDK should expose metrics (cache hit%, Matomo latency, queue depth) via stats collector; integrate with Prometheus exporter.
- Implement retries with exponential backoff on Matomo calls, log structured errors via MatomoApiError taxonomy.
- Tracking service should emit queue depth/age metrics; update health diff in §2.4.
- Use pino/winston with redaction for structured logs instead of console.

## 5. Performance
- Introduce HTTP keep-alive agent and connection pooling for Matomo requests; add timeout/backoff (Critical §2.2).
- Cache TTL configurable; ensure defaults avoid repeated Matomo queries.
- Evaluate JSON transform cost; consider streaming for large reports.

### Sample diff
```diff
+import Agent from 'agentkeepalive';
+const httpAgent = new Agent.HttpsAgent({ keepAlive: true, timeout: 10_000 });
+res = await fetch(endpoint, { agent: httpAgent, signal: controller.signal });
```
Add microbenchmark comparing Matomo fetch latency before/after keep-alive.

## 6. API & Contract Tests
- Add integration tests for `/health` (healthy/degraded) and `/readyz` unauthorized cases.
- Test `/track/*` unhappy paths: invalid payload, Matomo timeout, retry exhaustion.
- Mock Matomo client to throw `MatomoNetworkError` and verify 503.
- Validate schema rejection of invalid types via Zod.

## 7. Testing Gaps
- Missing SDK tests for timeout/backoff logic (`packages/sdk/src/httpClient.ts`).
- No tests for tracking queue stats exposure (`packages/sdk/src/tracking.ts`).
- Add Express supertest coverage for helmet headers and rate limiting.

**Command to run full suite:**
```bash
npm ci
npm run build --workspaces
npm run test --workspace @opalmind/sdk -- --run
npm run test --workspace @opalmind/api -- --run
```

## 8. Docker & Runtime
- Runtime image uses Alpine but still runs as root; switch to non-root user.
- HEALTHCHECK depends on broken `/health`; update after fix.
- Document `docker login ghcr.io` and `docker-compose` env guard (already uses `:?missing_...`). 【F:docker-compose.yml†L1-L16】
- Add `readinessProbe` guidance for Kubernetes and `OPAL_BEARER_TOKEN` secret sourcing.

### Suggested diff
```diff
diff --git a/Dockerfile b/Dockerfile
@@
-FROM node:20-alpine AS runtime
+FROM node:20-alpine AS runtime
+RUN addgroup -S opal && adduser -S opal -G opal
@@
-CMD ["node", "packages/api/dist/server.js"]
+USER opal
+CMD ["node", "packages/api/dist/server.js"]
```

## 9. Linting / Types / Style
- Enable `noImplicitAny`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` in `tsconfig.base.json`; resolve resulting errors.
- Update ESLint config to forbid direct `console` usage outside logger module and enforce `security/detect-object-injection`.
- Remove unused parameters/helpers.

## 10. Docs & Ops
- Expand README with production setup (env vars, Docker/Compose usage, GHCR pulls) and include a Runbook (health interpretation, alert thresholds, Matomo timeout tuning).
- Document health JSON schema and sample `curl` invocations for `/tools/*` with bearer token.
- Add procedures for token rotation, rate limit incidents, and rolling restart playbooks.

## 11. Prod-Readiness Checklist
- [ ] Secrets sourced from vault/CI and never logged.
- [ ] `/health` & `/readyz` wired to Matomo diagnostics with alerts.
- [ ] Matomo client timeouts/retries/backoff tested.
- [ ] Tracking queue metrics exported and alerted.
- [ ] Docker image non-root, pinned Node version, healthcheck validated.
- [ ] CI runs Vitest + lint + docker build.
- [ ] Runbook published with rollback steps.
- [ ] Observability dashboards: Matomo latency, cache hit %, queue depth, 4xx/5xx rate.
- [ ] Security review signed off (bearer handling, input validation, dependency audit).
- [ ] Load test covering key tool endpoints with cached vs uncached paths.
