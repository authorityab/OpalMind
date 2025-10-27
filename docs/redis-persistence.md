# Redis Persistence for Queue and Cache

## Overview

OpalMind supports persisting the tracking retry queue and reports cache to Redis, ensuring that in-flight work and cached data survive service restarts. This is essential for production deployments where uptime and data durability are critical.

## Architecture

### Components

1. **Tracking Queue Persistence** - Uses `RedisIdempotencyStore` to persist tracking request idempotency records
2. **Reports Cache Persistence** - Uses `RedisCacheStore` to persist report API responses

### Benefits

- **Restart Resilience**: Pending tracking requests and cached reports survive service restarts
- **Horizontal Scaling**: Multiple API instances can share the same Redis instance for coordinated caching
- **Storage Visibility**: Operators can inspect Redis to understand storage requirements and debug issues
- **TTL Management**: Redis automatically expires stale entries based on configured TTLs

## Configuration

### Environment Variables

Add the following environment variables to enable Redis persistence:

```bash
# Redis Connection
REDIS_HOST=localhost              # Redis server hostname
REDIS_PORT=6379                   # Redis server port (default: 6379)
REDIS_PASSWORD=your-password      # Optional: Redis password
REDIS_DB=0                        # Optional: Redis database number (default: 0)
REDIS_TLS=false                   # Optional: Enable TLS (default: false)

# Persistence Configuration
REDIS_IDEMPOTENCY_TTL=86400       # Optional: Idempotency record TTL in seconds (default: 24 hours)
REDIS_IDEMPOTENCY_PREFIX=opalmind:idempotency:  # Optional: Key prefix for idempotency records
REDIS_CACHE_PREFIX=opalmind:cache:              # Optional: Key prefix for cache entries
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
    restart: unless-stopped

  opalmind-api:
    image: ghcr.io/authorityab/opalmind-api:latest
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MATOMO_BASE_URL=${MATOMO_BASE_URL}
      - MATOMO_TOKEN=${MATOMO_TOKEN}
      - OPAL_BEARER_TOKEN=${OPAL_BEARER_TOKEN}
    depends_on:
      - redis
    restart: unless-stopped

volumes:
  redis-data:
```

## SDK Usage

### TypeScript/JavaScript Application

```typescript
import Redis from 'ioredis';
import { 
  createMatomoClient, 
  RedisIdempotencyStore,
  RedisCacheStore 
} from '@opalmind/sdk';

// Create Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
});

// Create Redis-backed stores
const idempotencyStore = new RedisIdempotencyStore({
  redis,
  keyPrefix: 'opalmind:idempotency:',
  ttlSeconds: 86400, // 24 hours
});

const cacheStore = new RedisCacheStore({
  redis,
  keyPrefix: 'opalmind:cache:',
});

// Create Matomo client with Redis persistence
const client = createMatomoClient({
  baseUrl: process.env.MATOMO_BASE_URL!,
  tokenAuth: process.env.MATOMO_TOKEN!,
  tracking: {
    idempotencyStore,
  },
  cache: {
    store: cacheStore,
    ttlMs: 60000, // 60 seconds
  },
});

// Use the client normally
await client.trackPageview({ url: 'https://example.com', siteId: 1 });
const keyNumbers = await client.getKeyNumbers({ period: 'day', date: 'today' });
```

## Migration Notes

### Migrating from In-Memory to Redis

1. **No Data Loss on First Deploy**: The first deployment with Redis enabled will start with an empty queue and cache. In-flight tracking requests in the old deployment will be lost on restart, but new requests will be persisted.

2. **Gradual Rollout**: Consider deploying Redis persistence during a maintenance window or low-traffic period to minimize the impact of the initial empty state.

3. **Monitoring**: After enabling Redis persistence:
   - Monitor Redis memory usage
   - Check `/tools/get-health-status` to verify cache hit rates
   - Inspect Redis keys using `KEYS opalmind:*` (development only - use SCAN in production)

### Storage Requirements

#### Tracking Queue

- **Size per Entry**: ~500 bytes (varies by request payload)
- **Typical Queue Depth**: 0-25 entries (higher during Matomo outages)
- **TTL**: 24 hours by default
- **Estimated Storage**: < 1 MB for typical workloads

#### Reports Cache

- **Size per Entry**: 1-50 KB (varies by report type and result size)
- **Typical Entry Count**: 100-1000 entries (depends on traffic and cache TTL)
- **TTL**: 60 seconds by default (configurable)
- **Estimated Storage**: 10-50 MB for typical workloads

### Redis Configuration Recommendations

#### Development

```redis
# Minimal persistence for development
save 900 1
save 300 10
appendonly no
maxmemory 256mb
maxmemory-policy allkeys-lru
```

#### Production

```redis
# Strong durability for production
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
maxmemory 512mb
maxmemory-policy allkeys-lru
```

## Monitoring

### Health Checks

The `/tools/get-health-status` endpoint reports queue and cache metrics:

```json
{
  "checks": [
    {
      "name": "tracking-queue",
      "status": "pass",
      "componentType": "queue",
      "observedValue": 0,
      "details": {
        "pending": 0,
        "inflight": 0,
        "totalProcessed": 1250,
        "totalRetried": 45
      }
    },
    {
      "name": "reports-cache",
      "status": "pass",
      "componentType": "cache",
      "observedValue": 85.5,
      "observedUnit": "%",
      "details": {
        "hitRate": 85.5,
        "hits": 342,
        "misses": 58,
        "entries": 127
      }
    }
  ]
}
```

### Redis Metrics

Monitor these Redis metrics for operational health:

- **used_memory**: Current memory usage
- **keyspace_hits / keyspace_misses**: Overall cache effectiveness
- **connected_clients**: Number of active connections
- **evicted_keys**: Keys removed due to maxmemory policy

```bash
# Check Redis metrics
redis-cli INFO stats
redis-cli INFO memory

# Count OpalMind keys (development only)
redis-cli KEYS "opalmind:*" | wc -l

# Sample cache keys (production-safe)
redis-cli --scan --pattern "opalmind:cache:*" --count 10
```

## Troubleshooting

### Issue: High Memory Usage

**Solution**: Reduce cache TTL or increase Redis maxmemory with eviction policy:

```bash
# Update environment
CACHE_TTL_MS=30000  # Reduce from 60s to 30s

# Or configure Redis eviction
redis-cli CONFIG SET maxmemory 512mb
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

### Issue: Cache Not Persisting

**Symptoms**: Cache hit rate stays low across restarts

**Diagnosis**:
1. Verify Redis connection: `redis-cli PING`
2. Check environment variables are set
3. Inspect logs for Redis connection errors
4. Verify `cacheStore` is passed to client config

### Issue: Tracking Queue Not Resuming

**Symptoms**: Pending tracking requests lost on restart

**Diagnosis**:
1. Verify `idempotencyStore` is configured
2. Check Redis keys exist: `redis-cli KEYS "opalmind:idempotency:*"`
3. Review TTL settings - expired entries are automatically cleaned up

### Issue: Redis Connection Failures

**Symptoms**: API fails to start or tracking/caching falls back to in-memory

**Solution**:
1. Verify Redis is running: `redis-cli PING`
2. Check network connectivity from API container
3. Verify credentials and TLS settings
4. Review Redis logs for authentication or connection errors

## Security Considerations

1. **Redis Authentication**: Always set `requirepass` in production Redis instances
2. **Network Isolation**: Run Redis on a private network, not publicly accessible
3. **TLS**: Enable TLS for Redis connections in production: `REDIS_TLS=true`
4. **Key Prefixes**: Use unique prefixes per environment to avoid data collisions
5. **Credentials**: Store Redis passwords in secret managers, not plain environment files

## Performance Tuning

### Cache TTL

Adjust based on your traffic patterns:

- **High-traffic, real-time dashboards**: 30-60 seconds
- **Moderate traffic, periodic updates**: 2-5 minutes
- **Low-traffic, batch reports**: 10-15 minutes

### Idempotency TTL

Tracking idempotency records only need to persist long enough to prevent duplicates:

- **Default**: 24 hours (covers most retry scenarios)
- **High-volume**: Reduce to 1-6 hours to save memory
- **Critical accuracy**: Increase to 48-72 hours

### Connection Pooling

For high-throughput deployments, configure Redis connection pooling:

```typescript
const redis = new Redis({
  host: 'redis',
  enableOfflineQueue: false,  // Fail fast if Redis is down
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});
```

## Fallback Behavior

If Redis is unavailable:

1. **Tracking Queue**: Falls back to in-memory storage (data lost on restart)
2. **Reports Cache**: Falls back to in-memory cache (data lost on restart)
3. **Service Health**: Marked as `degraded` but remains operational

This ensures the service remains available even if Redis fails, though with reduced durability.

## Related Documentation

- [Production Runbook](./production-runbook.md) - Deployment and operations
- [Health Monitoring](../packages/api/docs/health-monitoring.md) - Health check details
- [ADR-0003](../.assistant/adr/ADR-0003.md) - Retry queue architecture decision
