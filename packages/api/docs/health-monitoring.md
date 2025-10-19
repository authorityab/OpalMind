# Health Monitoring (SDK-010C)

## Overview

The health monitoring feature provides comprehensive status checks for Matomo API connectivity, cache performance, and service dependencies. This enables proactive monitoring and troubleshooting of the OpalMind service.

## API Endpoint

### `GET /health`

Container and load-balancer health probes should call this unauthenticated endpoint. It proxies Matomo diagnostics and returns HTTP `200` when the overall status is `healthy` or `degraded`, and `503` when marked `unhealthy`.

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "health": {
    "status": "healthy",
    "timestamp": "2025-09-30T15:30:00.000Z",
    "checks": [
      {
        "name": "matomo-api",
        "status": "pass",
        "componentType": "service",
        "observedValue": 145,
        "observedUnit": "ms",
        "time": "2025-09-30T15:30:00.000Z",
        "output": "API responded in 145ms"
      }
    ]
  }
}
```

### `GET /tools/get-health-status`

Returns real-time health status with individual component checks.

**Parameters:**
- `siteId` (optional): Override site ID for site-specific checks
- `includeDetails` (optional): Include detailed site access verification

**Response:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2025-09-30T15:30:00.000Z",
  "checks": [
    {
      "name": "matomo-api",
      "status": "pass",
      "componentType": "service",
      "observedValue": 145,
      "observedUnit": "ms",
      "time": "2025-09-30T15:30:00.000Z",
      "output": "API responded in 145ms"
    },
    {
      "name": "reports-cache",
      "status": "pass",
      "componentType": "cache",
      "observedValue": 85.5,
      "observedUnit": "%",
      "time": "2025-09-30T15:30:00.000Z",
      "output": "Hit rate: 85.5% (342/400 requests)"
    },
    {
      "name": "tracking-queue",
      "status": "pass",
      "componentType": "queue",
      "observedValue": 0,
      "observedUnit": "pending",
      "time": "2025-09-30T15:30:00.000Z",
      "output": "Queue processing normally"
    }
  ]
}
```

## Health Checks

### 1. Matomo API Connectivity
- **Check**: Calls `API.getMatomoVersion` (fallback to `API.getVersion` for legacy Matomo) to verify reachability
- **Metrics**: Response time in milliseconds
- **Status**: 
  - `pass`: API responds successfully
  - `fail`: Network error or API unreachable

### 2. Reports Cache Performance
- **Check**: Analyzes cache hit/miss ratios from reporting service
- **Metrics**: Hit rate percentage
- **Status**:
  - `pass`: Hit rate > 20% (with sufficient requests)
  - `warn`: Hit rate 5-20% (with sufficient requests)
  - `fail`: Hit rate < 5% (with sufficient requests)

### 3. Tracking Queue Status
- **Check**: Monitors tracking queue health
- **Metrics**: Pending operations count
- **Status**: `pass` when queue is processing normally

### 4. Site Access (Optional)
- **Check**: Verifies access to specific Matomo site (when `includeDetails=true`)
- **Requirement**: Requires valid `siteId` (from parameter or default)
- **Status**:
  - `pass`: Site accessible and permissions valid
  - `fail`: Site not found or permission denied

## Diagnostics Token Verification

The accompanying diagnostics routine validates API tokens before running site-level checks.

- **Check**: Calls `UsersManager.getUserByTokenAuth` to confirm the bearer token is accepted, falling back to legacy `API.getLoggedInUser` when the method is missing or the token lacks UsersManager permissions.
- **Outcome**: Reports the resolved Matomo user login or surfaces actionable guidance when authentication fails.
- **Redaction**: Diagnostic errors sanitize Matomo URLs before logging or returning them. Any `token_auth` query parameters are replaced with `REDACTED` so credentials never appear in responses or logs.

## Overall Status Logic

- **healthy**: All checks pass
- **degraded**: Some checks have warnings but no failures
- **unhealthy**: One or more checks fail

## SDK Usage

```typescript
import { createMatomoClient } from '@opalmind/sdk';

const client = createMatomoClient({
  baseUrl: 'https://matomo.example.com',
  tokenAuth: 'your-token',
  defaultSiteId: 1
});

// Basic health check
const health = await client.getHealthStatus();
console.log(`Status: ${health.status}`);

// Detailed health check with site verification
const detailedHealth = await client.getHealthStatus({ 
  includeDetails: true,
  siteId: 5 
});
```

## Monitoring Integration

The health status endpoint follows standard health check patterns and can be integrated with:

- **Load Balancers**: Use for upstream health checks
- **Monitoring Systems**: Poll every 60 seconds (Grafana Synthetic Monitoring, Prometheus `probe_http_status`, Datadog HTTP checks). Treat any `status` other than `healthy` as a warning and raise a critical alert when it reports `unhealthy` for two consecutive intervals.
- **Dashboards**: Display real-time service health with the full `checks` array so operators can see which subsystem degraded.
- **CI/CD**: Verify deployment health

### Alerting & Runbook

- **Warning thresholds**: fire a warning when `status === "degraded"` for more than 2 minutes or when `reports-cache` hit rate drops below 20%.
- **Critical thresholds**: fire a critical alert immediately when `status === "unhealthy"` or the `matomo-api` check fails.
- **Runbook**: link alerts to `/.assistant/troubleshoot/runbook.md#health-status-alert-triggered-by-monitoring` for triage steps covering Matomo connectivity, cache, and tracking queue recovery.

## Example cURL

```bash
# Basic health check
curl http://localhost:3000/health

# Authenticated health tool (richer diagnostics)
curl -H "Authorization: Bearer your-token" \
  "http://localhost:3000/tools/get-health-status"

# Detailed health check
curl -H "Authorization: Bearer your-token" \
  "http://localhost:3000/tools/get-health-status" \
  -d '{"parameters": {"includeDetails": true, "siteId": 1}}'
```
